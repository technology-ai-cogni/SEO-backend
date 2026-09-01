import { useState } from 'react';
import { Search, Eye, EyeOff, Lock, Mail, HelpCircle, Loader2 } from 'lucide-react';
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

  const accentColor = 'var(--accent, #7c3aed)';
  const accentGlow = 'rgba(124, 58, 237, 0.15)';

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
          } catch (_) {}
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
        const matched = localUsers.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
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

  const loginCard = (
    <div style={{
      width: '100%',
      maxWidth: 430,
      background: '#ffffff',
      border: '1px solid rgba(226, 232, 240, 0.9)',
      borderTop: `3.5px solid ${accentColor}`,
      borderRadius: 20,
      boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08), 0 1px 3px rgba(15, 23, 42, 0.04)',
      padding: '34px 30px',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      position: 'relative'
    }}>
      {/* Header Icon & Brand */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          width: 48,
          height: 48,
          background: '#f5f3ff',
          border: '1.5px solid #ddd6fe',
          borderRadius: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}>
          <Search size={24} color="var(--accent)" />
        </div>

        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 800,
          color: '#0f172a',
          lineHeight: 1.3,
          marginBottom: 6,
          letterSpacing: '-0.3px',
        }}>
          Welcome Back
        </h2>

        <p style={{
          fontSize: 13,
          color: '#64748b',
          lineHeight: 1.45,
          margin: 0,
        }}>
          Log in to access your SEO workspace
        </p>
      </div>

      {/* Already logged in Banner */}
      {user && (
        <div style={{
          background: '#f5f3ff',
          border: '1px solid #ddd6fe',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 20,
          textAlign: 'center'
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
            Currently logged in as {user.name || user.email}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              type="button"
              onClick={() => onNavigate('home')}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12.5,
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
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 12.5,
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
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 20,
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
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 20,
          textAlign: 'center',
          transition: 'all 0.2s ease'
        }}>
          {submittedMessage}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Email input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{
            fontSize: 13,
            fontWeight: 700,
            color: '#334155',
            fontFamily: 'var(--font-body)'
          }}>
            Email address
          </label>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#f8fafc',
            border: `1.5px solid ${focusedField === 'email' ? accentColor : '#e2e8f0'}`,
            borderRadius: 10,
            padding: '9px 13px',
            boxShadow: focusedField === 'email' ? `0 0 0 3.5px ${accentGlow}` : 'none',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <Mail size={16} color={focusedField === 'email' ? accentColor : "#94a3b8"} style={{ transition: 'color 0.2s' }} />
            <input
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              placeholder="Email@company.com"
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 13.5,
                color: '#0f172a',
                fontFamily: 'var(--font-body)',
                width: '100%'
              }}
            />
          </div>
        </div>

        {/* Password input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#334155',
              fontFamily: 'var(--font-body)'
            }}>
              Password
            </label>
            <a
              href="#forgot-password"
              onClick={(e) => {
                e.preventDefault();
                setShowForgotModal(true);
              }}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: accentColor,
                textDecoration: 'none',
                transition: 'color 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
              onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
            >
              Forgot your password?
            </a>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#f8fafc',
            border: `1.5px solid ${focusedField === 'password' ? accentColor : '#e2e8f0'}`,
            borderRadius: 10,
            padding: '9px 13px',
            boxShadow: focusedField === 'password' ? `0 0 0 3.5px ${accentGlow}` : 'none',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <Lock size={16} color={focusedField === 'password' ? accentColor : "#94a3b8"} style={{ transition: 'color 0.2s' }} />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              placeholder="••••••••"
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 13.5,
                color: '#0f172a',
                fontFamily: 'var(--font-body)',
                width: '100%'
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: '#94a3b8',
                transition: 'color 0.15s'
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: accentColor,
            color: '#ffffff',
            border: 'none',
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'var(--font-body)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.8 : 1,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: `0 4px 12px ${accentGlow}`
          }}
          onMouseEnter={e => { if (!isLoading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { if (!isLoading) e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Authenticating...</span>
            </>
          ) : (
            <span>Log in</span>
          )}
        </button>
      </form>
    </div>
  );

  return (
    <>
      {isEmbedded ? (
        loginCard
      ) : (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          padding: 24
        }}>
          {loginCard}
        </div>
      )}

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
