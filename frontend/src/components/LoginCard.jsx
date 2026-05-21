// frontend/src/components/LoginCard.jsx
import React, { useState } from 'react';

export default function LoginCard({ onLoginSuccess }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    
    setLoading(true);
    const endpoint = isRegister ? '/auth/register' : '/auth/login';
    const payload = isRegister ? { email, password, name } : { email, password };
    
    try {
      const response = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong.');
      }
      
      if (data.success && data.token) {
        onLoginSuccess(data.token, data.user);
      } else {
        throw new Error('Authentication failed.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center w-full" style={{ padding: '40px 20px', minHeight: '60vh' }}>
      <div className="glass-panel" style={{ width: '420px', padding: '40px', position: 'relative', overflow: 'hidden' }}>
        {/* Aesthetic Background Glows */}
        <div style={{
          position: 'absolute',
          top: '-50px',
          right: '-50px',
          width: '150px',
          height: '150px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-purple) 0%, transparent 70%)',
          opacity: 0.3,
          zIndex: 0,
          pointerEvents: 'none'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-50px',
          left: '-50px',
          width: '150px',
          height: '150px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-indigo) 0%, transparent 70%)',
          opacity: 0.3,
          zIndex: 0,
          pointerEvents: 'none'
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: '28px', textAlign: 'center', marginBottom: '8px', fontWeight: 800 }}>
            {isRegister ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '14px', marginBottom: '24px' }}>
            {isRegister ? 'Start clipping and scaling your content' : 'Sign in to access your video pipeline'}
          </p>

          {error && (
            <div className="badge-failed w-full text-center" style={{ padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', textTransform: 'none', display: 'block' }}>
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isRegister && (
              <div className="flex flex-col gap-2">
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Full Name</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="John Doe" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Email Address *</label>
              <input 
                type="email" 
                className="input-field" 
                placeholder="john@example.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Password *</label>
              <input 
                type="password" 
                className="input-field" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-primary w-full mt-4" 
              style={{ padding: '14px' }}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="spin" style={{ display: 'inline-block', fontSize: '16px' }}>⚡</span>
                  Please wait...
                </>
              ) : (
                isRegister ? 'Create Account' : 'Sign In'
              )}
            </button>
          </form>

          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {isRegister ? 'Already have an account? ' : 'New to AutoClipper? '}
            </span>
            <button 
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-indigo)',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
              }}
              disabled={loading}
            >
              {isRegister ? 'Sign In' : 'Sign Up Free'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
