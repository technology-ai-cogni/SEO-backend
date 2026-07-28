import { Search, Asterisk } from 'lucide-react';
import LoginPage from './LoginPage';
import SignUpPage from './SignUpPage';

export default function LandingPage({ activeTab, onNavigate, user, onLoginSuccess, onLogout }) {
  const currentTab = activeTab === 'signup' ? 'signup' : (activeTab === 'admin-login' ? 'admin-login' : 'login');

  return (
    <div className="landing-container" style={{
      display: 'flex',
      minHeight: '100vh',
      width: '100%',
      background: '#ffffff',
      fontFamily: 'var(--font-body)',
      overflowX: 'hidden'
    }}>
      <style>{`
        .left-panel {
          width: 58%;
          position: relative;
          background: radial-gradient(circle at 20% 30%, var(--accent) 0%, var(--accent-hover) 60%, #1e1085 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 80px;
          color: #ffffff;
          overflow: hidden;
        }
        .right-panel {
          width: 42%;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 60px 40px;
          overflow-y: auto;
          position: relative;
        }
        .landing-auth-wrapper {
          width: 100%;
          max-width: 420px;
        }
        /* Custom overrides to strip LoginPage/SignUpPage cards and center wrappers */
        .landing-auth-wrapper > div {
          background: transparent !important;
          min-height: auto !important;
          padding: 0 !important;
        }
        .landing-auth-wrapper > div > div {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          max-width: 100% !important;
        }
        /* Hide the default header inside LoginPage and SignUpPage */
        .landing-auth-wrapper > div > div > div:first-of-type {
          display: none !important;
        }
        /* Hide the default already-logged-in banner inside LoginPage */
        .landing-auth-wrapper div[style*="var(--accent-light)"] {
          display: none !important;
        }
        /* Hide the default footer inside LoginPage and SignUpPage */
        .landing-auth-wrapper > div > div > div:last-child {
          display: none !important;
        }
        .landing-auth-wrapper-signup {
          max-width: 440px;
        }
        @media (max-width: 968px) {
          .landing-container {
            flex-direction: column !important;
          }
          .left-panel {
            width: 100% !important;
            height: auto !important;
            padding: 60px 40px !important;
          }
          .right-panel {
            width: 100% !important;
            height: auto !important;
            padding: 40px 20px 80px !important;
          }
        }
      `}</style>

      {/* Left Column (Information with matching brand indigo gradient and design) */}
      <div className="left-panel">
        {/* Background Decorative Arcs */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M-10,110 C20,60 80,60 110,110" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
          <path d="M-10,120 C20,65 80,65 110,120" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
          <path d="M-10,130 C20,70 80,70 110,130" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
          <path d="M-10,140 C20,75 80,75 110,140" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
        </svg>

        {/* Top: Search Logo & Brand Name in same line */}
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Search size={32} color="#ffffff" strokeWidth={2.5} style={{ marginLeft: -6 }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 24,
            color: '#ffffff',
            letterSpacing: '-0.5px'
          }}>
            SEO<span style={{ opacity: 0.9 }}>Vision</span>
          </span>
        </div>

        {/* Middle: Brand Header and Description */}
        <div style={{ position: 'relative', zIndex: 2, margin: 'auto 0' }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '3.8rem',
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.1,
            marginBottom: 24,
            letterSpacing: '-1.2px'
          }}>
            AI-Powered<br />
            SEO Intelligence
          </h1>

          <p style={{
            fontSize: '15px',
            color: 'rgba(255, 255, 255, 0.85)',
            lineHeight: 1.6,
            maxWidth: 460,
            fontWeight: 400
          }}>
            Monitor keyword rankings, discover AI Overview visibility, analyze competitors, manage keyword clusters, and gain actionable SEO insights from one intelligent dashboard.
          </p>
        </div>


      </div>

      {/* Right Column (Authentication Column) */}
      <div className="right-panel">
        {/* Brand header at the top of the right panel */}
        <div style={{
          width: '100%',
          maxWidth: currentTab === 'signup' ? 440 : 420,
          marginBottom: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          <Search size={28} color="var(--accent)" strokeWidth={3} style={{ marginLeft: -4 }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 20,
            color: 'var(--text-primary)',
            letterSpacing: '-0.4px'
          }}>
            SEO<span style={{ color: 'var(--accent)' }}>Vision</span>
          </span>
        </div>

        {/* Welcome Back / Create Account Header */}
        <div style={{
          width: '100%',
          maxWidth: currentTab === 'signup' ? 440 : 420,
          marginBottom: 24
        }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 0
          }}>
            {currentTab === 'signup' ? 'Create Account' : 'Welcome Back!'}
          </h2>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          maxWidth: currentTab === 'signup' ? 440 : 420,
          borderBottom: '1px solid var(--border)',
          marginBottom: 28,
          gap: 40
        }}>
          <button
            onClick={() => onNavigate('login')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              color: currentTab === 'login' || currentTab === 'admin-login' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              borderBottom: currentTab === 'login' || currentTab === 'admin-login' ? '2px solid var(--accent)' : 'none',
              marginBottom: -1,
              transition: 'all 0.15s ease'
            }}
          >
            Login
          </button>
          <button
            onClick={() => onNavigate('signup')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              color: currentTab === 'signup' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: 'pointer',
              fontFamily: 'var(--font-body)',
              borderBottom: currentTab === 'signup' ? '2px solid var(--accent)' : 'none',
              marginBottom: -1,
              transition: 'all 0.15s ease'
            }}
          >
            Sign Up
          </button>
        </div>

        {/* Form Wrap */}
        <div className={`landing-auth-wrapper ${currentTab === 'signup' ? 'landing-auth-wrapper-signup' : ''}`}>
          {currentTab === 'signup' ? (
            <SignUpPage
              onNavigate={onNavigate}
              user={user}
              onLoginSuccess={onLoginSuccess}
            />
          ) : (
            <LoginPage
              onNavigate={onNavigate}
              initialAdminMode={currentTab === 'admin-login'}
              user={user}
              onLoginSuccess={onLoginSuccess}
              onLogout={onLogout}
            />
          )}
        </div>

        {/* Admin Login Toggle Button (instead of Google button) */}
        {currentTab !== 'signup' && (
          <div style={{
            width: '100%',
            maxWidth: 420,
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            {/* Separator OR */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              margin: '12px 0 20px',
              color: 'var(--text-muted)',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.5px'
            }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
              <span style={{ padding: '0 12px' }}>OR</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--border)' }}></div>
            </div>

            {/* Login as Admin / User Button */}
            <button
              onClick={() => onNavigate(currentTab === 'admin-login' ? 'login' : 'admin-login')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                width: '100%',
                padding: '11px 16px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                boxShadow: 'var(--shadow)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--surface-2)';
                e.currentTarget.style.borderColor = 'var(--border-hover)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--surface)';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              {currentTab === 'admin-login' ? (
                <>
                  <span style={{ fontSize: '15px', display: 'flex', alignItems: 'center' }}>👤</span>
                  <span>Login as Standard User</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '15px', display: 'flex', alignItems: 'center' }}>🛡️</span>
                  <span>Login as Admin</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
