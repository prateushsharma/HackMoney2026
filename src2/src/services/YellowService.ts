import WebSocket from 'ws';
import { EventEmitter } from 'events';
import {
  createAuthRequestMessage,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageFromChallenge,
  createECDSAMessageSigner,
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createGetLedgerBalancesMessage,
  parseRPCResponse,
  RPCMethod,
  MessageSigner,
} from '@erc7824/nitrolite';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { randomBytes } from 'crypto';

interface AppSessionDefinition {
  protocol: string;
  participants: string[];
  weights: number[];
  quorum: number;
  challenge: number;
  nonce: number;
}

interface Allocation {
  participant: string;
  asset: string;
  amount: string;
}

interface AppSessionState {
  app_session_id: string;
  status: string;
  version: number;
  allocations: Allocation[];
  session_data?: string;
}

export class YellowService extends EventEmitter {
  private static instance: YellowService;
  private ws: WebSocket | null = null;
  private sessionSigner: MessageSigner | null = null;
  private sessionAddress: string | null = null;
  private isAuth = false;
  private activeSessions: Map<string, AppSessionState> = new Map();
  
  private readonly YELLOW_WS = 'wss://clearnet-sandbox.yellow.com/ws';
  private readonly MAIN_PRIVATE_KEY = process.env.MAIN_PRIVATE_KEY!;
  
  private constructor() {
    super();
  }
  
