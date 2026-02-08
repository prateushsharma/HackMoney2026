import { Router, Request, Response } from 'express';
import { SwapOrchestrator, ExecutionPlan } from '../services/SwapOrchestrator';
import { YellowService } from '../services/YellowService';

const router = Router();
const orchestrator = new SwapOrchestrator();

/**
 * POST /api/sessions/create
 * Create a new multi-party RWA swap session
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    console.log('\n🔷 Received create session request');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { seller, provider, buyers, rwaToken, totalRwaAmount, totalUsdcAmount, providerFee } = req.body;

    // Validate input
    if (!seller || !provider || !buyers || buyers.length === 0) {
      console.log('❌ Validation failed - missing fields');
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    // Create execution plan
    const plan: ExecutionPlan = {
      id: `exec_${Date.now()}`,
      seller,
      provider,
      buyers,
      rwaToken,
      totalRwaAmount,
      totalUsdcAmount,
      providerFee,
      timestamp: Date.now()
    };

    console.log(`✅ Creating swap session for ${buyers.length + 2} participants`);
    
    // Create Yellow session
    const yellowSessionId = await orchestrator.createSwapSession(plan);

    const response = {
      success: true,
      planId: plan.id,
      yellowSessionId,
      participants: [seller, provider, ...buyers.map((b: any) => b.buyer)],
      status: 'created'
    };

    console.log('✅ Session created successfully:', response);
    
    res.json(response);

  } catch (error) {
    console.error('❌ Error creating session:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create session',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/sessions/:planId/lock
 * Lock funds for a swap session
 */
router.post('/:planId/lock', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;

    console.log(`\n🔒 Locking funds for plan: ${planId}`);
    
    await orchestrator.lockFunds(planId);

    res.json({
      success: true,
      planId,
      status: 'locked'
    });

  } catch (error) {
    console.error('❌ Error locking funds:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to lock funds',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/sessions/:planId/finalize
 * Finalize a swap session
 */
router.post('/:planId/finalize', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;

    console.log(`\n✅ Finalizing swap for plan: ${planId}`);
    
    await orchestrator.finalizeSwap(planId);

    res.json({
      success: true,
      planId,
      status: 'finalized'
    });

  } catch (error) {
    console.error('❌ Error finalizing swap:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to finalize swap',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/sessions/:planId/close
 * Close a swap session
 */
router.post('/:planId/close', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;

    console.log(`\n🔒 Closing session for plan: ${planId}`);
    
    await orchestrator.closeSwapSession(planId);

    res.json({
      success: true,
      planId,
      status: 'closed'
    });

  } catch (error) {
    console.error('❌ Error closing session:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to close session',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/sessions/:planId
 * Get execution plan details
 */
router.get('/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const plan = orchestrator.getExecutionPlan(planId);

    if (!plan) {
      return res.status(404).json({ 
        success: false,
        error: 'Plan not found' 
      });
    }

    res.json({
      success: true,
      plan
    });

  } catch (error) {
    console.error('❌ Error getting plan:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get plan',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/sessions/yellow/active
 * Get all active Yellow sessions
 */
router.get('/yellow/active', async (req: Request, res: Response) => {
  try {
    console.log('\n📊 Fetching active Yellow sessions');
    
    const yellowService = YellowService.getInstance();
    const activeSessions = yellowService.getActiveSessions();

    const sessions = Array.from(activeSessions.values()).map(session => ({
      id: session.app_session_id.slice(0, 20) + '...',
      yellowSessionId: session.app_session_id,
      status: session.status,
      participants: session.participants.length,
      protocol: session.protocol,
      version: session.version,
      created_at: session.created_at
    }));

    console.log(`✅ Found ${sessions.length} active sessions`);

    res.json({
      success: true,
      sessions,
      count: sessions.length
    });

  } catch (error) {
    console.error('❌ Error getting active sessions:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get active sessions',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/sessions
 * Get all execution plans
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const plans = orchestrator.getAllPlans();

    res.json({
      success: true,
      plans,
      count: plans.length
    });

  } catch (error) {
    console.error('❌ Error getting plans:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get plans',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as sessionRoutes };