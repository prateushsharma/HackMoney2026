import { YellowService } from './YellowService';

export interface Buyer {
  buyer: string;
  rwaAmount: string;
  usdcAmount: string;
}

export interface ExecutionPlan {
  id: string;
  seller: string;
  provider: string;
  buyers: Buyer[];
  rwaToken: string;
  totalRwaAmount: string;
  totalUsdcAmount: string;
  providerFee: string;
  timestamp: number;
}

export class SwapOrchestrator {
  private yellow: YellowService;
  private executionPlans: Map<string, ExecutionPlan> = new Map();
  private yellowSessions: Map<string, string> = new Map(); // planId -> yellowSessionId

  constructor() {
    this.yellow = YellowService.getInstance();
  }

  /**
   * Create multi-party swap session
   */
  async createSwapSession(plan: ExecutionPlan): Promise<string> {
    // Store the plan FIRST - this was the bug!
    this.executionPlans.set(plan.id, plan);
    console.log(`📝 Stored execution plan: ${plan.id}`);
    console.log(`   Plans in memory: ${this.executionPlans.size}`);

    try {
      // Build participants array - 5 PARTICIPANTS
      const participants = [
        plan.seller,
        plan.provider,
        ...plan.buyers.map(b => b.buyer),
      ];
      
      console.log(`Creating Yellow session for ${participants.length} participants`);

      // Build app definition for multi-party swap
      const appDefinition = {
        protocol: 'NitroRPC/0.5',
        participants: participants,
        weights: [20, 20, 20, 20, 20], // Equal weights for all 5 participants
        quorum: 100,
        challenge: 0,
        nonce: Date.now(),
        application: 'RWA Swap'
      };

      // Build initial allocations
      const allocations = this.buildLockAllocations(plan);

      // Create Yellow session
      const yellowSessionId = await this.yellow.createAppSession(
        appDefinition,
        allocations
      );

      // Store the mapping
      this.yellowSessions.set(plan.id, yellowSessionId);
      console.log(`✅ Yellow session created: ${yellowSessionId}`);
      
      return yellowSessionId;
    } catch (error) {
      console.error('Failed to create swap session:', error);
      // Clean up on failure
      this.executionPlans.delete(plan.id);
      throw error;
    }
  }

  /**
   * Lock funds (Phase 1 - Locking)
   */
  async lockFunds(planId: string): Promise<void> {
    console.log(`🔍 Looking up plan: ${planId}`);
    console.log(`   Plans available: ${Array.from(this.executionPlans.keys()).join(', ')}`);
    
    const plan = this.executionPlans.get(planId);
    const yellowSessionId = this.yellowSessions.get(planId);

    if (!plan) {
      throw new Error(`Execution plan not found: ${planId}`);
    }
    
    if (!yellowSessionId) {
      throw new Error(`Yellow session not found for plan: ${planId}`);
    }

    const allocations = this.buildLockAllocations(plan);

    await this.yellow.submitAppState(
      yellowSessionId,
      'OPERATE',
      allocations
    );
  }

  /**
   * Finalize swap (Phase 2 - Settlement)
   */
  async finalizeSwap(planId: string): Promise<void> {
    const plan = this.executionPlans.get(planId);
    const yellowSessionId = this.yellowSessions.get(planId);

    if (!plan) {
      throw new Error(`Execution plan not found: ${planId}`);
    }
    
    if (!yellowSessionId) {
      throw new Error(`Yellow session not found for plan: ${planId}`);
    }

    const allocations = this.buildFinalAllocations(plan);

    await this.yellow.submitAppState(
      yellowSessionId,
      'OPERATE',
      allocations
    );

    console.log(`✅ Swap finalized for plan ${planId}`);
  }

  /**
   * Close swap session
   */
  async closeSwapSession(planId: string): Promise<void> {
    const plan = this.executionPlans.get(planId);
    const yellowSessionId = this.yellowSessions.get(planId);

    if (!plan) {
      throw new Error(`Execution plan not found: ${planId}`);
    }
    
    if (!yellowSessionId) {
      throw new Error(`Yellow session not found for plan: ${planId}`);
    }

    const allocations = this.buildFinalAllocations(plan);

    await this.yellow.closeAppSession(
      yellowSessionId,
      allocations
    );

    console.log(`✅ Swap session closed for plan ${planId}`);
  }

  /**
   * Build lock allocations (Phase 1)
   * All 5 participants with small initial balances
   */
  private buildLockAllocations(plan: ExecutionPlan): any[] {
    const allocations: any[] = [];
    
    // Seller
    allocations.push({
      participant: plan.seller,
      asset: 'ytest.usd',
      amount: '100.00',
    });
    
    // Provider
    allocations.push({
      participant: plan.provider,
      asset: 'ytest.usd',
      amount: '10.00',
    });
    
    // Buyers
    for (const buyer of plan.buyers) {
      allocations.push({
        participant: buyer.buyer,
        asset: 'ytest.usd',
        amount: buyer.usdcAmount,
      });
    }
    
    return allocations;
  }

  /**
   * Build final allocations (Phase 2)
   * Net settlement after swap completion
   */
  private buildFinalAllocations(plan: ExecutionPlan): any[] {
    const allocations: any[] = [];
    
    // Seller receives USDC from buyers
    allocations.push({
      participant: plan.seller,
      asset: 'ytest.usd',
      amount: plan.totalUsdcAmount,
    });
    
    // Provider receives fee
    allocations.push({
      participant: plan.provider,
      asset: 'ytest.usd',
      amount: plan.providerFee,
    });
    
    // Buyers receive their portions
    for (const buyer of plan.buyers) {
      allocations.push({
        participant: buyer.buyer,
        asset: 'ytest.usd',
        amount: '0',  // Spent USDC on RWA tokens
      });
    }
    
    return allocations;
  }

  getExecutionPlan(id: string): ExecutionPlan | undefined {
    return this.executionPlans.get(id);
  }

  getAllPlans(): ExecutionPlan[] {
    return Array.from(this.executionPlans.values());
  }
}