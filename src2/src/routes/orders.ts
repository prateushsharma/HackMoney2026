import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Mock order book storage (replace with database)
const orderBook: any[] = [];
const matchedOrders: any[] = [];

/**
 * POST /api/orders/sell
 * Create a sell order for RWA tokens
 */
router.post('/sell', (req, res) => {
  try {
    const { seller, rwaToken, amount, minPrice } = req.body;
    
    if (!seller || !rwaToken || !amount || !minPrice) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const order = {
      id: uuidv4(),
      type: 'sell',
      seller,
      rwaToken,
      amount,
      minPrice,
      status: 'open',
      timestamp: Date.now(),
    };
    
    orderBook.push(order);
    
    console.log(`Sell order created: ${order.id}`);
    
    res.json({
      success: true,
      order,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/orders/buy
 * Create a buy order for RWA tokens
 */
router.post('/buy', (req, res) => {
  try {
    const { buyer, rwaToken, amount, maxPrice } = req.body;
    
    if (!buyer || !rwaToken || !amount || !maxPrice) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const order = {
      id: uuidv4(),
      type: 'buy',
      buyer,
      rwaToken,
      amount,
      maxPrice,
      status: 'open',
      timestamp: Date.now(),
    };
    
    orderBook.push(order);
    
    console.log(`Buy order created: ${order.id}`);
    
    res.json({
      success: true,
      order,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/orders
 * Get all orders
 */
router.get('/', (req, res) => {
  try {
    const { status, type } = req.query;
    
    let filtered = orderBook;
    
    if (status) {
      filtered = filtered.filter(o => o.status === status);
    }
    
    if (type) {
      filtered = filtered.filter(o => o.type === type);
    }
    
    res.json({
      count: filtered.length,
      orders: filtered,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/orders/matched
 * Get matched orders (execution plans)
 */
router.get('/matched', (req, res) => {
  try {
    res.json({
      count: matchedOrders.length,
      matched: matchedOrders,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/orders/match
 * Match buy orders to sell orders
 */
router.post('/match', (req, res) => {
  try {
    const { sellOrderId } = req.body;
    
    if (!sellOrderId) {
      return res.status(400).json({ error: 'sellOrderId required' });
    }
    
    const sellOrder = orderBook.find(o => o.id === sellOrderId && o.type === 'sell');
    
    if (!sellOrder) {
      return res.status(404).json({ error: 'Sell order not found' });
    }
    
    // Find matching buy orders
    const buyOrders = orderBook.filter(
      o => o.type === 'buy' && 
           o.rwaToken === sellOrder.rwaToken && 
           o.status === 'open' &&
           parseFloat(o.maxPrice) >= parseFloat(sellOrder.minPrice)
    );
    
    if (buyOrders.length === 0) {
      return res.json({
        success: false,
        message: 'No matching buy orders found',
      });
    }
    
    // Create execution plan
    const executionPlan = {
      id: `exec_${uuidv4()}`,
      seller: sellOrder.seller,
      provider: '0xProvider', // Would come from provider competition
      buyers: buyOrders.map(b => ({
        buyer: b.buyer,
        rwaAmount: b.amount,
        usdcAmount: (parseFloat(b.amount) * parseFloat(b.maxPrice)).toString(),
      })),
      rwaToken: sellOrder.rwaToken,
      totalRwaAmount: sellOrder.amount,
      totalUsdcAmount: (parseFloat(sellOrder.amount) * parseFloat(sellOrder.minPrice)).toString(),
      providerFee: '100', // 1% fee
      timestamp: Date.now(),
    };
    
    matchedOrders.push(executionPlan);
    
    // Mark orders as matched
    sellOrder.status = 'matched';
    buyOrders.forEach(o => o.status = 'matched');
    
    console.log(`Orders matched: ${executionPlan.id}`);
    
    res.json({
      success: true,
      executionPlan,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as orderRoutes };
