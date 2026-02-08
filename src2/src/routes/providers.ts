import { Router, Request, Response } from 'express';

const router = Router();

// In-memory provider registry
const providers = new Map<string, any>();

/**
 * POST /api/providers/register
 * Register as a liquidity provider
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { address, collateral, name } = req.body;

    if (!address || !collateral) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    const provider = {
      address,
      collateral,
      name: name || `Provider ${address.slice(0, 6)}`,
      status: 'active',
      registeredAt: new Date().toISOString(),
      totalSwaps: 0,
      totalVolume: '0'
    };

    providers.set(address, provider);

    console.log(`\n🏦 New provider registered: ${name}`);

    res.json({
      success: true,
      provider
    });

  } catch (error) {
    console.error('❌ Error registering provider:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to register provider',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/providers
 * Get all providers
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const allProviders = Array.from(providers.values());

    res.json({
      success: true,
      providers: allProviders,
      count: allProviders.length
    });

  } catch (error) {
    console.error('❌ Error getting providers:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get providers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/providers/:address
 * Get a specific provider
 */
router.get('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const provider = providers.get(address);

    if (!provider) {
      return res.status(404).json({ 
        success: false,
        error: 'Provider not found' 
      });
    }

    res.json({
      success: true,
      provider
    });

  } catch (error) {
    console.error('❌ Error getting provider:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get provider',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/providers/:address/quote
 * Submit a quote for an order
 */
router.post('/:address/quote', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { orderId, price, amount } = req.body;

    const provider = providers.get(address);
    if (!provider) {
      return res.status(404).json({ 
        success: false,
        error: 'Provider not found' 
      });
    }

    const quote = {
      id: `quote_${Date.now()}`,
      provider: address,
      orderId,
      price,
      amount,
      createdAt: new Date().toISOString()
    };

    console.log(`\n💱 Quote submitted by ${provider.name}`);

    res.json({
      success: true,
      quote
    });

  } catch (error) {
    console.error('❌ Error submitting quote:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to submit quote',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as providerRoutes };