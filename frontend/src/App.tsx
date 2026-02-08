import { useState, useEffect } from 'react';
import './App.css';

interface SwapSession {
  id: string;
  yellowSessionId: string;
  status: string;
  participants: number;
  protocol?: string;
  version?: number;
  created_at?: string;
}

function App() {
  const [sessions, setSessions] = useState<SwapSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');

  // WebSocket connection
  useEffect(() => {
    const websocket = new WebSocket('ws://localhost:3000');
    
    websocket.onopen = () => {
      console.log('🔌 Connected to ZaZa-RWA Network');
      setConnected(true);
    };
    
    websocket.onclose = () => {
      setConnected(false);
    };
    
    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, []);

  const executeDemo = async () => {
    setLoading(true);
    setProgress(0);

    // Step 1: Creating session
    setCurrentStep('🔗 Connecting to Yellow Network...');
    setProgress(20);
    await new Promise(resolve => setTimeout(resolve, 1000));

    setCurrentStep('👥 Coordinating 5 participants (Seller + Provider + 3 Buyers)...');
    setProgress(40);
    await new Promise(resolve => setTimeout(resolve, 1000));

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
          rwaToken: '0xRWA_TOKEN',
          totalRwaAmount: '100',
          totalUsdcAmount: '10000',
          providerFee: '100'
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setCurrentStep('✅ Multi-party session created!');
        setProgress(60);
        await new Promise(resolve => setTimeout(resolve, 800));

        // Step 2: Execute swap
        setCurrentStep('⚡ Performing off-chain coordination (0 gas)...');
        setProgress(80);
        
        await fetch(`/api/sessions/${data.planId}/lock`, { method: 'POST' });
        await new Promise(resolve => setTimeout(resolve, 600));
        
        await fetch(`/api/sessions/${data.planId}/finalize`, { method: 'POST' });
        await new Promise(resolve => setTimeout(resolve, 600));
        
        await fetch(`/api/sessions/${data.planId}/close`, { method: 'POST' });

        setCurrentStep('🎉 Swap Complete! Gas Saved: $200 (80%)');
        setProgress(100);
        
        setStatus('success');
        loadSessions();
      } else {
        setStatus('error');
        setCurrentStep('❌ Failed to execute swap');
      }
    } catch (error) {
      setStatus('error');
      setCurrentStep('❌ Error during execution');
      console.error(error);
    } finally {
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
        setCurrentStep('');
      }, 3000);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await fetch('/api/sessions/yellow/active');
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  useEffect(() => {
    setTimeout(() => loadSessions(), 1000);
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="App">
      {/* Animated Background */}
      <div className="bg-animation">
        <div className="circle circle-1"></div>
        <div className="circle circle-2"></div>
        <div className="circle circle-3"></div>
      </div>

      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <div className="logo-wrapper">
              <span className="logo-icon">🟡</span>
              <div className="logo-text">
                <h1>ZaZa-RWA</h1>
                <p className="tagline">Powered by Yellow Network</p>
              </div>
            </div>
          </div>
          <div className="status-pill">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
            <span className="status-text">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* Hero Section */}
        <section className="hero-section">
          <div className="hero-badge">
            <span className="badge-icon">⚡</span>
            <span>First Liquid RWA Marketplace</span>
          </div>
          <h2 className="hero-title">Solve RWA Liquidity Crisis</h2>
          <p className="hero-description">
            Multi-party atomic swaps with <strong>80% gas savings</strong> using Yellow Network state channels
          </p>

          {/* Stats Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">👥</div>
              <div className="stat-value">5</div>
              <div className="stat-label">Participants</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">💰</div>
              <div className="stat-value">80%</div>
              <div className="stat-label">Gas Savings</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">⚡</div>
              <div className="stat-value">&lt;1s</div>
              <div className="stat-label">Settlement</div>
            </div>
          </div>
        </section>

        {/* Demo Section */}
        <section className="demo-section">
          <div className="demo-card">
            <div className="demo-header">
              <h3>🚀 Live Demo</h3>
              <p>Experience multi-party RWA swap with Yellow Network</p>
            </div>

            {/* Participants Preview */}
            <div className="participants-preview">
              <div className="participant-item seller">
                <div className="participant-icon">🏢</div>
                <div className="participant-info">
                  <div className="participant-name">Alice (Seller)</div>
                  <div className="participant-amount">100 RWA tokens</div>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="participant-item provider">
                <div className="participant-icon">🏦</div>
                <div className="participant-info">
                  <div className="participant-name">Market Maker</div>
                  <div className="participant-amount">$10,000 liquidity</div>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="participant-item buyers">
                <div className="participant-icon">👥</div>
                <div className="participant-info">
                  <div className="participant-name">3 Buyers</div>
                  <div className="participant-amount">30 + 40 + 30 tokens</div>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button 
              className={`demo-button ${loading ? 'loading' : ''}`}
              onClick={executeDemo}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  Processing...
                </>
              ) : (
                <>
                  <span className="button-icon">🚀</span>
                  Execute Multi-Party Swap
                </>
              )}
            </button>

            {/* Progress Bar */}
            {loading && (
              <div className="progress-section">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="progress-text">{currentStep}</div>
              </div>
            )}

            {/* Success Message */}
            {status === 'success' && !loading && (
              <div className="success-banner">
                <div className="success-icon">🎉</div>
                <div className="success-content">
                  <h4>Swap Executed Successfully!</h4>
                  <p>Saved $200 in gas fees (80% reduction)</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* How It Works */}
        <section className="how-it-works">
          <h3 className="section-title">How It Works</h3>
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">1</div>
              <h4>Create Order</h4>
              <p>Seller lists RWA tokens on marketplace</p>
            </div>
            <div className="step-card">
              <div className="step-number">2</div>
              <h4>Off-Chain Coordination</h4>
              <p>Yellow Network coordinates all 5 parties with 0 gas</p>
            </div>
            <div className="step-card">
              <div className="step-number">3</div>
              <h4>Atomic Settlement</h4>
              <p>Single transaction settles entire multi-party swap</p>
            </div>
          </div>
        </section>

        {/* Active Sessions */}
        <section className="sessions-section">
          <div className="section-header-bar">
            <h3 className="section-title">⚡ Active Yellow Sessions</h3>
            <button className="refresh-button" onClick={loadSessions}>
              <span className="refresh-icon">🔄</span>
              Refresh
            </button>
          </div>

          {sessions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <p className="empty-text">No active sessions</p>
              <p className="empty-subtext">Execute a swap to see it here</p>
            </div>
          ) : (
            <div className="sessions-grid">
              {sessions.map((session, index) => (
                <div key={session.id} className="session-card" style={{ animationDelay: `${index * 0.1}s` }}>
                  <div className="session-header">
                    <span className="session-badge">{session.protocol || 'Yellow Network'}</span>
                    <span className={`session-status ${session.status}`}>
                      {session.status}
                    </span>
                  </div>
                  <div className="session-body">
                    <div className="session-stat">
                      <span className="session-label">Participants</span>
                      <span className="session-value">{session.participants}</span>
                    </div>
                    <div className="session-stat">
                      <span className="session-label">Version</span>
                      <span className="session-value">v{session.version || 1}</span>
                    </div>
                  </div>
                  <div className="session-id">
                    {session.yellowSessionId.slice(0, 30)}...
                  </div>
                  {session.created_at && (
                    <div className="session-time">
                      {new Date(session.created_at).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Gas Savings Comparison */}
        <section className="comparison-section">
          <h3 className="section-title">💰 Gas Savings Comparison</h3>
          <div className="comparison-grid">
            <div className="comparison-card traditional">
              <div className="comparison-label">Traditional</div>
              <div className="comparison-value">$250</div>
              <div className="comparison-detail">5 separate transactions</div>
            </div>
            <div className="comparison-arrow">→</div>
            <div className="comparison-card yellow">
              <div className="comparison-label">Yellow Network</div>
              <div className="comparison-value">$50</div>
              <div className="comparison-detail">1 batched settlement</div>
            </div>
            <div className="comparison-arrow">=</div>
            <div className="comparison-card savings">
              <div className="comparison-label">You Save</div>
              <div className="comparison-value">$200</div>
              <div className="comparison-detail">80% reduction</div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Built on Yellow Network • Multi-Party State Channels</p>
      </footer>
    </div>
  );
}

export default App;