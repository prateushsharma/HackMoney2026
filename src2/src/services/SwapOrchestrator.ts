import { EventEmitter } from 'events';
import { YellowService } from './YellowService';

export interface ExecutionPlan {
  id: string;
  seller: string;
  provider: string;
  buyers: Array<{
    buyer: string;
    rwaAmount: string;
    usdcAmount: string;
  }>;
  rwaToken: string;
  totalRwaAmount: string;
  totalUsdcAmount: string;
  providerFee: string;
  timestamp: number;
}

export interface SwapSession {
  executionPlanId: string;
  yellowSessionId: string | null;
  status: 'pending' | 'created' | 'locked' | 'finalized' | 'closed' | 'failed';
  currentVersion: number;
  error?: string;
}

export class SwapOrchestrator extends EventEmitter {
  private yellow: YellowService;
  private swapSessions: Map<string, SwapSession> = new Map();
  
  constructor() {
    super();
    this.yellow = YellowService.getInstance();
  }
  
  /**
   * Phase 1: Create Yellow app session with lock allocations
   * Uses NitroRPC/0.4 protocol
   */
  async createSwapSession(plan: ExecutionPlan): Promise<string> {
    const session: SwapSession = {
      executionPlanId: plan.id,
      yellowSessionId: null,
      status: 'pending',
      currentVersion: 1,
    };
    
    this.swapSessions.set(plan.id, session);
    
    try {
      // Build participants array
      const participants = [
        plan.seller,
        plan.provider,
        ...plan.buyers.map(b => b.buyer),
      ];
      
      console.log(`Creating Yellow session for ${participants.length} participants`);
      
      // Define app session (MUST use nitroliterpc!)
      const definition = {
        protocol: 'nitroliterpc', // ✅ Correct protocol
        participants,
        weights: this.calculateWeights(participants),
        quorum: 100, // All must approve
        challenge: 0,
        nonce: Date.now(),
      };
      
      // Build lock allocations (what each party locks initially)
      const lockAllocations = this.buildLockAllocations(plan);
      
      // Session data with execution plan info
      const sessionData = JSON.stringify({
        executionPlanId: plan.id,
        phase: 'lock',
        timestamp: Date.now(),
      });
      
      // Create Yellow app session
      const yellowSessionId = await this.yellow.createAppSession(
        definition,
        lockAllocations,
        sessionData
      );
      
      session.yellowSessionId = yellowSessionId;
      session.status = 'created';
      
      console.log(`✅ Yellow session created: ${yellowSessionId}`);
      this.emit('session_created', { executionPlanId: plan.id, yellowSessionId });
      
      return yellowSessionId;
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      this.emit('session_failed', { executionPlanId: plan.id, error });
      throw error;
    }
  }
  
