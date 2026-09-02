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
          width: 70%;
          position: relative;
          background: radial-gradient(circle at 85% 35%, rgba(95, 35, 155, 0.32) 0%, transparent 60%),
                      radial-gradient(circle at 12% 85%, rgba(185, 20, 105, 0.28) 0%, transparent 55%),
                      radial-gradient(circle at 45% 95%, rgba(85, 20, 135, 0.35) 0%, transparent 60%),
                      radial-gradient(circle at 15% 15%, rgba(45, 15, 75, 0.4) 0%, transparent 50%),
                      linear-gradient(175deg, #09060E 0%, #100A1A 38%, #170C24 68%, #1C0B29 100%);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 80px;
          color: #ffffff;
          overflow: hidden;
        }
        .right-panel {
          width: 30%;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          padding: 0;
          overflow-y: auto;
          position: relative;
          min-height: 100vh;
        }
        .landing-auth-wrapper {
          width: 100%;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          flex: 1;
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
        {/* Background Decorative Concentric Arcs - positioned strictly below text */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <circle cx="50" cy="145" r="71" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.25" />
          <circle cx="50" cy="145" r="65" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.25" />
          <circle cx="50" cy="145" r="59" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="0.25" />
          <circle cx="50" cy="145" r="53" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.25" />
          <circle cx="50" cy="145" r="47" fill="none" stroke="rgba(255,255,255,0.065)" strokeWidth="0.25" />
        </svg>


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
