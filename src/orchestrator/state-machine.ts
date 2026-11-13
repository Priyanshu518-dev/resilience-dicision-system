import { WorkflowState } from '../domain/workflow.types.js';
import { StateTransitionRecord, WorkflowExecution } from '../domain/execution.types.js';

export class InvalidStateTransitionError extends Error {
  constructor(fromState: WorkflowState, toState: WorkflowState, reason?: string) {
    super(
      `Illegal state transition from "${fromState}" to "${toState}". ${reason || ''}`
    );
    this.name = 'InvalidStateTransitionError';
  }
}

export class StateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
    SUBMITTED: ['VALIDATING', 'FAILED'],
    VALIDATING: ['VALIDATING', 'ENRICHING', 'EVALUATING', 'REJECTED', 'FAILED'],
    ENRICHING: ['ENRICHING', 'EVALUATING', 'RETRYING', 'FAILED'],
    RETRYING: ['ENRICHING', 'FAILED'],
    EVALUATING: ['EVALUATING', 'APPROVED', 'REJECTED', 'PENDING_REVIEW', 'FAILED'],
    PENDING_REVIEW: ['APPROVED', 'REJECTED', 'FAILED'],
    APPROVED: [], // Terminal
    REJECTED: [], // Terminal
    FAILED: ['RETRYING'], // Can be manually retried
  };

  /**
   * Check if transition is valid
   */
  public static canTransition(from: WorkflowState, to: WorkflowState): boolean {
    const allowed = this.ALLOWED_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  /**
   * Transition an execution to a new state and record the transition event
   */
  public static transition(
    execution: WorkflowExecution,
    toState: WorkflowState,
    reason: string,
    actor = 'SYSTEM',
    stageId?: string,
    metadata?: Record<string, any>
  ): StateTransitionRecord {
    const fromState = execution.state;

    if (!this.canTransition(fromState, toState)) {
      throw new InvalidStateTransitionError(
        fromState,
        toState,
        `Stage: ${stageId || 'unknown'}, Actor: ${actor}`
      );
    }

    const record: StateTransitionRecord = {
      fromState,
      toState,
      timestamp: new Date().toISOString(),
      stageId: stageId || execution.currentStageId,
      reason,
      actor,
      metadata,
    };

    execution.state = toState;
    execution.stateHistory.push(record);
    execution.updatedAt = new Date().toISOString();

    if (['APPROVED', 'REJECTED', 'FAILED'].includes(toState)) {
      execution.completedAt = new Date().toISOString();
    }

    return record;
  }
}
