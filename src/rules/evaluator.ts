import {
  RuleCondition,
  SingleFieldCondition,
  CompoundCondition,
  RuleDefinition,
  RulesetDefinition,
  RulesetEvaluationResult,
  RuleTrace,
  RuleAction,
} from '../domain/rule.types.js';
import { evaluateOperator, formatOperatorExplanation } from './operators.js';

/**
 * Safely access nested properties using dot notation (e.g. 'applicant.financials.creditScore')
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  if (!path) return undefined;

  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }

  return current;
}

/**
 * Evaluate a single or compound condition against the provided data context
 */
export function evaluateCondition(
  condition: RuleCondition,
  context: Record<string, any>
): { passed: boolean; explanation: string; subTraces?: RuleTrace[]; field?: string; actualValue?: any; expectedValue?: any; operator?: any } {
  // Check if it is a CompoundCondition
  const compound = condition as CompoundCondition;

  if (compound.all && Array.isArray(compound.all)) {
    const subTraces: RuleTrace[] = [];
    let allPassed = true;

    for (let i = 0; i < compound.all.length; i++) {
      const sub = compound.all[i];
      const res = evaluateCondition(sub, context);
      if (!res.passed) allPassed = false;

      subTraces.push({
        ruleId: `sub_all_${i + 1}`,
        ruleName: `All-Check #${i + 1}`,
        description: res.explanation,
        passed: res.passed,
        evaluatedAt: new Date().toISOString(),
        field: res.field,
        actualValue: res.actualValue,
        expectedValue: res.expectedValue,
        operator: res.operator,
        explanation: res.explanation,
        subTraces: res.subTraces,
      });
    }

    const failedCount = subTraces.filter((t) => !t.passed).length;
    const explanation = allPassed
      ? `All ${subTraces.length} sub-conditions met`
      : `${failedCount} of ${subTraces.length} sub-conditions failed`;

    return { passed: allPassed, explanation, subTraces };
  }

  if (compound.any && Array.isArray(compound.any)) {
    const subTraces: RuleTrace[] = [];
    let anyPassed = false;

    for (let i = 0; i < compound.any.length; i++) {
      const sub = compound.any[i];
      const res = evaluateCondition(sub, context);
      if (res.passed) anyPassed = true;

      subTraces.push({
        ruleId: `sub_any_${i + 1}`,
        ruleName: `Any-Check #${i + 1}`,
        description: res.explanation,
        passed: res.passed,
        evaluatedAt: new Date().toISOString(),
        field: res.field,
        actualValue: res.actualValue,
        expectedValue: res.expectedValue,
        operator: res.operator,
        explanation: res.explanation,
        subTraces: res.subTraces,
      });
    }

    const explanation = anyPassed
      ? `At least one condition satisfied in ANY group`
      : `None of ${subTraces.length} alternative conditions satisfied`;

    return { passed: anyPassed, explanation, subTraces };
  }

  if (compound.none && Array.isArray(compound.none)) {
    const subTraces: RuleTrace[] = [];
    let noneMatched = true;

    for (let i = 0; i < compound.none.length; i++) {
      const sub = compound.none[i];
      const res = evaluateCondition(sub, context);
      if (res.passed) noneMatched = false;

      subTraces.push({
        ruleId: `sub_none_${i + 1}`,
        ruleName: `None-Check #${i + 1}`,
        description: res.explanation,
        passed: !res.passed,
        evaluatedAt: new Date().toISOString(),
        field: res.field,
        actualValue: res.actualValue,
        expectedValue: res.expectedValue,
        operator: res.operator,
        explanation: res.explanation,
        subTraces: res.subTraces,
      });
    }

    const explanation = noneMatched
      ? `None of the prohibited conditions were triggered`
      : `One or more prohibited conditions were triggered`;

    return { passed: noneMatched, explanation, subTraces };
  }

  // SingleFieldCondition
  const single = condition as SingleFieldCondition;
  const actualValue = getNestedValue(context, single.field);
  const passed = evaluateOperator(actualValue, single.operator, single.value);
  const explanation = formatOperatorExplanation(
    single.field,
    actualValue,
    single.operator,
    single.value,
    passed
  );

  return {
    passed,
    explanation,
    field: single.field,
    actualValue,
    expectedValue: single.value,
    operator: single.operator,
  };
}

