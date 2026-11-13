import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryStore } from '../storage/in-memory-store.js';
import { loadDefaultWorkflows } from '../config/load-workflows.js';
import { workflowRouter } from './routes/workflow.routes.js';
import { executionRouter } from './routes/execution.routes.js';
import { chaosRouter } from './routes/chaos.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const store = InMemoryStore.getInstance();

// Bootstrap pre-configured business workflows
loadDefaultWorkflows(store);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve static frontend files
const staticPath = path.resolve(__dirname, '../ui/public');
app.use(express.static(staticPath));

// API Routes
app.use('/api/workflows', workflowRouter);
app.use('/api', executionRouter);
app.use('/api/chaos', chaosRouter);

// Health check endpoint
app.get('/api/health', async (_req: Request, res: Response) => {
  const workflows = await store.findAll();
  const executions = await store.findAllExecutions();
  res.json({
    status: 'HEALTHY',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    metrics: {
      registeredWorkflows: workflows.length,
      totalExecutions: executions.length,
      pendingManualReviews: executions.filter((e) => e.state === 'PENDING_REVIEW').length,
    },
  });
});

// Interactive API Documentation Summary
app.get('/api/docs', (_req: Request, res: Response) => {
  res.json({
    title: 'Resilient Decision System API Documentation',
    version: '1.0.0',
    description: 'REST API endpoints for configurable workflow execution, rules evaluation, state tracking, and resilience testing.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/workflows',
        summary: 'List all registered workflow definitions and versions',
      },
      {
        method: 'GET',
        path: '/api/workflows/:id',
        summary: 'Retrieve workflow definition by ID (optional query: ?version=1.0.0)',
      },
      {
        method: 'POST',
        path: '/api/workflows',
        summary: 'Register or dynamically update a workflow & ruleset via JSON config',
      },
      {
        method: 'POST',
        path: '/api/workflows/:id/execute',
        summary: 'Execute a decision workflow with payload (Supports Idempotency-Key header)',
      },
      {
        method: 'GET',
        path: '/api/executions',
        summary: 'List all workflow executions (optional query: ?state=PENDING_REVIEW&workflowId=loan-approval)',
      },
      {
        method: 'GET',
        path: '/api/executions/:id',
        summary: 'Fetch full state, decisions, and history of an execution',
      },
      {
        method: 'GET',
        path: '/api/executions/:id/audit',
        summary: 'Fetch complete explainable audit trail and rule evaluation trace',
      },
      {
        method: 'POST',
        path: '/api/executions/:id/review',
        summary: 'Submit manual reviewer decision (verdict: APPROVED | REJECTED)',
      },
      {
        method: 'POST',
        path: '/api/executions/:id/retry',
        summary: 'Manually retry a failed execution',
      },
      {
        method: 'GET',
        path: '/api/chaos',
        summary: 'View simulated external dependency chaos settings',
      },
      {
        method: 'POST',
        path: '/api/chaos',
        summary: 'Inject chaos modes: HEALTHY | TRANSIENT_FAILURE | PERMANENT_FAILURE | TIMEOUT | RATE_LIMIT',
      },
      {
        method: 'POST',
        path: '/api/chaos/reset',
        summary: 'Reset chaos injection to default healthy state',
      },
      {
        method: 'GET',
        path: '/api/health',
        summary: 'Healthcheck and platform metrics',
      },
    ],
  });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Resilient Decision Platform running on http://localhost:${port}`);
    console.log(`📊 Interactive UI Dashboard: http://localhost:${port}`);
    console.log(`📖 API Documentation: http://localhost:${port}/api/docs`);
    console.log(`=======================================================`);
  });
}

// Start if launched directly
const isDirectRun = process.argv[1] && process.argv[1].endsWith('server.ts');
if (isDirectRun || process.env.AUTO_START === 'true') {
  startServer();
}
