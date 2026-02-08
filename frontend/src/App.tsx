import { useState, useEffect } from 'react';
import './App.css';

interface RWAToken {
  id: string;
  name: string;
  type: string;
  amount: number;
  value: number;
  icon: string;
}

interface Provider {
  id: string;
  name: string;
  collateral: string;
  fee: string;
  quote: string;
  reputation: number;
}

type Step = 'portfolio' | 'providers' | 'executing' | 'success';

function App() {
  const [currentStep, setCurrentStep] = useState<Step>('portfolio');
  const [selectedToken, setSelectedToken] = useState<RWAToken | null>(null);
  const [sellAmount, setSellAmount] = useState('');
  const [askPrice, setAskPrice] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [connected, setConnected] = useState(false);

  // User's RWA portfolio
  const userTokens: RWAToken[] = [
    { 
      id: 'rwa1', 
      name: 'NYC Apartment #402', 
      type: 'Real Estate',
      amount: 100, 
      value: 250000,
      icon: '🏢'
    },
    { 
      id: 'rwa2', 
      name: 'US Treasury Bond 2025', 
      type: 'Treasury',
      amount: 50, 
      value: 100000,
      icon: '💵'
    },
    { 
      id: 'rwa3', 
      name: 'Gold Vault Certificate', 
      type: 'Commodity',
      amount: 75, 
      value: 180000,
      icon: '🏆'
    }
  ];

  // Mock liquidity providers
  const mockProviders: Provider[] = [
    {
      id: 'p1',
      name: 'DeFi Capital',
      collateral: '$500,000',
      fee: '0.5%',
      quote: '$99,500',
      reputation: 98
    },
    {
      id: 'p2',
      name: 'Market Masters',
      collateral: '$750,000',
      fee: '0.3%',
      quote: '$99,700',
      reputation: 95
    },
    {
      id: 'p3',
      name: 'Liquidity Labs',
      collateral: '$1,000,000',
      fee: '0.4%',
      quote: '$99,600',
      reputation: 97
    }
  ];

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000');
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    return () => ws.close();
  }, []);

  const handleTokenSelect = (token: RWAToken) => {
    setSelectedToken(token);
    setSellAmount(token.amount.toString());
    setAskPrice((token.value / token.amount).toString());
  };

  const handleFindProviders = () => {
    setCurrentStep('providers');
    setStatusMessage('🔗 Connecting to Yellow Network...');
    
    setTimeout(() => {
      setProviders(mockProviders);
      setStatusMessage('✅ Found 3 liquidity providers competing for your order!');
    }, 1500);
  };

  const handleExecuteSwap = async (provider: Provider) => {
    setSelectedProvider(provider);
    setCurrentStep('executing');
    setProgress(0);

    // Step 1: Create Yellow session
    setStatusMessage('📡 Creating Yellow Network multi-party session...');
    setProgress(15);
    await sleep(1000);

    // Step 2: Coordinate participants
    setStatusMessage(`👥 Coordinating: You + ${provider.name} + 3 Buyers via Yellow...`);
    setProgress(30);
    await sleep(1000);

    // Call backend
    try {
      const response = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEbE',
          provider: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
          buyers: [
            { buyer: '0xdD2FD4581271e230360230F9337D5c0430Bf44C0', rwaAmount: '30', usdcAmount: '3000' },
            { buyer: '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E', rwaAmount: '40', usdcAmount: '4000' },
            { buyer: '0x2546BcD3c84621e976D8185a91A922aE77ECEc30', rwaAmount: '30', usdcAmount: '3000' }
          ],
          rwaToken: selectedToken?.id || '0xRWA_TOKEN',
          totalRwaAmount: sellAmount,
          totalUsdcAmount: (parseInt(sellAmount) * parseInt(askPrice)).toString(),
          providerFee: '100'
        })
      });

      const data = await response.json();

      // Step 3: Off-chain coordination
      setStatusMessage('⚡ Performing off-chain state updates (0 gas!)...');
      setProgress(50);
      await sleep(800);

      await fetch(`/api/sessions/${data.planId}/lock`, { method: 'POST' });
      
      setStatusMessage('🔄 All 5 participants signing agreements off-chain...');
      setProgress(70);
      await sleep(800);

      await fetch(`/api/sessions/${data.planId}/finalize`, { method: 'POST' });

      // Step 4: Settlement
      setStatusMessage('💫 Batching all updates into single settlement transaction...');
      setProgress(90);
      await sleep(800);

      await fetch(`/api/sessions/${data.planId}/close`, { method: 'POST' });

      setProgress(100);
      setCurrentStep('success');
      setStatusMessage('🎉 Swap Complete!');
    } catch (error) {
      setStatusMessage('❌ Error during swap');
      console.error(error);
    }
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const resetFlow = () => {
    setCurrentStep('portfolio');
    setSelectedToken(null);
    setSellAmount('');
    setAskPrice('');
    setProviders([]);
    setSelectedProvider(null);
    setProgress(0);
    setStatusMessage('');
  };

  return (
    <div className="App">
      <div className="bg-animation">
        <div className="circle circle-1"></div>
        <div className="circle circle-2"></div>
        <div className="circle circle-3"></div>
      </div>

      <header className="header">
        <div className="header-content">
          <div className="logo-wrapper">
            <span className="logo-icon">🟡</span>
            <div className="logo-text">
              <h1>ZaZa-RWA</h1>
              <p className="tagline">Powered by Yellow Network</p>
            </div>
          </div>
          <div className="status-pill">
            <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
            <span className="status-text">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </header>

      <main className="main-content">
        {/* STEP 1: PORTFOLIO */}
        {currentStep === 'portfolio' && (
          <>
            <section className="hero-section">
              <div className="hero-badge">
                <span className="badge-icon">💼</span>
                <span>Your RWA Portfolio</span>
              </div>
              <h2 className="hero-title">Select Asset to Sell</h2>
              <p className="hero-description">
                Choose from your tokenized real-world assets
              </p>
            </section>

            <section className="portfolio-section">
              <div className="tokens-grid">
                {userTokens.map((token) => (
                  <div 
                    key={token.id} 
                    className={`token-card ${selectedToken?.id === token.id ? 'selected' : ''}`}
                    onClick={() => handleTokenSelect(token)}
                  >
                    <div className="token-icon">{token.icon}</div>
                    <div className="token-info">
                      <h3>{token.name}</h3>
                      <p className="token-type">{token.type}</p>
                      <div className="token-stats">
                        <div className="stat">
                          <span className="stat-label">Owned</span>
                          <span className="stat-value">{token.amount} tokens</span>
                        </div>
                        <div className="stat">
                          <span className="stat-label">Value</span>
                          <span className="stat-value">${token.value.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    {selectedToken?.id === token.id && (
                      <div className="selected-badge">✓ Selected</div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {selectedToken && (
              <section className="order-section">
                <div className="order-card">
                  <h3>📝 Set Your Order Details</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Amount to Sell</label>
                      <input 
                        type="number" 
                        value={sellAmount}
                        onChange={(e) => setSellAmount(e.target.value)}
                        max={selectedToken.amount}
                      />
                      <span className="input-hint">Max: {selectedToken.amount} tokens</span>
                    </div>
                    <div className="form-group">
                      <label>Ask Price per Token</label>
                      <input 
                        type="number" 
                        value={askPrice}
                        onChange={(e) => setAskPrice(e.target.value)}
                      />
                      <span className="input-hint">USDC</span>
                    </div>
                  </div>
                  <div className="total-value">
                    <span>Total Value:</span>
                    <span className="value">${(parseInt(sellAmount || '0') * parseInt(askPrice || '0')).toLocaleString()}</span>
                  </div>
                  <button 
                    className="btn-primary"
                    onClick={handleFindProviders}
                    disabled={!sellAmount || !askPrice}
                  >
                    🔍 Find Liquidity Providers
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {/* STEP 2: PROVIDERS */}
        {currentStep === 'providers' && (
          <>
            <section className="hero-section">
              <div className="hero-badge">
                <span className="badge-icon">🏦</span>
                <span>Liquidity Provider Competition</span>
              </div>
              <h2 className="hero-title">Providers Competing for Your Order</h2>
              <p className="hero-description">
                {statusMessage}
              </p>
            </section>

            <section className="providers-section">
              <div className="order-summary">
                <div className="summary-item">
                  <span className="label">Selling:</span>
                  <span className="value">{sellAmount} {selectedToken?.name}</span>
                </div>
                <div className="summary-item">
                  <span className="label">Ask Price:</span>
                  <span className="value">${askPrice} per token</span>
                </div>
                <div className="summary-item">
                  <span className="label">Total:</span>
                  <span className="value highlight">${(parseInt(sellAmount) * parseInt(askPrice)).toLocaleString()}</span>
                </div>
              </div>

              <div className="providers-grid">
                {providers.map((provider) => (
                  <div key={provider.id} className="provider-card">
                    <div className="provider-header">
                      <div className="provider-name">
                        <span className="provider-icon">🏦</span>
                        <h4>{provider.name}</h4>
                      </div>
                      <div className="reputation">
                        <span className="star">⭐</span>
                        <span>{provider.reputation}%</span>
                      </div>
                    </div>
                    <div className="provider-details">
                      <div className="detail-row">
                        <span className="label">Collateral</span>
                        <span className="value">{provider.collateral}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Fee</span>
                        <span className="value">{provider.fee}</span>
                      </div>
                      <div className="detail-row highlight-row">
                        <span className="label">Your Quote</span>
                        <span className="value quote">{provider.quote}</span>
                      </div>
                    </div>
                    <button 
                      className="btn-select"
                      onClick={() => handleExecuteSwap(provider)}
                    >
                      🚀 Select & Execute Swap
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* STEP 3: EXECUTING */}
        {currentStep === 'executing' && (
          <section className="executing-section">
            <div className="executing-card">
              <div className="executing-header">
                <h2>⚡ Yellow Network Magic Happening...</h2>
                <p>Multi-party coordination in progress</p>
              </div>

              <div className="participants-flow">
                <div className="participant seller">
                  <div className="p-icon">👤</div>
                  <div className="p-name">You</div>
                  <div className="p-detail">{sellAmount} RWA</div>
                </div>
                <div className="flow-line active"></div>
                <div className="participant provider">
                  <div className="p-icon">🏦</div>
                  <div className="p-name">{selectedProvider?.name}</div>
                  <div className="p-detail">{selectedProvider?.quote}</div>
                </div>
                <div className="flow-line active"></div>
                <div className="participant buyers">
                  <div className="p-icon">👥</div>
                  <div className="p-name">3 Buyers</div>
                  <div className="p-detail">30+40+30 tokens</div>
                </div>
              </div>

              <div className="progress-container">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="progress-text">{statusMessage}</div>
                <div className="progress-percentage">{progress}%</div>
              </div>

              <div className="yellow-features">
                <div className="feature">
                  <span className="feature-icon">⚡</span>
                  <span>Off-chain coordination</span>
                  <span className="feature-value">0 gas</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">🔐</span>
                  <span>State channel session</span>
                  <span className="feature-value">NitroRPC/0.5</span>
                </div>
                <div className="feature">
                  <span className="feature-icon">💰</span>
                  <span>Gas savings</span>
                  <span className="feature-value">$200 (80%)</span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* STEP 4: SUCCESS */}
        {currentStep === 'success' && (
          <section className="success-section">
            <div className="success-card">
              <div className="success-icon-big">🎉</div>
              <h2>Swap Executed Successfully!</h2>
              <p className="success-subtitle">Multi-party RWA swap complete via Yellow Network</p>

              <div className="success-details">
                <div className="detail-box">
                  <span className="label">Winner:</span>
                  <span className="value">{selectedProvider?.name}</span>
                </div>
                <div className="detail-box">
                  <span className="label">You Received:</span>
                  <span className="value">{selectedProvider?.quote}</span>
                </div>
                <div className="detail-box success-highlight">
                  <span className="label">Gas Saved:</span>
                  <span className="value">$200 (80%)</span>
                </div>
              </div>

              <div className="transaction-summary">
                <h4>📊 Transaction Summary</h4>
                <div className="summary-grid">
                  <div className="summary-row">
                    <span>Sold:</span>
                    <span>{sellAmount} {selectedToken?.name}</span>
                  </div>
                  <div className="summary-row">
                    <span>Price:</span>
                    <span>${askPrice} per token</span>
                  </div>
                  <div className="summary-row">
                    <span>Participants:</span>
                    <span>5 (You + Provider + 3 Buyers)</span>
                  </div>
                  <div className="summary-row">
                    <span>Protocol:</span>
                    <span>Yellow Network NitroRPC/0.5</span>
                  </div>
                  <div className="summary-row">
                    <span>Settlement:</span>
                    <span>1 atomic transaction</span>
                  </div>
                </div>
              </div>

              <button className="btn-primary" onClick={resetFlow}>
                🔄 Create Another Swap
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>Built on Yellow Network • Multi-Party State Channels</p>
      </footer>
    </div>
  );
}

export default App;