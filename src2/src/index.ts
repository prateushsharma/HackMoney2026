import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { YellowService } from './services/YellowService';
import { orderRoutes } from './routes/orders';
import { sessionRoutes } from './routes/sessions';
import { providerRoutes } from './routes/providers';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    yellow: YellowService.getInstance().isConnected() ? 'connected' : 'disconnected',
    timestamp: Date.now() 
  });
});

// Routes
app.use('/api/orders', orderRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/providers', providerRoutes);

// WebSocket for real-time updates
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    console.log('Received:', message.toString());
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Initialize Yellow Service
const initializeYellow = async () => {
  try {
    const yellowService = YellowService.getInstance();
    await yellowService.connect();
    console.log('✅ Yellow Network connected');
  } catch (error) {
    console.error('❌ Failed to connect to Yellow Network:', error);
    process.exit(1);
  }
};

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await initializeYellow();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  YellowService.getInstance().disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export { wss };
