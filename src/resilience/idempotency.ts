import crypto from 'node:crypto';

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  executionId: string;
  workflowId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt?: string;
  responsePayload?: any;
}

export class IdempotencyConflictError extends Error {
  public readonly key: string;
  public readonly existingFingerprint: string;
  public readonly incomingFingerprint: string;

  constructor(key: string, existingFingerprint: string, incomingFingerprint: string) {
    super(
      `Idempotency conflict: key "${key}" was previously used with a different request payload.`
    );
    this.name = 'IdempotencyConflictError';
    this.key = key;
    this.existingFingerprint = existingFingerprint;
    this.incomingFingerprint = incomingFingerprint;
  }
}

/**
 * Computes deterministic SHA-256 fingerprint for request payload
 */
export function computeFingerprint(payload: any): string {
  const normalized = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export class IdempotencyManager {
  private records: Map<string, IdempotencyRecord> = new Map();

  /**
   * Acquire or check an idempotency record.
   * If existing completed request matches fingerprint, returns record.
   * If fingerprint mismatches, throws IdempotencyConflictError.
   * If new, registers record in IN_PROGRESS state.
   */
  public acquire(
    key: string,
    payload: any,
    executionId: string,
    workflowId: string
  ): { isReplay: boolean; record: IdempotencyRecord } {
    const fingerprint = computeFingerprint(payload);
    const existing = this.records.get(key);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(key, existing.fingerprint, fingerprint);
      }
      return { isReplay: true, record: existing };
    }

    const newRecord: IdempotencyRecord = {
      key,
      fingerprint,
      executionId,
      workflowId,
      status: 'IN_PROGRESS',
      createdAt: new Date().toISOString(),
    };

    this.records.set(key, newRecord);
    return { isReplay: false, record: newRecord };
  }

  /**
   * Complete the idempotency record with execution output
   */
  public complete(key: string, responsePayload: any): void {
    const record = this.records.get(key);
    if (record) {
      record.status = 'COMPLETED';
      record.completedAt = new Date().toISOString();
      record.responsePayload = responsePayload;
      if (responsePayload && responsePayload.id) {
        record.executionId = responsePayload.id;
      }
    }
  }

  /**
   * Mark as failed
   */
  public fail(key: string): void {
    const record = this.records.get(key);
    if (record) {
      record.status = 'FAILED';
    }
  }

  public getRecord(key: string): IdempotencyRecord | undefined {
    return this.records.get(key);
  }

  public clear(): void {
    this.records.clear();
  }
}
