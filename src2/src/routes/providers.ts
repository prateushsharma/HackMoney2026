import { Router } from 'express';
import { YellowService } from '../services/YellowService';

const router = Router();

// Mock provider registry
const providers: any[] = [];

/**
 * POST /api/providers/register
 * Register as a liquidity provider
 */
router.post('/register', (req, res) => {
  try {
    const { address, collateral, feeRate } = req.body;
    
    if (!address || !collateral || !feeRate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const provider = {
      address,
      collateral,
      feeRate, // in basis points (e.g., 100 = 1%)
      active: true,
      timestamp: Date.now(),
    };
    
    providers.push(provider);
    
    console.log(`Provider registered: ${address}`);
    
    res.json({
      success: true,
      provider,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/providers
 * Get all registered providers
 */
router.get('/', (req, res) => {
  try {
    const activeProviders = providers.filter(p => p.active);
    
    res.json({
      count: activeProviders.length,
      providers: activeProviders,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/providers/quote
 * Request quotes from providers
 */
router.post('/quote', (req, res) => {
  try {
    const { rwaToken, amount, type } = req.body;
    
    if (!rwaToken || !amount || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Simulate provider competition
    const quotes = providers
      .filter(p => p.active)
      .map(p => ({
        provider: p.address,
        feeRate: p.feeRate,
        quote: (parseFloat(amount) * (1 + p.feeRate / 10000)).toString(),
        timestamp: Date.now(),
      }))
      .sort((a, b) => parseFloat(a.quote) - parseFloat(b.quote)); // Best quote first
    
    res.json({
      quotes,
      bestQuote: quotes[0] || null,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/providers/:address/balances
 * Get provider balances from Yellow
 */
router.get('/:address/balances', async (req, res) => {
  try {
    const { address } = req.params;
    
    const yellow = YellowService.getInstance();
    
    if (!yellow.isConnected()) {
      return res.status(503).json({ error: 'Yellow Network not connected' });
    }
    
    const balances = await yellow.getLedgerBalances(address);
    
    res.json({
      address,
      balances,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as providerRoutes };
