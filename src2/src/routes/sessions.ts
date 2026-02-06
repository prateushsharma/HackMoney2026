import { Router } from 'express';
import { SwapOrchestrator } from '../services/SwapOrchestrator';
import { YellowService } from '../services/YellowService';

const router = Router();
const orchestrator = new SwapOrchestrator();

/**
 * POST /api/sessions/create
 * Create a multi-party swap session using Yellow
 */
router.post('/create', async (req, res) => {
  try {
    const { executionPlan } = req.body;
    
    if (!executionPlan) {
      return res.status(400).json({ error: 'executionPlan required' });
    }
    
    console.log(`Creating swap session for plan ${executionPlan.id}`);
    
    const yellowSessionId = await orchestrator.createSwapSession(executionPlan);
    
    res.json({
      success: true,
      yellowSessionId,
      executionPlanId: executionPlan.id,
      message: 'Yellow app session created with NitroRPC/0.4',
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/sessions/:executionPlanId/lock
 * Lock funds in the session (optional explicit step)
 */
router.post('/:executionPlanId/lock', async (req, res) => {
  try {
    const { executionPlanId } = req.params;
    
    await orchestrator.lockFunds(executionPlanId);
    
    res.json({
      success: true,
      message: 'Funds locked using OPERATE intent',
    });
  } catch (error) {
    console.error('Error locking funds:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/sessions/:executionPlanId/finalize
 * Finalize swap with net settlement
 */
router.post('/:executionPlanId/finalize', async (req, res) => {
  try {
    const { executionPlanId } = req.params;
    
    await orchestrator.finalizeSwap(executionPlanId);
    
    res.json({
      success: true,
      message: 'Swap finalized with net settlement (OPERATE intent)',
    });
  } catch (error) {
    console.error('Error finalizing swap:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/sessions/:executionPlanId/close
 * Close Yellow session and distribute funds
 */
router.post('/:executionPlanId/close', async (req, res) => {
  try {
    const { executionPlanId } = req.params;
    
    await orchestrator.closeSession(executionPlanId);
    
    res.json({
      success: true,
      message: 'Yellow session closed, funds distributed',
    });
  } catch (error) {
    console.error('Error closing session:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions/:executionPlanId
 * Get session status
 */
router.get('/:executionPlanId', (req, res) => {
  try {
    const { executionPlanId } = req.params;
    const session = orchestrator.getSwapSession(executionPlanId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(session);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions
 * Get all active sessions
 */
router.get('/', (req, res) => {
  try {
    const sessions = orchestrator.getAllSwapSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions/yellow/active
 * Get active Yellow app sessions
 */
router.get('/yellow/active', (req, res) => {
  try {
    const yellow = YellowService.getInstance();
    const sessions = yellow.getAllActiveSessions();
    
    res.json({ 
      count: sessions.length,
      sessions 
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions/yellow/:sessionId
 * Get specific Yellow app session
 */
router.get('/yellow/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const yellow = YellowService.getInstance();
    const session = yellow.getActiveSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Yellow session not found' });
    }
    
    res.json(session);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as sessionRoutes };
