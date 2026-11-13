import { Router, Request, Response } from 'express';
import { InMemoryStore } from '../../storage/in-memory-store.js';
import { WorkflowDefinition } from '../../domain/workflow.types.js';
import { RulesetDefinition } from '../../domain/rule.types.js';

export const workflowRouter = Router();
const store = InMemoryStore.getInstance();

/**
 * GET /api/workflows - List all workflows
 */
workflowRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const workflows = await store.findAll();
    res.json({
      success: true,
      count: workflows.length,
      data: workflows,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/workflows/:id - Get specific workflow by ID and optional version
 */
workflowRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { version } = req.query;

    let workflow: WorkflowDefinition | undefined;
    if (typeof version === 'string') {
      workflow = await store.findByIdAndVersion(id, version);
    } else {
      workflow = await store.findById(id);
    }

    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: `Workflow '${id}' (version: ${version || 'latest'}) was not found.`,
      });
    }

    res.json({ success: true, data: workflow });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/workflows - Register or update a workflow & ruleset dynamically
 */
workflowRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { workflow, ruleset } = req.body;

    if (!workflow || !workflow.id || !workflow.version || !workflow.stages) {
      return res.status(400).json({
        success: false,
        error: 'Invalid workflow definition: must contain id, version, and stages.',
      });
    }

    await store.save(workflow);

    if (ruleset && ruleset.id && ruleset.rules) {
      await store.saveRuleset(ruleset);
    }

    res.status(201).json({
      success: true,
      message: `Workflow '${workflow.id}' (v${workflow.version}) registered successfully.`,
      data: { workflow, ruleset },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