  /**
   * Phase 1.5: Lock funds (optional explicit lock step)
   * Uses OPERATE intent to redistribute within locked amounts
   */
  async lockFunds(executionPlanId: string): Promise<void> {
    const session = this.swapSessions.get(executionPlanId);
    if (!session || !session.yellowSessionId) {
      throw new Error('Session not found');
    }
    
    const plan = this.getExecutionPlan(executionPlanId);
    
    try {
      // Confirm lock state using OPERATE intent (no change to totals)
      const lockAllocations = this.buildLockAllocations(plan);
      
      await this.yellow.submitAppState(
        session.yellowSessionId,
        'operate', // OPERATE intent - redistribute within locked amounts
        session.currentVersion + 1,
        lockAllocations,
        JSON.stringify({ phase: 'locked', timestamp: Date.now() })
      );
      
      session.currentVersion++;
      session.status = 'locked';
      
      console.log(`✅ Funds locked in session ${session.yellowSessionId}`);
      this.emit('funds_locked', { executionPlanId });
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }
  
  /**
   * Phase 2: Finalize swap with net settlement
   * Uses OPERATE intent to redistribute to final state
   */
  async finalizeSwap(executionPlanId: string): Promise<void> {
    const session = this.swapSessions.get(executionPlanId);
    if (!session || !session.yellowSessionId) {
      throw new Error('Session not found');
    }
    
    const plan = this.getExecutionPlan(executionPlanId);
    
    try {
      // Build final allocations (net settlement)
      const finalAllocations = this.buildFinalAllocations(plan);
      
      // Update state with OPERATE intent (redistribute to final)
      await this.yellow.submitAppState(
        session.yellowSessionId,
        'operate', // OPERATE - final redistribution
        session.currentVersion + 1,
        finalAllocations,
        JSON.stringify({ 
          phase: 'finalized', 
          result: 'swap_completed',
          timestamp: Date.now() 
        })
      );
      
      session.currentVersion++;
      session.status = 'finalized';
      
      console.log(`✅ Swap finalized in session ${session.yellowSessionId}`);
      this.emit('swap_finalized', { executionPlanId, yellowSessionId: session.yellowSessionId });
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }
  
  /**
   * Phase 3: Close Yellow session and distribute funds
   */
  async closeSession(executionPlanId: string): Promise<void> {
    const session = this.swapSessions.get(executionPlanId);
    if (!session || !session.yellowSessionId) {
      throw new Error('Session not found');
    }
    
    const plan = this.getExecutionPlan(executionPlanId);
    
    try {
      const finalAllocations = this.buildFinalAllocations(plan);
      
      await this.yellow.closeAppSession(
        session.yellowSessionId,
        finalAllocations,
        JSON.stringify({ 
          result: 'swap_completed',
          executionPlanId: plan.id,
          timestamp: Date.now() 
        })
      );
      
      session.status = 'closed';
      
      console.log(`✅ Session closed: ${session.yellowSessionId}`);
      this.emit('session_closed', { executionPlanId });
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }
  
  /**
   * Build lock allocations (Phase 1)
   * Seller locks RWA, Provider locks USDC, Buyers lock USDC
   */
  private buildLockAllocations(plan: ExecutionPlan): any[] {
    const allocations: any[] = [];
    
    // Seller locks RWA tokens
    allocations.push({
      participant: plan.seller,
      asset: 'rwa_token', // Will be actual token address
      amount: plan.totalRwaAmount,
    });
    
    // Provider locks USDC to buy from seller
    allocations.push({
      participant: plan.provider,
      asset: 'usdc',
      amount: plan.totalUsdcAmount,
    });
    
    // Buyers lock their USDC
    for (const buyer of plan.buyers) {
      allocations.push({
        participant: buyer.buyer,
        asset: 'usdc',
        amount: buyer.usdcAmount,
      });
    }
    
    return allocations;
  }
  
  /**
   * Build final allocations (Phase 2)
   * Net settlement - only final balances
   */
  private buildFinalAllocations(plan: ExecutionPlan): any[] {
    const allocations: any[] = [];
    
    // Seller receives USDC (from provider)
    allocations.push({
      participant: plan.seller,
      asset: 'usdc',
      amount: plan.totalUsdcAmount,
    });
    
    allocations.push({
      participant: plan.seller,
      asset: 'rwa_token',
      amount: '0', // Seller no longer has RWA
    });
    
    // Buyers receive RWA tokens
    for (const buyer of plan.buyers) {
      allocations.push({
        participant: buyer.buyer,
        asset: 'rwa_token',
        amount: buyer.rwaAmount,
      });
      
      allocations.push({
        participant: buyer.buyer,
        asset: 'usdc',
        amount: '0', // Buyers spent USDC
      });
    }
    
    // Provider keeps fee
    allocations.push({
      participant: plan.provider,
      asset: 'usdc',
      amount: plan.providerFee,
    });
    
    allocations.push({
      participant: plan.provider,
      asset: 'rwa_token',
      amount: '0',
    });
    
    return allocations;
  }
  
  /**
   * Calculate weights for participants
   * For demo: equal weights for simplicity
   */
  private calculateWeights(participants: string[]): number[] {
    const weight = Math.floor(100 / participants.length);
    return participants.map((_, i) => 
      i === 0 ? 100 - (weight * (participants.length - 1)) : weight
    );
  }
  
  getSwapSession(executionPlanId: string): SwapSession | undefined {
    return this.swapSessions.get(executionPlanId);
  }
  
  getAllSwapSessions(): SwapSession[] {
    return Array.from(this.swapSessions.values());
  }
  
  // Mock execution plan storage (replace with DB)
  private getExecutionPlan(id: string): ExecutionPlan {
    // This would come from your database
    // For now, return a mock
    throw new Error('Implement execution plan storage');
  }
}