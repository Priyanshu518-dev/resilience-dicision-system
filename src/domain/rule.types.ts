export type RuleOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'regex'
  | 'exists'
  | 'between';

export interface SingleFieldCondition {
  field: string;
  operator: RuleOperator;
  value: any;
  description?: string;
}

export interface CompoundCondition {
  all?: RuleCondition[];
  any?: RuleCondition[];
  none?: RuleCondition[];
}

export type RuleCondition = SingleFieldCondition | CompoundCondition;

export type RuleActionType =
  | 'APPROVE'
  | 'REJECT'
  | 'REQUIRE_MANUAL_REVIEW'
  | 'MUTATE'
  | 'FLAG';

export interface RuleAction {
  type: RuleActionType;
  reasonCode: string;
  reasonMessage: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  mutations?: Record<string, any>;
}

export interface RuleDefinition {
  id: string;
  name: string;
  description: string;
  condition: RuleCondition;
  action: RuleAction;
  priority?: number; // Higher number evaluated earlier
}

export interface RulesetDefinition {
  id: string;
  name: string;
  description?: string;
  evaluationMode: 'FIRST_MATCH' | 'ALL_MATCH' | 'ACCUMULATE';
  defaultAction?: RuleAction;
  rules: RuleDefinition[];
}

export interface RuleTrace {
  ruleId: string;
  ruleName: string;
  description: string;
  passed: boolean;
  evaluatedAt: string;
  field?: string;
  actualValue?: any;
  expectedValue?: any;
  operator?: RuleOperator;
  actionTriggered?: RuleAction;
  explanation: string;
  subTraces?: RuleTrace[];
}

export interface RulesetEvaluationResult {
  rulesetId: string;
  verdict: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW_REQUIRED' | 'NEUTRAL';
  triggeredActions: RuleAction[];
  ruleTraces: RuleTrace[];
  summaryExplanation: string;
  mutations: Record<string, any>;
}
