import { Router, Request, Response } from 'express';
import { ExternalServiceSimulator, ChaosMode } from '../../resilience/external-service-simulator.js';

export const chaosRouter = Router();
const simulator = ExternalServiceSimulator.getInstance();

/**
 * GET /api/chaos - Get current chaos simulation configuration
 */
chaosRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: simulator.getConfig(),
    availableModes: ['HEALTHY', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'TIMEOUT', 'RATE_LIMIT'],
  });
});

/**
 * POST /api/chaos - Update chaos simulation configuration
 */
chaosRouter.post('/', (req: Request, res: Response) => {
  try {
    const { mode, transientFailuresRemaining, simulatedLatencyMs } = req.body;

    const allowedModes: ChaosMode[] = ['HEALTHY', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'TIMEOUT', 'RATE_LIMIT'];
    if (mode && !allowedModes.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: `Invalid chaos mode: must be one of [${allowedModes.join(', ')}]`,
      });
    }

    const updated = simulator.setChaosConfig({
      mode,
      transientFailuresRemaining: typeof transientFailuresRemaining === 'number' ? transientFailuresRemaining : undefined,
      simulatedLatencyMs: typeof simulatedLatencyMs === 'number' ? simulatedLatencyMs : undefined,
    });

    res.json({
      success: true,
      message: `Chaos configuration updated to mode '${updated.mode}'`,
      data: updated,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/chaos/reset - Reset chaos simulation to default healthy state
 */
chaosRouter.post('/reset', (_req: Request, res: Response) => {
  simulator.resetChaos();
  res.json({
    success: true,
    message: 'Chaos simulation reset to HEALTHY',
    data: simulator.getConfig(),
  });
});