/**
 * Evaluate a complete ruleset against runtime context
 */
export function evaluateRuleset(
  ruleset: RulesetDefinition,
  context: Record<string, any>
): RulesetEvaluationResult {
  const sortedRules = [...ruleset.rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const ruleTraces: RuleTrace[] = [];
  const triggeredActions: RuleAction[] = [];
  const mutations: Record<string, any> = {};

  for (const rule of sortedRules) {
    const evalResult = evaluateCondition(rule.condition, context);

    const trace: RuleTrace = {
      ruleId: rule.id,
      ruleName: rule.name,
      description: rule.description,
      passed: evalResult.passed,
      evaluatedAt: new Date().toISOString(),
      field: evalResult.field,
      actualValue: evalResult.actualValue,
      expectedValue: evalResult.expectedValue,
      operator: evalResult.operator,
      explanation: evalResult.explanation,
      subTraces: evalResult.subTraces,
      actionTriggered: evalResult.passed ? rule.action : undefined,
    };

    ruleTraces.push(trace);

    if (evalResult.passed) {
      triggeredActions.push(rule.action);

      if (rule.action.mutations) {
        Object.assign(mutations, rule.action.mutations);
      }

      if (ruleset.evaluationMode === 'FIRST_MATCH') {
        break;
      }
    }
  }

  // Determine overall verdict
  let verdict: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW_REQUIRED' | 'NEUTRAL' = 'NEUTRAL';
  const rejections = triggeredActions.filter((a) => a.type === 'REJECT');
  const manualReviews = triggeredActions.filter((a) => a.type === 'REQUIRE_MANUAL_REVIEW');
  const approvals = triggeredActions.filter((a) => a.type === 'APPROVE');

  if (rejections.length > 0) {
    verdict = 'REJECTED';
  } else if (manualReviews.length > 0) {
    verdict = 'MANUAL_REVIEW_REQUIRED';
  } else if (approvals.length > 0) {
    verdict = 'APPROVED';
  } else if (ruleset.defaultAction) {
    triggeredActions.push(ruleset.defaultAction);
    if (ruleset.defaultAction.type === 'REJECT') verdict = 'REJECTED';
    else if (ruleset.defaultAction.type === 'REQUIRE_MANUAL_REVIEW') verdict = 'MANUAL_REVIEW_REQUIRED';
    else verdict = 'APPROVED';
  } else {
    // If no negative actions triggered, default to APPROVED
    verdict = 'APPROVED';
  }

  // Synthesize human-readable explanation summary
  const summaryExplanation = buildSummaryExplanation(verdict, triggeredActions, ruleTraces);

  return {
    rulesetId: ruleset.id,
    verdict,
    triggeredActions,
    ruleTraces,
    summaryExplanation,
    mutations,
  };
}

function buildSummaryExplanation(
  verdict: 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW_REQUIRED' | 'NEUTRAL',
  actions: RuleAction[],
  traces: RuleTrace[]
): string {
  if (verdict === 'REJECTED') {
    const rejections = actions.filter((a) => a.type === 'REJECT');
    const reasons = rejections.map((r) => `[${r.reasonCode}] ${r.reasonMessage}`).join('; ');
    return `Application was REJECTED. Failed criteria: ${reasons}`;
  }

  if (verdict === 'MANUAL_REVIEW_REQUIRED') {
    const reviews = actions.filter((a) => a.type === 'REQUIRE_MANUAL_REVIEW');
    const reasons = reviews.map((r) => `[${r.reasonCode}] ${r.reasonMessage}`).join('; ');
    return `Application escalated for MANUAL REVIEW. Review triggers: ${reasons}`;
  }

  if (verdict === 'APPROVED') {
    const passedChecks = traces.filter((t) => t.passed).length;
    return `Application APPROVED. Successfully met all requirements (${passedChecks} checks satisfied).`;
  }

  return 'Evaluation completed with neutral outcome.';
}
