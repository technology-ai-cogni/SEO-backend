import { useState } from 'react';
import { Search, Eye, EyeOff, Lock, Mail, HelpCircle, Loader2, User } from 'lucide-react';
import { getApiBaseUrl } from '../../lib/projectsApi';

export default function LoginPage({ onNavigate, initialAdminMode = false, user = null, onLoginSuccess = null, onLogout = null, isEmbedded = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const accentColor = 'var(--accent, #7928ca)';
  const accentGlow = 'rgba(121, 40, 202, 0.2)';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmittedMessage('');

    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setIsLoading(true);

    let loggedInUser = null;

    try {
      let res = null;

      const apiBase = getApiBaseUrl();

      try {
        res = await fetch(`${apiBase}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password: password.trim() })
        });
      } catch (e) {
        console.warn('[LoginPage] Login connection error:', e);
      }

      if (res && res.status === 403) {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.detail || 'Access Denied: Your account profile has been disabled by an administrator.');
        setIsLoading(false);
        return;
      }

      if (res && res.ok) {
        const data = await res.json();
        if (data.access_token) {
          try {
            sessionStorage.setItem('seo_token', data.access_token);
          } catch (_) { }
        }
        let dbUser = data.user;

        if (dbUser && dbUser.status === 'Disabled') {
          setErrorMsg('Access Denied: Your account profile has been disabled by an administrator.');
          setIsLoading(false);
          return;
        }

        loggedInUser = dbUser || { email: email.trim(), name: email.split('@')[0], role: 'USER', status: 'Active' };
      } else if (res && !res.ok) {
        const errData = await res.json().catch(() => null);
        setErrorMsg(errData?.detail || 'Invalid email or password.');
        setIsLoading(false);
        return;
      } else {
        // Fallback: Check local storage users list if backend server is offline
        const localUsers = JSON.parse(localStorage.getItem('seo_users_list') || '[]');
        const matched = localUsers.find(u =>
          u.email?.toLowerCase() === email.trim().toLowerCase() ||
          u.name?.toLowerCase() === email.trim().toLowerCase()
        );
        if (matched) {
          if (matched.status === 'Disabled') {
            setErrorMsg('Access Denied: Your account profile has been disabled by an administrator.');
            setIsLoading(false);
            return;
          }
          loggedInUser = matched;
        } else {
          loggedInUser = { email: email.trim(), name: email.split('@')[0], role: 'USER', status: 'Active' };
        }
      }
    } catch (err) {
      setErrorMsg('Unable to connect to authentication server. Please try again.');
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
    setSubmittedMessage('Login successful!');

    if (onLoginSuccess && loggedInUser) {
      onLoginSuccess(loggedInUser);
    }
  };

  const loginView = (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: '#ffffff',
      boxSizing: 'border-box'
    }}>
      {/* Top Left: Hariba.ai Logo */}
      <div style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'flex-start',
        padding: '48px 30px 0',
        boxSizing: 'border-box'
      }}>
        <img
          src="/branding/hariba-logo-dark.png"
          alt="Hariba.ai"
          style={{ height: 34, width: 'auto', display: 'block', objectFit: 'contain' }}
        />
      </div>

      {/* Center: Purple User Avatar Icon + Pill Form */}
      <div style={{
        width: '100%',
        maxWidth: 340,
        margin: 'auto',
        padding: '24px 16px',
        boxSizing: 'border-box'
      }}>
        {/* Center: Purple User Avatar Icon with Glow */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 28
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #4A1A8C 0%, #6D28D9 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 24px -2px rgba(109, 40, 217, 0.45), 0 0 0 3px #ffffff',
            transition: 'transform 0.2s ease'
          }}>
            <User size={28} color="#ffffff" strokeWidth={2.2} />
          </div>
        </div>

        {/* Already logged in Banner */}
        {user && (
          <div style={{
            background: '#f5f3ff',
            border: '1px solid #ddd6fe',
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 18,
            textAlign: 'center'
          }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
              Currently logged in as {user.name || user.email}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => onNavigate('home')}
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 9999,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Go to Workspace
              </button>
              <button
                type="button"
                onClick={onLogout}
                style={{
                  background: '#ffffff',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: 9999,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Log Out
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMsg && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            color: '#dc2626',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 12.5,
            fontWeight: 500,
            marginBottom: 16,
            textAlign: 'center',
            transition: 'all 0.2s ease'
          }}>
            {errorMsg}
          </div>
        )}

        {/* Feedback Alert */}
        {submittedMessage && (
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 12.5,
            fontWeight: 500,
            marginBottom: 16,
            textAlign: 'center',
            transition: 'all 0.2s ease'
          }}>
            {submittedMessage}
          </div>
        )}

        {/* Form with Pill Inputs */}
        <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Username / Email input */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#ffffff',
            border: `1.5px solid ${focusedField === 'email' ? '#6D28D9' : '#cbd5e1'}`,
            borderRadius: 9999,
            padding: '11px 18px',
            boxShadow: focusedField === 'email' ? '0 0 0 3.5px rgba(109, 40, 217, 0.15)' : '0 1px 2px rgba(0,0,0,0.02)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <User size={16} color={focusedField === 'email' ? '#6D28D9' : '#64748b'} style={{ flexShrink: 0 }} />
            <input
              type="text"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              placeholder="USERNAME"
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '0.8px',
                color: '#0f172a',
                fontFamily: 'var(--font-body)',
                width: '100%'
              }}
            />
          </div>

          {/* Password input */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#ffffff',
            border: `1.5px solid ${focusedField === 'password' ? '#6D28D9' : '#cbd5e1'}`,
            borderRadius: 9999,
            padding: '11px 18px',
            boxShadow: focusedField === 'password' ? '0 0 0 3.5px rgba(109, 40, 217, 0.15)' : '0 1px 2px rgba(0,0,0,0.02)',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <Lock size={16} color={focusedField === 'password' ? '#6D28D9' : '#64748b'} style={{ flexShrink: 0 }} />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              placeholder="••••••••••••"
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 14,
                fontWeight: 600,
                color: '#0f172a',
                fontFamily: 'var(--font-body)',
                width: '100%',
                letterSpacing: showPassword ? 'normal' : '2px'
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s ease',
                flexShrink: 0
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#6D28D9'}
              onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Purple Pill LOGIN Button */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: 'linear-gradient(135deg, #4A1A8C 0%, #6D28D9 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 9999,
              padding: '13px 20px',
              fontSize: 13.5,
              fontWeight: 800,
              letterSpacing: '1.5px',
              fontFamily: 'var(--font-body)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.8 : 1,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: '0 12px 28px -4px rgba(109, 40, 217, 0.45), 0 4px 12px rgba(91, 33, 182, 0.25)'
            }}
            onMouseEnter={e => { if (!isLoading) { e.currentTarget.style.opacity = '0.94'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
            onMouseLeave={e => { if (!isLoading) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; } }}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>AUTHENTICATING...</span>
              </>
            ) : (
              <span>LOGIN</span>
            )}
          </button>

          {/* Forgot password link */}
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <a
              href="#forgot-password"
              onClick={(e) => {
                e.preventDefault();
                setShowForgotModal(true);
              }}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#64748b',
                textDecoration: 'none',
                transition: 'color 0.2s'
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#6D28D9'; e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.textDecoration = 'none'; }}
            >
              Forgot password?
            </a>
          </div>
        </form>
      </div>

      {/* Bottom spacer to perfectly balance the vertical center */}
      <div style={{ height: 44, width: '100%' }} />
    </div>
  );

  return (
    <>
      {loginView}

      {/* Forgot Password Modal Popup */}
      {showForgotModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20
        }}>
          <div style={{
            width: '100%',
            maxWidth: 400,
            background: '#ffffff',
            borderRadius: 16,
            padding: '28px 24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            textAlign: 'center'
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: '#fef3c7',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
              border: '1px solid #fde68a'
            }}>
              <HelpCircle size={24} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}>
              Password Reset Assistance
            </h3>
            <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              Please contact your system Administrator to reset your password or update your account credentials.
            </p>
            <button
              type="button"
              onClick={() => setShowForgotModal(false)}
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: 13.5,
                fontWeight: 700,
                color: '#ffffff',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}
