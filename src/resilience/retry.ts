import { RetryPolicy } from '../domain/workflow.types.js';

export interface RetryAttemptLog {
  attempt: number;
  delayMs: number;
  error: Error;
  timestamp: string;
}

export interface RetryExecutionResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attemptsMade: number;
  attemptLogs: RetryAttemptLog[];
}

/**
 * Execute an asynchronous function with exponential backoff and jitter
 */
export async function executeWithRetry<T>(
  action: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  onRetryAttempt?: (attemptLog: RetryAttemptLog) => Promise<void> | void
): Promise<RetryExecutionResult<T>> {
  const attemptLogs: RetryAttemptLog[] = [];
  let attempt = 0;

  while (attempt < policy.maxAttempts) {
    attempt++;
    try {
      const result = await action(attempt);
      return {
        success: true,
        result,
        attemptsMade: attempt,
        attemptLogs,
      };
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Calculate exponential backoff with jitter
      const baseDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
      const jitter = Math.floor(Math.random() * (baseDelay * 0.2)); // 20% jitter
      const delayMs = baseDelay + jitter;

      const log: RetryAttemptLog = {
        attempt,
        delayMs,
        error,
        timestamp: new Date().toISOString(),
      };
      attemptLogs.push(log);

      if (onRetryAttempt) {
        await onRetryAttempt(log);
      }

      // Check if we exhausted attempts
      if (attempt >= policy.maxAttempts) {
        return {
          success: false,
          error,
          attemptsMade: attempt,
          attemptLogs,
        };
      }

      // Sleep for backoff delay
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    success: false,
    error: new Error(`Exhausted all ${policy.maxAttempts} retry attempts`),
    attemptsMade: attempt,
    attemptLogs,
  };
}
