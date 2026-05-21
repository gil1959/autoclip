// frontend/src/App.jsx
import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar.jsx';
import LoginCard from './components/LoginCard.jsx';
import Dashboard from './components/Dashboard.jsx';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('ac_jwt_token') || '');
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ac_user_data');
    return saved ? JSON.parse(saved) : null;
  });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isTikTokConnected, setIsTikTokConnected] = useState(false);
  const [tiktokMessage, setTiktokMessage] = useState(null);

  // Load active session from storage
  const handleLoginSuccess = (newToken, newUser) => {
    localStorage.setItem('ac_jwt_token', newToken);
    localStorage.setItem('ac_user_data', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('ac_jwt_token');
    localStorage.removeItem('ac_user_data');
    setToken('');
    setUser(null);
    setActiveTab('dashboard');
  };

  // Handle TikTok OAuth redirect callback parameters
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const tiktokStatus = query.get('tiktok');
    const reason = query.get('reason');

    if (tiktokStatus) {
      setActiveTab('settings');
      if (tiktokStatus === 'connected') {
        setIsTikTokConnected(true);
        setTiktokMessage({ type: 'success', text: 'TikTok account linked successfully! 🎉' });
      } else if (tiktokStatus === 'denied') {
        setTiktokMessage({ type: 'error', text: `TikTok linkage denied: ${reason || 'User cancelled'}` });
      } else if (tiktokStatus === 'error') {
        setTiktokMessage({ type: 'error', text: `TikTok linkage error: ${reason || 'Unknown error'}` });
      }
      
      // Strip parameters from URL without refreshing the page
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }, []);

  // Fetch TikTok connection status
  useEffect(() => {
    if (!token) return;

    // Check if user has TikTok credential saved
    const checkTikTok = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/post/tiktok/status', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setIsTikTokConnected(data.connected);
        }
      } catch (err) {
        // Non-critical background failure
      }
    };

    checkTikTok();
  }, [token]);

  const handleConnectTikTok = () => {
    // Standard OAuth initiation via custom redirect carrying JWT token in query
    window.location.href = `http://localhost:3000/auth/tiktok?token=${token}`;
  };

  return (
    <div className="w-full flex flex-col items-center" style={{ minHeight: '100vh', paddingBottom: '60px' }}>
      
      {/* Header and Navbar */}
      <Navbar 
        user={user} 
        onLogout={handleLogout} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab}
        isTikTokConnected={isTikTokConnected}
      />

      {/* Main Core View Area */}
      <main className="w-full" style={{ maxWidth: '1080px', padding: '0 24px' }}>
        {!user ? (
          <LoginCard onLoginSuccess={handleLoginSuccess} />
        ) : activeTab === 'dashboard' ? (
          <Dashboard token={token} />
        ) : (
          /* Integrations Page */
          <div className="glass-panel p-8" style={{ marginTop: '20px', textAlign: 'left' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px', fontFamily: 'var(--font-display)' }}>
              Integrations Hub
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '32px' }}>
              Connect your social channels to unlock fully automated, one-click posting.
            </p>

            {tiktokMessage && (
              <div 
                className={tiktokMessage.type === 'success' ? 'badge-success w-full' : 'badge-failed w-full'}
                style={{ padding: '12px', borderRadius: '8px', fontSize: '14px', marginBottom: '24px', textTransform: 'none', display: 'block', textAlign: 'center' }}
              >
                {tiktokMessage.text}
              </div>
            )}

            {/* TikTok Card */}
            <div className="glass-card flex justify-between items-center w-full" style={{ padding: '24px', background: 'rgba(25, 23, 54, 0.6)' }}>
              <div className="flex items-center gap-4">
                <span style={{ fontSize: '40px' }}>🎵</span>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>TikTok</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Publish 9:16 vertical shorts directly to your personal or business feed.
                  </p>
                </div>
              </div>
              
              <div>
                {isTikTokConnected ? (
                  <div className="flex items-center gap-4">
                    <span className="badge badge-success">Active Connection</span>
                    <button className="btn btn-secondary" onClick={() => setIsTikTokConnected(false)} style={{ padding: '8px 16px', fontSize: '13px' }}>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleConnectTikTok}
                    className="btn btn-primary"
                    style={{
                      background: 'linear-gradient(135deg, #ff0050 0%, #00f2fe 100%)',
                      boxShadow: '0 4px 15px rgba(255, 0, 80, 0.4)',
                      padding: '10px 20px',
                      fontSize: '14px'
                    }}
                  >
                    🚀 Connect TikTok account
                  </button>
                )}
              </div>
            </div>
            
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '32px', textAlign: 'center' }}>
              AutoClipper stores authentication credentials in high-security, encrypted database records.
            </p>
          </div>
        )}
      </main>

    </div>
  );
}
