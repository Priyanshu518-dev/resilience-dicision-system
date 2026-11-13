import { StageDefinition, WorkflowDefinition } from '../domain/workflow.types.js';
import { WorkflowExecution, ExecutionDecision } from '../domain/execution.types.js';
import { evaluateRuleset, getNestedValue } from '../rules/evaluator.js';
import { ExternalServiceSimulator, ChaosMode } from '../resilience/external-service-simulator.js';
import { executeWithRetry, RetryAttemptLog } from '../resilience/retry.js';
import { InMemoryStore } from '../storage/in-memory-store.js';
import { StateMachine } from './state-machine.js';

export interface StageExecutionResult {
  status: 'SUCCESS' | 'FAILED' | 'PAUSED';
  nextStageId?: string;
  error?: Error;
  decision?: ExecutionDecision;
}

export class StageExecutor {
  private store: InMemoryStore;
  private externalService: ExternalServiceSimulator;

  constructor() {
    this.store = InMemoryStore.getInstance();
    this.externalService = ExternalServiceSimulator.getInstance();
  }

  /**
   * Execute schema validation stage
   */
  public async executeValidation(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    stage: StageDefinition
  ): Promise<StageExecutionResult> {
    const errors: string[] = [];
    const fields = workflow.schema?.fields || {};

    for (const [fieldName, rule] of Object.entries(fields)) {
      const val = getNestedValue(execution.input, fieldName);

      if (rule.required && (val === undefined || val === null || val === '')) {
        errors.push(`Field '${fieldName}' is mandatory but was missing or empty.`);
        continue;
      }

      if (val !== undefined && val !== null) {
        if (rule.type === 'number') {
          if (typeof val !== 'number' || isNaN(val)) {
            errors.push(`Field '${fieldName}' must be a number; received ${typeof val}.`);
          } else {
            if (rule.min !== undefined && val < rule.min) {
              errors.push(`Field '${fieldName}' (${val}) is below minimum limit of ${rule.min}.`);
            }
            if (rule.max !== undefined && val > rule.max) {
              errors.push(`Field '${fieldName}' (${val}) exceeds maximum limit of ${rule.max}.`);
            }
          }
        } else if (rule.type === 'string') {
          if (typeof val !== 'string') {
            errors.push(`Field '${fieldName}' must be a string; received ${typeof val}.`);
          } else {
            if (rule.regex && !new RegExp(rule.regex).test(val)) {
              errors.push(`Field '${fieldName}' does not match required pattern.`);
            }
            if (rule.enum && !rule.enum.includes(val)) {
              errors.push(`Field '${fieldName}' ('${val}') is not in allowed list: [${rule.enum.join(', ')}].`);
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      const decision: ExecutionDecision = {
        verdict: 'REJECTED',
        reasons: errors,
        reasonCodes: ['VALIDATION_ERROR'],
        explanationSummary: `Request validation failed: ${errors.join('; ')}`,
        decidedAt: new Date().toISOString(),
        decidedBy: 'SCHEMA_VALIDATOR',
        ruleTraces: [],
      };
      execution.decision = decision;
      StateMachine.transition(
        execution,
        'REJECTED',
        `Validation failed: ${errors.length} schema violations detected`,
        'SCHEMA_VALIDATOR',
        stage.id
      );
      return { status: 'FAILED', decision };
    }

    return { status: 'SUCCESS', nextStageId: stage.nextStage || stage.onSuccessStage };
  }

  /**
   * Execute external enrichment stage with retries & chaos tolerance
   */
  public async executeEnrichment(
    execution: WorkflowExecution,
    stage: StageDefinition,
    chaosOverride?: ChaosMode,
    onRetry?: (log: RetryAttemptLog) => Promise<void>
  ): Promise<StageExecutionResult> {
    const serviceName = stage.serviceName || 'credit_bureau';
    const retryPolicy = stage.retryPolicy || {
      maxAttempts: 3,
      initialDelayMs: 40,
      backoffMultiplier: 1.5,
    };

    execution.retryState = {
      currentAttempt: 1,
      maxAttempts: retryPolicy.maxAttempts,
      stageId: stage.id,
    };

    const retryResult = await executeWithRetry(
      async (attempt) => {
        execution.retryState.currentAttempt = attempt;
        return await this.externalService.callService(
          serviceName,
          { ...execution.input, ...execution.context },
          chaosOverride
        );
      },
      retryPolicy,
      async (log) => {
        execution.retryState.lastError = log.error.message;
        if (onRetry) await onRetry(log);
      }
    );

    if (!retryResult.success) {
      const err = retryResult.error || new Error(`Enrichment failed for service ${serviceName}`);
      execution.retryState.lastError = err.message;

      const decision: ExecutionDecision = {
        verdict: 'FAILED',
        reasons: [err.message],
        reasonCodes: ['EXTERNAL_DEPENDENCY_FAILURE'],
        explanationSummary: `Stage '${stage.name}' failed after ${retryResult.attemptsMade} attempts: ${err.message}`,
        decidedAt: new Date().toISOString(),
        decidedBy: 'DEPENDENCY_ENRICHER',
        ruleTraces: [],
      };
      execution.decision = decision;

      StateMachine.transition(
        execution,
        'FAILED',
        `External dependency '${serviceName}' failed after ${retryResult.attemptsMade} retry attempts: ${err.message}`,
        'SYSTEM',
        stage.id
      );

      return {
        status: 'FAILED',
        error: err,
        decision,
      };
    }

    // Merge enrichment data into execution context
    const enrichedData = retryResult.result || {};
    execution.context[serviceName] = enrichedData;
    execution.context = { ...execution.context, ...enrichedData };

    return {
      status: 'SUCCESS',
      nextStageId: stage.nextStage || stage.onSuccessStage,
    };
  }

  /**
   * Execute rule evaluation stage
   */
  public async executeRuleEvaluation(
    execution: WorkflowExecution,
    stage: StageDefinition
  ): Promise<StageExecutionResult> {
    const rulesetId = stage.rulesetId;
    if (!rulesetId) {
      throw new Error(`Stage '${stage.id}' is missing required 'rulesetId'`);
    }

    const ruleset = await this.store.getRuleset(rulesetId);
    if (!ruleset) {
      throw new Error(`Ruleset '${rulesetId}' was not found in registry`);
    }

    // Combine input and enriched context for evaluation
    const evaluationData = {
      ...execution.input,
      ...execution.context,
      enrichment: execution.context,
    };

    const evalResult = evaluateRuleset(ruleset, evaluationData);

    // Record rule traces
    execution.ruleTraces.push(...evalResult.ruleTraces);

    // Apply mutations if any
    if (Object.keys(evalResult.mutations).length > 0) {
      execution.context = { ...execution.context, ...evalResult.mutations };
    }

    // Map verdict to decision and state transitions
    if (evalResult.verdict === 'REJECTED') {
      const rejections = evalResult.triggeredActions.filter((a) => a.type === 'REJECT');
      const decision: ExecutionDecision = {
        verdict: 'REJECTED',
        reasons: rejections.map((r) => r.reasonMessage),
        reasonCodes: rejections.map((r) => r.reasonCode),
        explanationSummary: evalResult.summaryExplanation,
        decidedAt: new Date().toISOString(),
        decidedBy: 'RULE_ENGINE',
        ruleTraces: evalResult.ruleTraces,
      };
      execution.decision = decision;
      StateMachine.transition(
        execution,
        'REJECTED',
        evalResult.summaryExplanation,
        'RULE_ENGINE',
        stage.id
      );
      return { status: 'SUCCESS', decision, nextStageId: stage.transitions?.['REJECTED'] };
    }

    if (evalResult.verdict === 'MANUAL_REVIEW_REQUIRED') {
      const reviewTriggers = evalResult.triggeredActions.filter((a) => a.type === 'REQUIRE_MANUAL_REVIEW');
      execution.manualReview = {
        requestedAt: new Date().toISOString(),
        reasonCodes: reviewTriggers.map((r) => r.reasonCode),
        reasons: reviewTriggers.map((r) => r.reasonMessage),
        requiredAttentionItems: reviewTriggers.map(
          (r) => `${r.reasonCode}: ${r.reasonMessage}`
        ),
      };

      const decision: ExecutionDecision = {
        verdict: 'MANUAL_REVIEW_REQUIRED',
        reasons: reviewTriggers.map((r) => r.reasonMessage),
        reasonCodes: reviewTriggers.map((r) => r.reasonCode),
        explanationSummary: evalResult.summaryExplanation,
        decidedAt: new Date().toISOString(),
        decidedBy: 'RULE_ENGINE',
        ruleTraces: evalResult.ruleTraces,
      };
      execution.decision = decision;

      StateMachine.transition(
        execution,
        'PENDING_REVIEW',
        evalResult.summaryExplanation,
        'RULE_ENGINE',
        stage.id
      );
      return { status: 'PAUSED', decision };
    }

    // APPROVED
    const approvals = evalResult.triggeredActions.filter((a) => a.type === 'APPROVE');
    const reasons = approvals.length > 0
      ? approvals.map((a) => a.reasonMessage)
      : ['All evaluation rules satisfied successfully.'];
    const reasonCodes = approvals.length > 0
      ? approvals.map((a) => a.reasonCode)
      : ['CRITERIA_SATISFIED'];

    const decision: ExecutionDecision = {
      verdict: 'APPROVED',
      reasons,
      reasonCodes,
      explanationSummary: evalResult.summaryExplanation,
      decidedAt: new Date().toISOString(),
      decidedBy: 'RULE_ENGINE',
      ruleTraces: evalResult.ruleTraces,
    };
    execution.decision = decision;

    StateMachine.transition(
      execution,
      'APPROVED',
      evalResult.summaryExplanation,
      'RULE_ENGINE',
      stage.id
    );

    return { status: 'SUCCESS', decision, nextStageId: stage.transitions?.['APPROVED'] };
  }
}
