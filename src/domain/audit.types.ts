import { WorkflowState } from './workflow.types.js';

export type AuditEventType =
  | 'REQUEST_RECEIVED'
  | 'VALIDATION_PASSED'
  | 'VALIDATION_FAILED'
  | 'EXTERNAL_DEPENDENCY_CALLED'
  | 'EXTERNAL_DEPENDENCY_FAILED'
  | 'EXTERNAL_DEPENDENCY_RECOVERED'
  | 'RULE_EVALUATION_STARTED'
  | 'RULE_EVALUATION_COMPLETED'
  | 'MANUAL_REVIEW_REQUESTED'
  | 'MANUAL_REVIEW_COMPLETED'
  | 'STATE_TRANSITION'
  | 'IDEMPOTENT_HIT'
  | 'RETRY_SCHEDULED'
  | 'FINAL_DECISION';

export interface AuditLogEntry {
  id: string;
  executionId: string;
  timestamp: string;
  eventType: AuditEventType;
  stageId?: string;
  state?: WorkflowState;
  actor: string;
  summary: string;
  details?: Record<string, any>;
  ruleTraces?: any[];
  diff?: {
    before?: any;
    after?: any;
  };
}
