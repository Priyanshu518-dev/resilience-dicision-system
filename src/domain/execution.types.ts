import { WorkflowState } from './workflow.types.js';
import { RuleTrace } from './rule.types.js';

export interface StateTransitionRecord {
  fromState: WorkflowState;
  toState: WorkflowState;
  timestamp: string;
  stageId?: string;
  reason: string;
  actor: string; // 'ENGINE' | 'ADMIN' | 'SYSTEM' | 'EXTERNAL_SERVICE'
  metadata?: Record<string, any>;
}

export interface ManualReviewRecord {
  requestedAt: string;
  reasonCodes: string[];
  reasons: string[];
  requiredAttentionItems: string[];
  reviewedAt?: string;
  reviewerId?: string;
  verdict?: 'APPROVED' | 'REJECTED';
  notes?: string;
}

export interface RetryState {
  currentAttempt: number;
  maxAttempts: number;
  lastError?: string;
  nextRetryAt?: string;
  stageId?: string;
}

export interface ExecutionDecision {
  verdict: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW_REQUIRED' | 'FAILED' | 'RETRYING';
  reasons: string[];
  reasonCodes: string[];
  explanationSummary: string;
  decidedAt: string;
  decidedBy: string;
  ruleTraces: RuleTrace[];
  outputData?: Record<string, any>;
}

export interface WorkflowExecution {
  id: string; // UUID
  workflowId: string;
  workflowVersion: string;
  idempotencyKey?: string;
  requestFingerprint?: string;
  state: WorkflowState;
  currentStageId: string;
  input: Record<string, any>;
  context: Record<string, any>; // Accumulates external data and calculations
  decision?: ExecutionDecision;
  manualReview?: ManualReviewRecord;
  stateHistory: StateTransitionRecord[];
  ruleTraces: RuleTrace[];
  retryState: RetryState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
