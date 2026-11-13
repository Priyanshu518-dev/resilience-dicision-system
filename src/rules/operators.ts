import { RuleOperator } from '../domain/rule.types.js';

export function evaluateOperator(
  actual: any,
  operator: RuleOperator,
  expected: any
): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected;

    case 'neq':
      return actual !== expected;

    case 'gt':
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      return actual > expected;

    case 'gte':
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      return actual >= expected;

    case 'lt':
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      return actual < expected;

    case 'lte':
      if (typeof actual !== 'number' || typeof expected !== 'number') return false;
      return actual <= expected;

    case 'in':
      if (Array.isArray(expected)) {
        return expected.includes(actual);
      }
      if (typeof expected === 'string' && typeof actual === 'string') {
        return expected.includes(actual);
      }
      return false;

    case 'not_in':
      if (Array.isArray(expected)) {
        return !expected.includes(actual);
      }
      return true;

    case 'contains':
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      if (typeof actual === 'string') {
        return actual.toLowerCase().includes(String(expected).toLowerCase());
      }
      return false;

    case 'regex':
      try {
        const re = new RegExp(expected);
        return re.test(String(actual));
      } catch {
        return false;
      }

    case 'exists':
      if (expected === false) {
        return actual === undefined || actual === null || actual === '';
      }
      return actual !== undefined && actual !== null && actual !== '';

    case 'between':
      if (Array.isArray(expected) && expected.length === 2) {
        const [min, max] = expected;
        if (typeof actual !== 'number' || typeof min !== 'number' || typeof max !== 'number') {
          return false;
        }
        return actual >= min && actual <= max;
      }
      return false;

    default:
      return false;
  }
}

export function formatOperatorExplanation(
  fieldName: string,
  actual: any,
  operator: RuleOperator,
  expected: any,
  passed: boolean
): string {
  const actualStr = actual === undefined ? 'undefined' : JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);

  if (passed) {
    switch (operator) {
      case 'eq': return `${fieldName} (${actualStr}) equals ${expectedStr}`;
      case 'neq': return `${fieldName} (${actualStr}) does not equal ${expectedStr}`;
      case 'gt': return `${fieldName} (${actualStr}) is greater than ${expectedStr}`;
      case 'gte': return `${fieldName} (${actualStr}) meets or exceeds minimum threshold ${expectedStr}`;
      case 'lt': return `${fieldName} (${actualStr}) is below threshold ${expectedStr}`;
      case 'lte': return `${fieldName} (${actualStr}) is within upper limit ${expectedStr}`;
      case 'in': return `${fieldName} (${actualStr}) is within allowed set ${expectedStr}`;
      case 'not_in': return `${fieldName} (${actualStr}) is not in restricted set ${expectedStr}`;
      case 'contains': return `${fieldName} (${actualStr}) contains ${expectedStr}`;
      case 'regex': return `${fieldName} matches required pattern ${expectedStr}`;
      case 'exists': return `${fieldName} is present and valid`;
      case 'between': return `${fieldName} (${actualStr}) is within range [${expected[0]} - ${expected[1]}]`;
      default: return `${fieldName} satisfies ${operator} condition`;
    }
  } else {
    switch (operator) {
      case 'eq': return `${fieldName} (${actualStr}) does not match expected value ${expectedStr}`;
      case 'neq': return `${fieldName} (${actualStr}) is unexpectedly equal to ${expectedStr}`;
      case 'gt': return `${fieldName} (${actualStr}) is not greater than ${expectedStr}`;
      case 'gte': return `${fieldName} (${actualStr}) is below required minimum ${expectedStr}`;
      case 'lt': return `${fieldName} (${actualStr}) is not less than ${expectedStr}`;
      case 'lte': return `${fieldName} (${actualStr}) exceeds maximum limit ${expectedStr}`;
      case 'in': return `${fieldName} (${actualStr}) is not in allowed set ${expectedStr}`;
      case 'not_in': return `${fieldName} (${actualStr}) is found in prohibited set ${expectedStr}`;
      case 'contains': return `${fieldName} (${actualStr}) does not contain required substring ${expectedStr}`;
      case 'regex': return `${fieldName} (${actualStr}) does not match pattern ${expectedStr}`;
      case 'exists': return `${fieldName} is missing or null`;
      case 'between': return `${fieldName} (${actualStr}) is outside allowed range [${expected[0]} - ${expected[1]}]`;
      default: return `${fieldName} fails ${operator} condition against ${expectedStr}`;
    }
  }
}
