import crypto from 'node:crypto';
import { WorkflowDefinition, StageDefinition } from '../domain/workflow.types.js';
import { WorkflowExecution, ExecutionDecision } from '../domain/execution.types.js';
import { AuditLogEntry, AuditEventType } from '../domain/audit.types.js';
import { InMemoryStore } from '../storage/in-memory-store.js';
import { IdempotencyManager, IdempotencyConflictError } from '../resilience/idempotency.js';
import { ChaosMode } from '../resilience/external-service-simulator.js';
import { StateMachine } from './state-machine.js';
import { StageExecutor } from './stage-executor.js';

export interface ExecuteOptions {
  version?: string;
  idempotencyKey?: string;
  chaosOverride?: ChaosMode;
}

export class WorkflowOrchestrator {
  private store: InMemoryStore;
  private idempotencyManager: IdempotencyManager;
  private stageExecutor: StageExecutor;

  constructor() {
    this.store = InMemoryStore.getInstance();
    this.idempotencyManager = new IdempotencyManager();
    this.stageExecutor = new StageExecutor();
  }

  public getIdempotencyManager(): IdempotencyManager {
    return this.idempotencyManager;
  }

  /**
   * Log an audit event
   */
  private async logAudit(
    executionId: string,
    eventType: AuditEventType,
    summary: string,
    actor = 'ENGINE',
    stageId?: string,
    details?: Record<string, any>
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      executionId,
      timestamp: new Date().toISOString(),
      eventType,
      stageId,
      actor,
      summary,
      details,
    };
    await this.store.saveAuditEntry(entry);
  }

  /**
   * Start and run a workflow execution
   */
  public async executeWorkflow(
    workflowId: string,
    input: Record<string, any>,
    options: ExecuteOptions = {}
  ): Promise<WorkflowExecution> {
    // 1. Resolve workflow definition
    let workflow: WorkflowDefinition | undefined;
    if (options.version) {
      workflow = await this.store.findByIdAndVersion(workflowId, options.version);
    } else {
      workflow = await this.store.findById(workflowId);
    }

    if (!workflow) {
      throw new Error(`Workflow '${workflowId}' (version: ${options.version || 'latest'}) was not found.`);
    }

    // 2. Check Idempotency if key is present
    const executionId = crypto.randomUUID();

    if (options.idempotencyKey) {
      const { isReplay, record } = this.idempotencyManager.acquire(
        options.idempotencyKey,
        input,
        executionId,
        workflowId
      );

      if (isReplay && record.responsePayload) {
        // Return existing cached execution
        const cachedExecution = (await this.store.findExecutionById(record.executionId)) || record.responsePayload;
        if (cachedExecution) {
          await this.logAudit(
            cachedExecution.id,
            'IDEMPOTENT_HIT',
            `Duplicate request detected for key '${options.idempotencyKey}'. Returned cached execution outcome.`,
            'IDEMPOTENCY_FILTER',
            undefined,
            { idempotencyKey: options.idempotencyKey }
          );
          return cachedExecution;
        }
      }
    }

    // 3. Initialize Execution
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      idempotencyKey: options.idempotencyKey,
      state: 'SUBMITTED',
      currentStageId: workflow.initialStage,
      input: { ...input },
      context: {},
      stateHistory: [],
      ruleTraces: [],
      retryState: { currentAttempt: 0, maxAttempts: 3 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.store.saveExecution(execution);
    await this.logAudit(
      executionId,
      'REQUEST_RECEIVED',
      `Workflow request received for ${workflow.name} (v${workflow.version}).`,
      'SYSTEM',
      workflow.initialStage,
      { input }
    );

    // 4. Drive Execution through stages
    let currentStageId: string | undefined = workflow.initialStage;

    while (currentStageId) {
      const stage: StageDefinition | undefined = workflow.stages.find((s) => s.id === currentStageId);
      if (!stage) {
        throw new Error(`Stage '${currentStageId}' not defined in workflow '${workflow.id}'`);
      }

      execution.currentStageId = stage.id;

      // State Transition based on stage type
      if (stage.type === 'VALIDATION') {
        StateMachine.transition(execution, 'VALIDATING', `Beginning schema validation`, 'ENGINE', stage.id);
        await this.store.saveExecution(execution);

        const result = await this.stageExecutor.executeValidation(execution, workflow, stage);
        await this.logAudit(
          executionId,
          result.status === 'SUCCESS' ? 'VALIDATION_PASSED' : 'VALIDATION_FAILED',
          result.status === 'SUCCESS' ? `Validation stage '${stage.name}' passed.` : `Validation stage failed: ${result.decision?.explanationSummary}`,
          'SCHEMA_VALIDATOR',
          stage.id,
          { errors: result.decision?.reasons }
        );

        if (result.status === 'FAILED') break;
        currentStageId = result.nextStageId;
      } else if (stage.type === 'ENRICHMENT') {
        StateMachine.transition(execution, 'ENRICHING', `Calling external dependency '${stage.serviceName}'`, 'ENGINE', stage.id);
        await this.store.saveExecution(execution);

        await this.logAudit(
          executionId,
          'EXTERNAL_DEPENDENCY_CALLED',
          `Dispatched call to external dependency '${stage.serviceName}'`,
          'DEPENDENCY_ENRICHER',
          stage.id,
          { serviceName: stage.serviceName }
        );

        const result = await this.stageExecutor.executeEnrichment(
          execution,
          stage,
          options.chaosOverride,
          async (retryLog) => {
            await this.logAudit(
              executionId,
              'RETRY_SCHEDULED',
              `External service call failed (Attempt ${retryLog.attempt}): ${retryLog.error.message}. Retrying in ${retryLog.delayMs}ms.`,
              'RETRY_MANAGER',
              stage.id,
              { attempt: retryLog.attempt, delayMs: retryLog.delayMs, error: retryLog.error.message }
            );
          }
        );

        if (result.status === 'FAILED') {
          await this.logAudit(
            executionId,
            'EXTERNAL_DEPENDENCY_FAILED',
            `Dependency '${stage.serviceName}' permanently failed or retries exhausted: ${result.error?.message}`,
            'SYSTEM',
            stage.id,
            { error: result.error?.message }
          );
          break;
        }

        await this.logAudit(
          executionId,
          'EXTERNAL_DEPENDENCY_RECOVERED',
          `Dependency '${stage.serviceName}' successfully enriched context.`,
          'DEPENDENCY_ENRICHER',
          stage.id,
          { enrichedKeys: Object.keys(execution.context[stage.serviceName || ''] || {}) }
        );

        currentStageId = result.nextStageId;
      } else if (stage.type === 'RULE_EVALUATION') {
        StateMachine.transition(execution, 'EVALUATING', `Evaluating ruleset '${stage.rulesetId}'`, 'RULE_ENGINE', stage.id);
        await this.store.saveExecution(execution);

        await this.logAudit(
          executionId,
          'RULE_EVALUATION_STARTED',
          `Started evaluating ruleset '${stage.rulesetId}'`,
          'RULE_ENGINE',
          stage.id
        );

        const result = await this.stageExecutor.executeRuleEvaluation(execution, stage);

        await this.logAudit(
          executionId,
          result.status === 'PAUSED' ? 'MANUAL_REVIEW_REQUESTED' : 'RULE_EVALUATION_COMPLETED',
          result.decision?.explanationSummary || `Rule evaluation completed.`,
          'RULE_ENGINE',
          stage.id,
          { verdict: result.decision?.verdict, reasons: result.decision?.reasons }
        );

        if (result.status === 'PAUSED') {
          // Manual review required - stop workflow execution
          break;
        }

        if (execution.state === 'APPROVED' || execution.state === 'REJECTED') {
          // Terminal reached
          break;
        }

        currentStageId = result.nextStageId;
      } else {
        // Unknown stage or manual review stage
        break;
      }

      await this.store.saveExecution(execution);
    }

    // 5. Finalize Decision and Idempotency Record
    await this.store.saveExecution(execution);

    if (['APPROVED', 'REJECTED'].includes(execution.state)) {
      await this.logAudit(
        executionId,
        'FINAL_DECISION',
        `Final verdict: ${execution.state}. ${execution.decision?.explanationSummary || ''}`,
        'SYSTEM',
        execution.currentStageId,
        { verdict: execution.state, decision: execution.decision }
      );
    }

    if (options.idempotencyKey) {
      this.idempotencyManager.complete(options.idempotencyKey, execution);
    }

    return execution;
  }

  /**
   * Resolve a pending manual review
   */
  public async applyManualReview(
    executionId: string,
    reviewerId: string,
    verdict: 'APPROVED' | 'REJECTED',
    notes: string
  ): Promise<WorkflowExecution> {
    const execution = await this.store.findExecutionById(executionId);
    if (!execution) {
      throw new Error(`Execution '${executionId}' not found.`);
    }

    if (execution.state !== 'PENDING_REVIEW') {
      throw new Error(
        `Cannot review execution '${executionId}' because current state is '${execution.state}' (expected 'PENDING_REVIEW').`
      );
    }

    execution.manualReview = {
      requestedAt: execution.manualReview?.requestedAt || new Date().toISOString(),
      reasonCodes: execution.manualReview?.reasonCodes || [],
      reasons: execution.manualReview?.reasons || [],
      requiredAttentionItems: execution.manualReview?.requiredAttentionItems || [],
      reviewedAt: new Date().toISOString(),
      reviewerId,
      verdict,
      notes,
    };

    const reasonSummary = `Manual review completed by ${reviewerId}: ${verdict}. Notes: ${notes}`;

    StateMachine.transition(execution, verdict, reasonSummary, `REVIEWER:${reviewerId}`, execution.currentStageId);

    execution.decision = {
      verdict,
      reasons: [notes],
      reasonCodes: [`MANUAL_OVERRIDE_${verdict}`],
      explanationSummary: reasonSummary,
      decidedAt: new Date().toISOString(),
      decidedBy: `REVIEWER:${reviewerId}`,
      ruleTraces: execution.ruleTraces,
    };

    await this.store.saveExecution(execution);

    await this.logAudit(
      executionId,
      'MANUAL_REVIEW_COMPLETED',
      reasonSummary,
      `REVIEWER:${reviewerId}`,
      execution.currentStageId,
      { verdict, notes }
    );

    if (execution.idempotencyKey) {
      this.idempotencyManager.complete(execution.idempotencyKey, execution);
    }

    return execution;
  }

  /**
   * Retry a failed execution
   */
  public async retryExecution(
    executionId: string,
    chaosOverride?: ChaosMode
  ): Promise<WorkflowExecution> {
    const execution = await this.store.findExecutionById(executionId);
    if (!execution) {
      throw new Error(`Execution '${executionId}' not found.`);
    }

    if (execution.state !== 'FAILED') {
      throw new Error(`Only FAILED executions can be retried; current state is '${execution.state}'.`);
    }

    // Transition back to RETRYING
    StateMachine.transition(execution, 'RETRYING', `Manual retry initiated`, 'ADMIN', execution.currentStageId);
    await this.store.saveExecution(execution);

    // Re-execute workflow from beginning with healthy or override mode
    return await this.executeWorkflow(execution.workflowId, execution.input, {
      version: execution.workflowVersion,
      chaosOverride: chaosOverride || 'HEALTHY',
    });
  }
}
