import { Router, Request, Response } from 'express';
import { WorkflowOrchestrator } from '../../orchestrator/workflow-orchestrator.js';
import { InMemoryStore } from '../../storage/in-memory-store.js';
import { IdempotencyConflictError } from '../../resilience/idempotency.js';
import { ChaosMode } from '../../resilience/external-service-simulator.js';

export const executionRouter = Router();
const orchestrator = new WorkflowOrchestrator();
const store = InMemoryStore.getInstance();

export function getOrchestrator(): WorkflowOrchestrator {
  return orchestrator;
}

/**
 * POST /api/workflows/:id/execute - Trigger execution of a workflow
 */
executionRouter.post('/workflows/:id/execute', async (req: Request, res: Response) => {
  try {
    const { id: workflowId } = req.params;
    const { version, ...payload } = req.body;

    const idempotencyKey =
      (req.headers['idempotency-key'] as string) ||
      (req.headers['x-idempotency-key'] as string) ||
      undefined;

    const chaosOverride =
      (req.headers['x-simulate-chaos'] as ChaosMode) ||
      (req.query.chaos as ChaosMode) ||
      undefined;

    const execution = await orchestrator.executeWorkflow(workflowId, payload, {
      version: typeof version === 'string' ? version : undefined,
      idempotencyKey,
      chaosOverride,
    });

    const isIdempotentReplay = idempotencyKey && execution.idempotencyKey === idempotencyKey &&
      orchestrator.getIdempotencyManager().getRecord(idempotencyKey)?.status === 'COMPLETED';

    if (isIdempotentReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }

    res.status(200).json({
      success: true,
      idempotentReplay: Boolean(isIdempotentReplay),
      data: execution,
    });
  } catch (err: any) {
    if (err instanceof IdempotencyConflictError) {
      return res.status(409).json({
        success: false,
        error: 'Idempotency Conflict',
        message: err.message,
        details: {
          key: err.key,
          existingFingerprint: err.existingFingerprint,
          incomingFingerprint: err.incomingFingerprint,
        },
      });
    }

    res.status(400).json({
      success: false,
      error: err.message || 'Execution error',
    });
  }
});

/**
 * GET /api/executions - List executions with optional filtering
 */
executionRouter.get('/executions', async (req: Request, res: Response) => {
  try {
    const { state, workflowId } = req.query;

    let executions = await store.findAllExecutions();

    if (typeof state === 'string') {
      executions = executions.filter((e) => e.state === state);
    }
    if (typeof workflowId === 'string') {
      executions = executions.filter((e) => e.workflowId === workflowId);
    }

    res.json({
      success: true,
      count: executions.length,
      data: executions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/executions/:id - Get specific execution by ID
 */
executionRouter.get('/executions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const execution = await store.findExecutionById(id);

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: `Execution '${id}' was not found.`,
      });
    }

    res.json({ success: true, data: execution });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/executions/:id/audit - Get full audit trail and explainable decision report
 */
executionRouter.get('/executions/:id/audit', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const execution = await store.findExecutionById(id);

    if (!execution) {
      return res.status(404).json({
        success: false,
        error: `Execution '${id}' was not found.`,
      });
    }

    const auditTrail = await store.findAuditByExecutionId(id);

    res.json({
      success: true,
      executionId: id,
      workflowId: execution.workflowId,
      version: execution.workflowVersion,
      finalState: execution.state,
      decision: execution.decision,
      ruleTraces: execution.ruleTraces,
      stateTransitions: execution.stateHistory,
      auditTimeline: auditTrail,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/executions/:id/review - Apply manual review decision
 */
executionRouter.post('/executions/:id/review', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reviewerId, verdict, notes } = req.body;

    if (!reviewerId || !verdict || !notes) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: 'reviewerId', 'verdict' ('APPROVED'|'REJECTED'), and 'notes'.",
      });
    }

    if (!['APPROVED', 'REJECTED'].includes(verdict)) {
      return res.status(400).json({
        success: false,
        error: "Invalid verdict: must be 'APPROVED' or 'REJECTED'.",
      });
    }

    const updated = await orchestrator.applyManualReview(id, reviewerId, verdict, notes);

    res.json({
      success: true,
      message: `Manual review applied by ${reviewerId}: ${verdict}`,
      data: updated,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/executions/:id/retry - Trigger manual retry for failed execution
 */
executionRouter.post('/executions/:id/retry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { chaosOverride } = req.body;

    const retried = await orchestrator.retryExecution(id, chaosOverride);

    res.json({
      success: true,
      message: `Execution '${id}' retried successfully`,
      data: retried,
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});
