import { Router, Request, Response } from 'express';

const router = Router();

// In-memory order book
const orders = new Map<string, any>();

/**
 * POST /api/orders
 * Create a new RWA sell order
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { seller, rwaToken, amount, minPrice } = req.body;

    if (!seller || !rwaToken || !amount) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    const orderId = `order_${Date.now()}`;
    const order = {
      id: orderId,
      seller,
      rwaToken,
      amount,
      minPrice: minPrice || '0',
      status: 'open',
      createdAt: new Date().toISOString()
    };

    orders.set(orderId, order);

    console.log(`\n📝 New RWA sell order created: ${orderId}`);

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('❌ Error creating order:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/orders
 * Get all orders
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const allOrders = Array.from(orders.values());

    res.json({
      success: true,
      orders: allOrders,
      count: allOrders.length
    });

  } catch (error) {
    console.error('❌ Error getting orders:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get orders',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/orders/:orderId
 * Get a specific order
 */
router.get('/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const order = orders.get(orderId);

    if (!order) {
      return res.status(404).json({ 
        success: false,
        error: 'Order not found' 
      });
    }

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('❌ Error getting order:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/orders/:orderId/cancel
 * Cancel an order
 */
router.put('/:orderId/cancel', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const order = orders.get(orderId);

    if (!order) {
      return res.status(404).json({ 
        success: false,
        error: 'Order not found' 
      });
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();

    console.log(`\n❌ Order cancelled: ${orderId}`);

    res.json({
      success: true,
      order
    });

  } catch (error) {
    console.error('❌ Error cancelling order:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to cancel order',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as orderRoutes };