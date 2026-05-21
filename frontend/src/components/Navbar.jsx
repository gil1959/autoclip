// frontend/src/components/Navbar.jsx
import React from 'react';

export default function Navbar({ user, onLogout, activeTab, setActiveTab, isTikTokConnected, onConnectTikTok }) {
  return (
    <nav className="glass-panel w-full" style={{ borderRadius: '0 0 16px 16px', padding: '16px 32px', marginBottom: '32px' }}>
      <div className="flex justify-between items-center w-full">
        {/* Logo Section */}
        <div className="flex items-center gap-2" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('dashboard')}>
          <span style={{ fontSize: '28px' }}>🎬</span>
          <h1 className="text-gradient" style={{ fontSize: '24px', margin: 0, padding: 0, fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            AutoClipper
          </h1>
        </div>

        {/* Navigation Tabs (Only if user is logged in) */}
        {user && (
          <div className="flex gap-4" style={{ marginLeft: 'auto', marginRight: '32px' }}>
            <button 
              className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '8px 16px', fontSize: '14px' }}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button 
              className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '8px 16px', fontSize: '14px' }}
              onClick={() => setActiveTab('settings')}
            >
              Integrations
            </button>
          </div>
        )}

        {/* User Info / Auth Controls */}
        {user ? (
          <div className="flex items-center gap-4">
            <div className="text-right" style={{ display: 'block' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{user.name || user.email.split('@')[0]}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {isTikTokConnected ? (
                  <span style={{ color: 'var(--accent-teal)' }}>● TikTok Connected</span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>● TikTok Disconnected</span>
                )}
              </p>
            </div>
            
            <button 
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '14px' }}
              onClick={onLogout}
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Empowered by Gemini 1.5 Pro ⚡
          </div>
        )}
      </div>
    </nav>
  );
}
