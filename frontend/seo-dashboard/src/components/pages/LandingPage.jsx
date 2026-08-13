import { Search } from 'lucide-react';
import LoginPage from './LoginPage';

export default function LandingPage({ activeTab, onNavigate, user, onLoginSuccess, onLogout }) {
  const currentTab = activeTab === 'admin-login' ? 'admin-login' : 'login';

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
          background: radial-gradient(circle at 85% 15%, rgba(124, 58, 237, 0.05) 0%, transparent 65%), #f8fafc;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 40px;
          overflow-y: auto;
          position: relative;
        }
        .landing-auth-wrapper {
          width: 100%;
          max-width: 430px;
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
        {/* Form Wrap */}
        <div className="landing-auth-wrapper">
          <LoginPage
            onNavigate={onNavigate}
            initialAdminMode={currentTab === 'admin-login'}
            user={user}
            onLoginSuccess={onLoginSuccess}
            onLogout={onLogout}
            isEmbedded={true}
          />
        </div>
      </div>
    </div>
  );
}