  static getInstance(): YellowService {
    if (!YellowService.instance) {
      YellowService.instance = new YellowService();
    }
    return YellowService.instance;
  }
  
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.YELLOW_WS);
      
      this.ws.on('open', async () => {
        console.log('📡 Connected to Yellow ClearNode');
        try {
          await this.authenticate();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (error) => console.error('WebSocket error:', error));
      this.ws.on('close', () => {
        this.isAuth = false;
        console.log('Disconnected from Yellow');
      });
    });
  }
  
  private async authenticate(): Promise<void> {
    // Generate session key
    const sessionPrivateKey = '0x' + randomBytes(32).toString('hex');
    const sessionAccount = privateKeyToAccount(sessionPrivateKey as `0x${string}`);
    this.sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
    this.sessionAddress = sessionAccount.address;
    
    const mainAccount = privateKeyToAccount(this.MAIN_PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      account: mainAccount,
      chain: sepolia,
      transport: http(),
    });
    
    // Auth params with CRITICAL fixes
    const authParams = {
      session_key: this.sessionAddress,
      allowances: [{ asset: 'ytest.usd', amount: '1000000000' }],
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600), // BigInt!
      scope: 'test.app', // test.app for sandbox!
    };
    
    const authRequestMsg = await createAuthRequestMessage({
      address: mainAccount.address,
      application: 'RWA Swap Protocol',
      ...authParams,
    });
    
    this.send(authRequestMsg);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Auth timeout')), 15000);
      
      const handleAuth = async (data: Buffer) => {
        try {
          const response = parseRPCResponse(data.toString());
          
          if (response.method === RPCMethod.AuthChallenge) {
            const challenge = response.params.challenge_message;
            const eip712Signer = createEIP712AuthMessageSigner(
              walletClient,
              authParams,
              { name: 'RWA Swap Protocol' }
            );
            const verifyMsg = await createAuthVerifyMessageFromChallenge(eip712Signer, challenge);
            this.send(verifyMsg);
          }
          
          if (response.method === RPCMethod.AuthVerify) {
            if (response.params.success) {
              this.isAuth = true;
              this.ws?.removeListener('message', handleAuth);
              clearTimeout(timeout);
              console.log('✅ Authenticated with Yellow Network');
              resolve();
            } else {
              reject(new Error('Auth failed'));
            }
          }
        } catch (error) {
          console.error('Auth error:', error);
        }
      };
      
      this.ws?.on('message', handleAuth);
    });
  }
  
  private handleMessage(data: Buffer): void {
    try {
      const response = parseRPCResponse(data.toString());
      
      // Filter background messages
      if (response.method === 'assets' || response.method === 'bu') return;
      
      // Emit for listeners
      this.emit('message', response);
      this.emit(response.method, response.params);
      
      // Handle app session updates
      if (response.method === 'create_app_session' && response.params.app_session_id) {
        this.activeSessions.set(response.params.app_session_id, response.params);
      }
      
      if (response.method === 'submit_app_state' && response.params.app_session_id) {
        const existing = this.activeSessions.get(response.params.app_session_id);
        if (existing) {
          this.activeSessions.set(response.params.app_session_id, {
            ...existing,
            ...response.params
          });
        }
      }
      
      if (response.method === 'close_app_session' && response.params.app_session_id) {
        const sessionId = response.params.app_session_id;
        this.activeSessions.delete(sessionId);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
  
  // Create app session (NitroRPC/0.4 with intent system)
  async createAppSession(
    definition: AppSessionDefinition,
    allocations: Allocation[],
    sessionData?: string
  ): Promise<string> {
    if (!this.isAuth || !this.sessionSigner) {
      throw new Error('Not authenticated with Yellow');
    }
    
    // IMPORTANT: Protocol must be NitroRPC/0.4 for intent support
    if (definition.protocol !== 'NitroRPC/0.4') {
      console.warn('⚠️  Use NitroRPC/0.4 for new sessions (supports OPERATE/DEPOSIT/WITHDRAW intents)');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
      
      const handleResponse = (params: any) => {
        clearTimeout(timeout);
        this.removeListener('create_app_session', handleResponse);
        
        if (params.app_session_id) {
          console.log(`✅ App session created: ${params.app_session_id}`);
          console.log(`   Protocol: ${definition.protocol}`);
          console.log(`   Participants: ${definition.participants.length}`);
          console.log(`   Version: ${params.version || 1}`);
          resolve(params.app_session_id);
        } else {
          reject(new Error('No app_session_id'));
        }
      };
      
      this.once('create_app_session', handleResponse);
      
      const payload: any = { definition, allocations };
      if (sessionData) payload.session_data = sessionData;
      
      createAppSessionMessage(this.sessionSigner!, [payload])
        .then(msg => this.send(msg))
        .catch(reject);
    });
  }
  
  // Submit app state update (NitroRPC/0.4 with intent system)
  async submitAppState(
    appSessionId: string,
    intent: 'operate' | 'deposit' | 'withdraw',
    version: number,
    allocations: Allocation[],
    sessionData?: string
  ): Promise<void> {
    if (!this.isAuth || !this.sessionSigner) {
      throw new Error('Not authenticated');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
      
      const handleResponse = (params: any) => {
        clearTimeout(timeout);
        this.removeListener('submit_app_state', handleResponse);
        
        if (params.version === version) {
          resolve();
        } else {
          reject(new Error('Version mismatch'));
        }
      };
      
      this.once('submit_app_state', handleResponse);
      
      // Build payload for NitroRPC/0.4
      const payload: any = {
        app_session_id: appSessionId,
        intent,
        version,
        allocations
      };
      if (sessionData) payload.session_data = sessionData;
      
      // Manual message construction for submit_app_state
      const request = {
        req: [
          Date.now(), // request ID
          'submit_app_state',
          [payload],
          Date.now() // timestamp
        ]
      };
      
      // Sign with session key
      const message = JSON.stringify(request);
      this.sessionSigner!(request.req).then(sig => {
        const signed = { ...request, sig: [sig] };
        this.send(JSON.stringify(signed));
      }).catch(reject);
    });
  }
  
  // Close app session
  async closeAppSession(
    appSessionId: string,
    allocations: Allocation[],
    sessionData?: string
  ): Promise<void> {
    if (!this.isAuth || !this.sessionSigner) {
      throw new Error('Not authenticated');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);
      
      const handleResponse = (params: any) => {
        clearTimeout(timeout);
        this.removeListener('close_app_session', handleResponse);
        
        if (params.status === 'closed') {
          resolve();
        } else {
          reject(new Error('Not closed'));
        }
      };
      
      this.once('close_app_session', handleResponse);
      
      const payload: any = { app_session_id: appSessionId, allocations };
      if (sessionData) payload.session_data = sessionData;
      
      createCloseAppSessionMessage(this.sessionSigner!, [payload])
        .then(msg => this.send(msg))
        .catch(reject);
    });
  }
  
  // Get ledger balances
  async getLedgerBalances(participant: string): Promise<any[]> {
    if (!this.isAuth || !this.sessionSigner) {
      throw new Error('Not authenticated');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
      
      const handleResponse = (params: any) => {
        clearTimeout(timeout);
        this.removeListener('get_ledger_balances', handleResponse);
        resolve(params);
      };
      
      this.once('get_ledger_balances', handleResponse);
      
      createGetLedgerBalancesMessage(this.sessionSigner!, participant)
        .then(msg => this.send(msg))
        .catch(reject);
    });
  }
  
  getActiveSession(sessionId: string): AppSessionState | undefined {
    return this.activeSessions.get(sessionId);
  }
  
  getAllActiveSessions(): AppSessionState[] {
    return Array.from(this.activeSessions.values());
  }
  
  private send(message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.ws.send(message);
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  isConnected(): boolean {
    return this.isAuth && this.ws?.readyState === WebSocket.OPEN;
  }
}
