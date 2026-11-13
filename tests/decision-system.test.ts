import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/storage/in-memory-store.js';
import { loadDefaultWorkflows } from '../src/config/load-workflows.js';
import { WorkflowOrchestrator } from '../src/orchestrator/workflow-orchestrator.js';
import { ExternalServiceSimulator } from '../src/resilience/external-service-simulator.js';
import { IdempotencyConflictError } from '../src/resilience/idempotency.js';

describe('Resilient Decision Platform Test Suite', () => {
  let store: InMemoryStore;
  let orchestrator: WorkflowOrchestrator;
  let simulator: ExternalServiceSimulator;

  beforeEach(() => {
    store = InMemoryStore.getInstance();
    store.clearAll();
    loadDefaultWorkflows(store);

    orchestrator = new WorkflowOrchestrator();
    simulator = ExternalServiceSimulator.getInstance();
    simulator.resetChaos();
  });

  // 1. HAPPY PATH TEST
  describe('1. Happy Path Scenarios', () => {
    it('should successfully approve prime applicant on loan-approval v1.0.0', async () => {
      const input = {
        applicantName: 'Samantha Green',
        requestedAmount: 35000,
        annualIncome: 95000,
        employmentStatus: 'EMPLOYED',
        creditScore: 750,
      };

      const execution = await orchestrator.executeWorkflow('loan-approval', input, {
        version: '1.0.0',
      });

      expect(execution.state).toBe('APPROVED');
      expect(execution.decision?.verdict).toBe('APPROVED');
      expect(execution.decision?.explanationSummary).toContain('APPROVED');
      expect(execution.context.credit_bureau?.creditScore).toBe(750);
      expect(execution.ruleTraces.length).toBeGreaterThan(0);

      // Verify audit logs
      const auditLogs = await store.findAuditByExecutionId(execution.id);
      expect(auditLogs.some((l) => l.eventType === 'REQUEST_RECEIVED')).toBe(true);
      expect(auditLogs.some((l) => l.eventType === 'VALIDATION_PASSED')).toBe(true);
      expect(auditLogs.some((l) => l.eventType === 'FINAL_DECISION')).toBe(true);
    });

    it('should fast-track approve express insurance claim under $1,500', async () => {
      const claimInput = {
        claimantName: 'Alex Mercer',
        policyNumber: 'POL-AUTO-8821',
        incidentType: 'WATER_DAMAGE',
        claimAmount: 900,
      };

      const execution = await orchestrator.executeWorkflow('insurance-claim', claimInput);

      expect(execution.state).toBe('APPROVED');
      expect(execution.decision?.reasonCodes).toContain('EXPRESS_SETTLEMENT_APPROVED');
      expect(execution.context.deductibleApplied).toBe(100);
    });
  });

  // 2. INVALID INPUT TEST
  describe('2. Schema Validation & Invalid Input Scenarios', () => {
    it('should reject application when mandatory fields are missing', async () => {
      const invalidInput = {
        // applicantName is missing
        requestedAmount: 25000,
        annualIncome: 80000,
        employmentStatus: 'EMPLOYED',
      };

      const execution = await orchestrator.executeWorkflow('loan-approval', invalidInput);

      expect(execution.state).toBe('REJECTED');
      expect(execution.decision?.reasonCodes).toContain('VALIDATION_ERROR');
      expect(execution.decision?.reasons[0]).toContain("Field 'applicantName' is mandatory");

      const auditLogs = await store.findAuditByExecutionId(execution.id);
      expect(auditLogs.some((l) => l.eventType === 'VALIDATION_FAILED')).toBe(true);
    });

    it('should reject application when numeric bounds are violated', async () => {
      const invalidInput = {
        applicantName: 'Test Applicant',
        requestedAmount: 100, // min is 500
        annualIncome: 5000,   // min is 10000
        employmentStatus: 'EMPLOYED',
      };

      const execution = await orchestrator.executeWorkflow('loan-approval', invalidInput);

      expect(execution.state).toBe('REJECTED');
      expect(execution.decision?.reasons.some((r) => r.includes('below minimum limit'))).toBe(true);
    });
  });

  // 3. DUPLICATE REQUESTS & IDEMPOTENCY TEST
  describe('3. Idempotency & Duplicate Request Scenarios', () => {
    it('should return cached result for duplicate request with identical idempotency key', async () => {
      const input = {
        applicantName: 'Daniel Vance',
        requestedAmount: 40000,
        annualIncome: 120000,
        employmentStatus: 'EMPLOYED',
        creditScore: 780,
      };

      const idempotencyKey = 'unique-key-xyz-777';

      // First execution
      const execution1 = await orchestrator.executeWorkflow('loan-approval', input, {
        idempotencyKey,
      });

      // Duplicate execution with exact same key and payload
      const execution2 = await orchestrator.executeWorkflow('loan-approval', input, {
        idempotencyKey,
      });

      expect(execution1.id).toBe(execution2.id);
      expect(execution2.state).toBe(execution1.state);

      // Verify audit trail logged IDEMPOTENT_HIT
      const audits = await store.findAuditByExecutionId(execution1.id);
      expect(audits.some((a) => a.eventType === 'IDEMPOTENT_HIT')).toBe(true);
    });

    it('should throw IdempotencyConflictError when same key is used with conflicting payload', async () => {
      const key = 'shared-key-123';
      const inputA = {
        applicantName: 'Alice Morgan',
        requestedAmount: 20000,
        annualIncome: 90000,
        employmentStatus: 'EMPLOYED',
      };

      const inputB = {
        applicantName: 'Alice Morgan',
        requestedAmount: 85000, // Conflict in amount!
        annualIncome: 90000,
        employmentStatus: 'EMPLOYED',
      };

      // First request succeeds
      await orchestrator.executeWorkflow('loan-approval', inputA, { idempotencyKey: key });

      // Second request with different payload throws error
      await expect(
        orchestrator.executeWorkflow('loan-approval', inputB, { idempotencyKey: key })
      ).rejects.toThrow(IdempotencyConflictError);
    });
  });

  // 4. DEPENDENCY FAILURE TEST
  describe('4. External Dependency Failure Scenarios', () => {
    it('should transition to FAILED when external service suffers permanent outage and exhausts retries', async () => {
      simulator.setChaosConfig({ mode: 'PERMANENT_FAILURE' });

      const input = {
        applicantName: 'Charlie Stone',
        requestedAmount: 30000,
        annualIncome: 80000,
        employmentStatus: 'EMPLOYED',
      };

      const execution = await orchestrator.executeWorkflow('loan-approval', input);

      expect(execution.state).toBe('FAILED');
      expect(execution.decision?.verdict).toBe('FAILED');
      expect(execution.decision?.reasonCodes).toContain('EXTERNAL_DEPENDENCY_FAILURE');

      const audits = await store.findAuditByExecutionId(execution.id);
      expect(audits.some((a) => a.eventType === 'EXTERNAL_DEPENDENCY_FAILED')).toBe(true);
    });
  });

  // 5. RETRY FLOW & TRANSIENT RECOVERY TEST
  describe('5. Retry Flow & Transient Failure Recovery Scenarios', () => {
    it('should retry with backoff and recover successfully on transient dependency failure', async () => {
      // Simulate external service failing the first 2 calls, then recovering
      simulator.setChaosConfig({
        mode: 'TRANSIENT_FAILURE',
        transientFailuresRemaining: 2,
      });

      const input = {
        applicantName: 'Fiona Gallagher',
        requestedAmount: 25000,
        annualIncome: 85000,
        employmentStatus: 'EMPLOYED',
        creditScore: 730,
      };

      const execution = await orchestrator.executeWorkflow('loan-approval', input);

      expect(execution.state).toBe('APPROVED');
      expect(execution.retryState.currentAttempt).toBeGreaterThanOrEqual(1);

      // Verify audit logs show retries were scheduled and recovered
      const audits = await store.findAuditByExecutionId(execution.id);
      expect(audits.some((a) => a.eventType === 'RETRY_SCHEDULED')).toBe(true);
      expect(audits.some((a) => a.eventType === 'EXTERNAL_DEPENDENCY_RECOVERED')).toBe(true);
    });
  });

  // 6. MANUAL REVIEW WORKFLOW TEST
  describe('6. Manual Review Escalation and Adjudication Scenarios', () => {
    it('should route borderline applicant to PENDING_REVIEW and allow reviewer approval', async () => {
      const borderlineInput = {
        applicantName: 'George Clark',
        requestedAmount: 20000,
        annualIncome: 65000,
        employmentStatus: 'EMPLOYED',
        creditScore: 640, // Falls in [600-679] manual review band
      };

      const execution = await orchestrator.executeWorkflow('loan-approval', borderlineInput, {
        version: '1.0.0',
      });

      expect(execution.state).toBe('PENDING_REVIEW');
      expect(execution.decision?.verdict).toBe('MANUAL_REVIEW_REQUIRED');
      expect(execution.manualReview?.reasonCodes).toContain('REVIEW_BORDERLINE_CREDIT');

      // Now senior underwriter reviews and approves
      const reviewed = await orchestrator.applyManualReview(
        execution.id,
        'Underwriter-Alice',
        'APPROVED',
        'Verified collateral and long-term stable employment tenure.'
      );

      expect(reviewed.state).toBe('APPROVED');
      expect(reviewed.manualReview?.reviewerId).toBe('Underwriter-Alice');
      expect(reviewed.decision?.verdict).toBe('APPROVED');

      const audits = await store.findAuditByExecutionId(execution.id);
      expect(audits.some((a) => a.eventType === 'MANUAL_REVIEW_COMPLETED')).toBe(true);
    });
  });

  // 7. RULE CHANGE & VERSION MIGRATION SCENARIO
  describe('7. Rule Change & Version Migration Scenarios', () => {
    it('should produce different decisions for identical payload across v1 and v2 due to config changes', async () => {
      // In v1, credit score cutoff is 600.
      // In v2, credit score cutoff is raised to 640.
      // An applicant with credit score 620:
      // In v1: falls into borderline [600-679] -> MANUAL REVIEW
      // In v2: credit score 620 is below 640 -> REJECTED!
      const borderlinePayload = {
        applicantName: 'Edward Norton',
        requestedAmount: 25000,
        annualIncome: 70000,
        employmentStatus: 'EMPLOYED',
        creditScore: 620,
      };

      // Execute on v1
      const v1Execution = await orchestrator.executeWorkflow('loan-approval', borderlinePayload, {
        version: '1.0.0',
      });
      expect(v1Execution.state).toBe('PENDING_REVIEW');
      expect(v1Execution.decision?.reasonCodes).toContain('REVIEW_BORDERLINE_CREDIT');

      // Execute on v2 with ZERO code changes - purely declarative config change!
      const v2Execution = await orchestrator.executeWorkflow('loan-approval', borderlinePayload, {
        version: '2.0.0',
      });
      expect(v2Execution.state).toBe('REJECTED');
      expect(v2Execution.decision?.reasonCodes).toContain('REJECT_LOW_CREDIT_V2');
    });
  });
});
