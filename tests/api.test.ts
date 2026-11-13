import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/api/server.js';
import { Server } from 'node:http';

describe('REST API Endpoints Integration Test Suite', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address() as any;
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });

    return () => {
      server.close();
    };
  });

  it('GET /api/health - should return healthy status and metrics', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('HEALTHY');
    expect(body.metrics.registeredWorkflows).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/workflows - should list loaded workflows', async () => {
    const res = await fetch(`${baseUrl}/api/workflows`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(4);
  });

  it('POST /api/workflows/loan-approval/execute - should execute decision workflow via HTTP', async () => {
    const payload = {
      applicantName: 'HTTP Test User',
      requestedAmount: 22000,
      annualIncome: 90000,
      employmentStatus: 'EMPLOYED',
      creditScore: 760,
    };

    const res = await fetch(`${baseUrl}/api/workflows/loan-approval/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'http-test-key-101',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.state).toBe('APPROVED');
    expect(body.data.decision.verdict).toBe('APPROVED');

    // Duplicate call with same idempotency key
    const replayRes = await fetch(`${baseUrl}/api/workflows/loan-approval/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'http-test-key-101',
      },
      body: JSON.stringify(payload),
    });

    expect(replayRes.status).toBe(200);
    expect(replayRes.headers.get('x-idempotent-replay')).toBe('true');
  });

  it('GET /api/executions/:id/audit - should return audit timeline and explainability report', async () => {
    // 1. Submit an execution
    const execRes = await fetch(`${baseUrl}/api/workflows/loan-approval/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicantName: 'Audit Test Applicant',
        requestedAmount: 18000,
        annualIncome: 75000,
        employmentStatus: 'EMPLOYED',
        creditScore: 710,
      }),
    });
    const execJson = await execRes.json();
    const executionId = execJson.data.id;

    // 2. Fetch Audit Trail
    const auditRes = await fetch(`${baseUrl}/api/executions/${executionId}/audit`);
    expect(auditRes.status).toBe(200);
    const auditData = await auditRes.json();
    expect(auditData.executionId).toBe(executionId);
    expect(auditData.auditTimeline.length).toBeGreaterThanOrEqual(3);
    expect(auditData.ruleTraces.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/chaos - should update and reset external dependency chaos', async () => {
    // Configure chaos
    const setRes = await fetch(`${baseUrl}/api/chaos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'TRANSIENT_FAILURE', transientFailuresRemaining: 3 }),
    });
    expect(setRes.status).toBe(200);
    const setJson = await setRes.json();
    expect(setJson.data.mode).toBe('TRANSIENT_FAILURE');

    // Reset chaos
    const resetRes = await fetch(`${baseUrl}/api/chaos/reset`, { method: 'POST' });
    expect(resetRes.status).toBe(200);
    const resetJson = await resetRes.json();
    expect(resetJson.data.mode).toBe('HEALTHY');
  });
});
