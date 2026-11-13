export type WorkflowState =
  | 'SUBMITTED'
  | 'VALIDATING'
  | 'ENRICHING'
  | 'EVALUATING'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETRYING'
  | 'FAILED';

export type StageType =
  | 'VALIDATION'
  | 'ENRICHMENT'
  | 'RULE_EVALUATION'
  | 'DECISION_ROUTING'
  | 'MANUAL_REVIEW';

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  retryableErrorCodes?: string[];
}

export interface StageDefinition {
  id: string;
  name: string;
  type: StageType;
  description?: string;
  serviceName?: string;
  serviceConfig?: Record<string, any>;
  rulesetId?: string;
  retryPolicy?: RetryPolicy;
  nextStage?: string;
  onSuccessStage?: string;
  onFailureStage?: string;
  transitions?: Record<string, string>;
}

export interface FieldValidationRule {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  min?: number;
  max?: number;
  regex?: string;
  enum?: (string | number)[];
  description?: string;
}

export interface SchemaDefinition {
  fields: Record<string, FieldValidationRule>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  schema: SchemaDefinition;
  initialStage: string;
  stages: StageDefinition[];
  rulesetIds?: string[];
  metadata?: Record<string, any>;
}
