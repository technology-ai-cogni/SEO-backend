import { useState, useRef, useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import HomePage from './components/pages/HomePage';
import DashboardPage from './components/pages/DashboardPage';
import AiAnalysisPage from './components/pages/AiAnalysisPage';
import PositionAnalysisPage from './components/pages/PositionAnalysisPage';
import KeywordsPage from './components/pages/KeywordsPage';
import TopPagesPage from './components/pages/TopPagesPage';
import AIVisibilityPage from './components/pages/AIVisibilityPage';
import ContentEnginePage from './components/pages/ContentEnginePage';
import ProjectSetupPage from './components/pages/ProjectSetupPage';
import CompetitorsPage from './components/pages/CompetitorsPage';
import PlaceholderPage from './components/pages/PlaceholderPage';
import OffPageSchedulerPage from './components/pages/OffPageSchedulerPage';
import CalendarPage from './components/pages/CalendarPage';
import GeneralSettingsPage from './components/pages/GeneralSettingsPage';
import LoginPage from './components/pages/LoginPage';
import SignUpPage from './components/pages/SignUpPage';
import ProfilePage from './components/pages/ProfilePage';
import LandingPage from './components/pages/LandingPage';
import LogsPage from './components/pages/LogsPage';
import RecycleBinPage from './components/pages/RecycleBinPage';
import UsersPage from './components/pages/UsersPage';
import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { totalKeywordCount, topKeywords } from './data/mockData';
import { fetchUsersApi } from './lib/projectsApi';
import { canAccessRoute } from './lib/permissions';

function AccountUpdateModal({ open, onClose, data }) {
  if (!open || !data) return null;

  const { isDisabled, changes = [] } = data;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 20,
          width: '100%',
          maxWidth: 480,
          padding: '28px 32px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        {isDisabled ? (
          <>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: '#fef2f2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
                border: '1px solid #fca5a5'
              }}
            >
              <ShieldAlert size={32} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 10px 0', fontFamily: 'var(--font-display, inherit)' }}>
              Account Profile Disabled
            </h2>
            <p style={{ fontSize: 14, color: '#475569', margin: '0 0 24px 0', lineHeight: 1.5 }}>
              Your account profile has been disabled by an administrator. You have been logged out.
            </p>
            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px 20px',
                fontSize: 14,
                fontWeight: 700,
                color: '#ffffff',
                background: '#dc2626',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(220, 38, 38, 0.3)'
              }}
            >
              Acknowledge & Exit
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
                border: '1px solid #bfdbfe'
              }}
            >
              <ShieldCheck size={32} />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0', fontFamily: 'var(--font-display, inherit)' }}>
              Account Permissions Updated
            </h2>
            <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px 0', lineHeight: 1.5 }}>
              An administrator has updated your account profile permissions:
            </p>
            
            <div
              style={{
                width: '100%',
                background: '#f8fafc',
                borderRadius: 12,
                padding: '16px 20px',
                border: '1px solid #e2e8f0',
                marginBottom: 24,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                textAlign: 'left'
              }}
            >
              {changes.map((chg, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>{chg.label}:</span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: '#2563eb',
                      background: '#dbeafe',
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 12
                    }}
                  >
                    {chg.value}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px 20px',
                fontSize: 14,
                fontWeight: 700,
                color: '#ffffff',
                background: '#2563eb',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
              }}
            >
              Got It
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const mockProject = {
  domain: "owis.org",
  name: "OWIS",
  location: "Singapore",
  slug: "owis"
};

const PAGE_TITLES = {
  'landing': { title: 'Welcome', subtitle: 'Access your SEO workspace' },
  'home': { title: 'Home', subtitle: 'Your SEO workspace overview' },
  'login': { title: 'User Login', subtitle: 'Access your SEO workspace' },
  'profile': { title: 'Account Settings', subtitle: 'Manage your profile and security settings' },
  'users': { title: 'User Management', subtitle: 'Create, manage, and configure user login credentials and profiles' },
  'recycle-bin': { title: 'System Recycle Bin', subtitle: 'Recover deleted projects, keywords, pages, and competitors' },
  'logs': { title: 'Activity Audit Logs', subtitle: 'Monitor system activity, administrative events, and user actions' },
  'notifications': { title: 'Notifications', subtitle: 'System notifications and workspace alerts' },
  'help': { title: 'Help & Support', subtitle: 'Documentation, guides, and assistance' },
  'signup': { title: 'Create Account', subtitle: 'Register for a new SEO workspace account' },
  'settings/general': { title: 'General Settings', subtitle: 'System notifications, users, logs, and general configuration' },
  'project-setup': { title: 'Project Setup', subtitle: 'Manage domains, pages, competitors and connectors' },
  'project-setup/domain': { title: 'Project Setup · Domain', subtitle: 'Manage tracked domains' },
  'project-setup/pages': { title: 'Project Setup · Pages', subtitle: 'Manage target and blog pages' },
  'project-setup/competitors': { title: 'Project Setup · Competitors', subtitle: 'Track competitor domains' },
  'project-setup/outreach': { title: 'Project Setup · Outreach', subtitle: 'Manage link outreach' },
  'project-setup/connectors': { title: 'Project Setup · Connectors', subtitle: 'Connect data sources' },
  'search-visibility/position-analysis': { title: 'Brand Discovery', subtitle: `${totalKeywordCount.toLocaleString()} keywords` },
  'search-visibility/ai-analysis': { title: 'Top Pages (AI)', subtitle: 'Mentions and Citations analytics across AI Search Engines' },
  'search-visibility/keywords': { title: 'Keywords', subtitle: `${totalKeywordCount.toLocaleString()} tracked keywords` },
  'search-visibility/top-pages': { title: 'Top Pages (Organic)', subtitle: 'Best performing pages by organic traffic' },
  'search-visibility/link-outreach': { title: 'Link Outreach', subtitle: 'Manage backlink acquisition campaigns' },
  'search-visibility/off-page-scheduler': { title: 'Monthly Operations', subtitle: 'Schedule off-page SEO activities' },
  'search-visibility/calendar': { title: 'Calendar', subtitle: 'Operations planning across Saved, Scheduled, and Approved activities' },
  'search-visibility/on-page': { title: 'On-Page Optimization', subtitle: 'On-page SEO recommendations' },
  'search-visibility/competitors': { title: 'Project', subtitle: 'Competitor SEO intelligence' },
  'search-visibility/search/overview': { title: 'Search Overview', subtitle: 'High-level search performance summary' },
  'search-visibility/search/predictive-analysis': { title: 'Predictive Analysis', subtitle: 'AI-powered rank predictions' },
  'search-visibility/search/domain-overview': { title: 'Domain Overview', subtitle: 'Full domain search metrics' },
  'search-visibility/search/site-health': { title: 'Site Health', subtitle: 'Technical SEO audit' },
  'ai-visibility': { title: 'AI Visibility', subtitle: 'Brand presence in AI-powered search' },
  'ai-visibility/overview': { title: 'AI Visibility Overview', subtitle: 'How AI engines see your brand' },
  'ai-visibility/brand-performance': { title: 'Brand Performance', subtitle: 'Brand mention analytics' },
  'ai-visibility/prompt-research': { title: 'Prompt Research', subtitle: 'Discover prompts where you should appear' },
  'ai-visibility/content-builder': { title: 'Content Builder', subtitle: 'Create AI-optimized content' },
  'ai-visibility/competitor-insights': { title: 'Competitor Insights', subtitle: 'How competitors appear in AI responses' },
  'content-engine': { title: 'Content Engine', subtitle: 'Content planning, trends, and calendar' },
  'content-engine/top-blogs': { title: 'Top Blogs', subtitle: 'Best performing blog posts' },
  'content-engine/search/trend-spotting': { title: 'Trend Spotting', subtitle: 'Rising search topics in your niche' },
  'content-engine/search/calendar-builder': { title: 'Calendar Builder', subtitle: 'Plan content around search trends' },
  'content-engine/search/calendar': { title: 'Content Calendar', subtitle: 'Scheduled and published content' },
  'content-engine/social/trend-spotting': { title: 'Social Trend Spotting', subtitle: 'Rising topics on social media' },
  'content-engine/social/calendar-builder': { title: 'Social Calendar Builder', subtitle: 'Plan social media content' },
  'content-engine/social/calendar': { title: 'Social Calendar', subtitle: 'Scheduled social media posts' },
  'content-engine/workflow-setup': { title: 'Workflow Setup', subtitle: 'Configure content workflows' },
  'content-engine/brand-setup': { title: 'Brand Setup', subtitle: 'Set brand voice and guidelines' },
};

function renderPage(path, onNavigate, user, onLoginSuccess, onLogout) {
  if (path === 'landing' || path === 'login' || path === 'signup' || path === 'admin-login') {
    return (
      <LandingPage
        activeTab={path}
        onNavigate={onNavigate}
        user={user}
        onLoginSuccess={onLoginSuccess}
        onLogout={onLogout}
      />
    );
  }

  if (!canAccessRoute(user, path)) {
    const isVendor = user?.role?.toUpperCase() === 'VENDOR';
    return (
      <div style={{ padding: 40, textAlign: 'center', background: '#f8fafc', minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          maxWidth: 480,
          background: '#ffffff',
          padding: 36,
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
        }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#fef2f2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto', border: '1px solid #fca5a5' }}>
            <Lock size={26} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>Section Access Restricted</h2>
          <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.5, margin: '0 0 20px 0' }}>
            Your account profile ({user?.role || 'User'}) does not have permission to view or change this section. Access is restricted by default unless explicitly granted by your system Administrator.
          </p>
          <button
            onClick={() => onNavigate(isVendor ? 'search-visibility/off-page-scheduler' : 'home')}
            style={{
              padding: '9px 20px',
              fontSize: 13,
              fontWeight: 600,
              color: '#ffffff',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            {isVendor ? 'Go to Monthly Operations' : 'Return to Home'}
          </button>
        </div>
      </div>
    );
  }

  switch (path) {
    case 'home': return <HomePage 
      onNavigate={onNavigate} 
      projects={[mockProject]}
      activeProject={mockProject}
      onStartAudit={(domain) => onNavigate('dashboard')}
    />;
    case 'login': return <LoginPage onNavigate={onNavigate} initialAdminMode={false} user={user} onLoginSuccess={onLoginSuccess} onLogout={onLogout} />;
    case 'admin-login': return <LoginPage onNavigate={onNavigate} initialAdminMode={true} user={user} onLoginSuccess={onLoginSuccess} onLogout={onLogout} />;
    case 'signup': return <SignUpPage onNavigate={onNavigate} user={user} onLoginSuccess={onLoginSuccess} />;
    case 'settings':
    case 'settings/general': return <GeneralSettingsPage initialTab="notifications" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'settings/notifications':
    case 'notifications': return <GeneralSettingsPage initialTab="notifications" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'settings/users':
    case 'users': return <GeneralSettingsPage initialTab="users" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'settings/recycle-bin':
    case 'recycle-bin': return <GeneralSettingsPage initialTab="recycle-bin" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'settings/logs':
    case 'logs': return <GeneralSettingsPage initialTab="logs" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'settings/profile':
    case 'profile': return <GeneralSettingsPage initialTab="settings" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'settings/help':
    case 'help': return <GeneralSettingsPage initialTab="help" user={user} onNavigate={onNavigate} onUserUpdate={onLoginSuccess} />;
    case 'dashboard': return <DashboardPage 
      activeProject={mockProject}
      keywords={topKeywords}
      user={user}
    />;
    case 'project-setup': return <ProjectSetupPage user={user} />;
    case 'search-visibility/position-analysis': return <PositionAnalysisPage onNavigate={onNavigate} user={user} />;
    case 'search-visibility/ai-analysis': return <AiAnalysisPage user={user} />;
    case 'search-visibility/keywords': return <KeywordsPage user={user} />;
    case 'search-visibility/top-pages': return <TopPagesPage user={user} />;
    case 'search-visibility/competitors': return <CompetitorsPage user={user} />;
    case 'ai-visibility':
    case 'ai-visibility/overview':
    case 'ai-visibility/brand-performance':
    case 'ai-visibility/competitor-insights': return <AIVisibilityPage />;
    case 'search-visibility/off-page-scheduler': return <OffPageSchedulerPage user={user} />;
    case 'search-visibility/calendar': return <CalendarPage user={user} />;
    case 'content-engine': return <ContentEnginePage />;
    default: {
      const info = PAGE_TITLES[path];
      return <PlaceholderPage title={info?.title || path} />;
    }
  }
}

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('seo_dashboard_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [activePath, setActivePath] = useState(() => {
    try {
      const saved = sessionStorage.getItem('seo_dashboard_user');
      if (saved) {
        const uData = JSON.parse(saved);
        if (uData?.role?.toUpperCase() === 'VENDOR') {
          return 'search-visibility/off-page-scheduler';
        }
        return 'search-visibility/position-analysis';
      }
      return 'landing';
    } catch (e) {
      return 'landing';
    }
  });

  const [accountUpdateModal, setAccountUpdateModal] = useState(null);

  // Track user in a ref to avoid stale closures during async redirects (like LoginPage timeout)
  const userRef = useRef(user);
  const justLoggedInRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
    if (user?.role?.toUpperCase() === 'VENDOR' && activePath !== 'search-visibility/off-page-scheduler' && activePath !== 'profile' && activePath !== 'help' && activePath !== 'notifications') {
      setActivePath('search-visibility/off-page-scheduler');
    }
  }, [user, activePath]);

  // Periodically & on page navigation, verify logged-in user account status & sync live permissions
  useEffect(() => {
    if (!user || !user.email) return;

    let isMounted = true;
    const checkUserStatus = async () => {
      try {
        const users = await fetchUsersApi();
        if (!isMounted) return;
        const currentRecord = users.find(u => u.email?.toLowerCase() === user.email?.toLowerCase());
        if (currentRecord) {
          if (currentRecord.status === 'Disabled') {
            handleLogout();
            setAccountUpdateModal({ isDisabled: true });
            return;
          }

          const freshRole = currentRecord.role || user.role;
          const freshCategory = currentRecord.category || user.category;
          const freshSec = currentRecord.section_access || user.section_access || 'Default';
          const freshPerm = currentRecord.permissions || user.permissions || 'Default';
          const freshProject = currentRecord.assigned_project || user.assigned_project || 'All Projects';

          if (
            user.role !== freshRole ||
            user.category !== freshCategory ||
            user.section_access !== freshSec ||
            user.permissions !== freshPerm ||
            user.assigned_project !== freshProject
          ) {
            const changes = [];
            if (user.permissions !== freshPerm) changes.push({ label: 'Action Permissions', value: freshPerm });
            if (user.section_access !== freshSec) changes.push({ label: 'Section Access', value: freshSec });
            if (user.role !== freshRole) changes.push({ label: 'Role', value: freshRole });
            if (user.category !== freshCategory) changes.push({ label: 'Category', value: freshCategory });
            if (user.assigned_project !== freshProject) changes.push({ label: 'Assigned Project', value: freshProject });

            const updatedUser = {
              ...user,
              role: freshRole,
              category: freshCategory,
              section_access: freshSec,
              permissions: freshPerm,
              assigned_project: freshProject
            };
            setUser(updatedUser);
            sessionStorage.setItem('seo_dashboard_user', JSON.stringify(updatedUser));
          }
        }
      } catch (e) {}
    };

    checkUserStatus();
    const timer = setInterval(checkUserStatus, 3000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [user, activePath]);

  const handleNavigate = (path) => {
    const currentUser = userRef.current;
    if (currentUser?.role?.toUpperCase() === 'VENDOR' && path !== 'profile' && path !== 'notifications' && path !== 'help' && path !== 'search-visibility/off-page-scheduler') {
      setActivePath('search-visibility/off-page-scheduler');
      return;
    }

    if (currentUser && (path === 'landing' || path === 'login' || path === 'signup' || path === 'admin-login')) {
      setActivePath(currentUser?.role?.toUpperCase() === 'VENDOR' ? 'search-visibility/off-page-scheduler' : 'search-visibility/position-analysis');
    } else if (currentUser && path === 'home') {
      if (justLoggedInRef.current) {
        justLoggedInRef.current = false;
        setActivePath(currentUser?.role?.toUpperCase() === 'VENDOR' ? 'search-visibility/off-page-scheduler' : 'search-visibility/position-analysis');
      } else {
        setActivePath(currentUser?.role?.toUpperCase() === 'VENDOR' ? 'search-visibility/off-page-scheduler' : 'home');
      }
    } else if (!currentUser && (path !== 'landing' && path !== 'login' && path !== 'signup' && path !== 'admin-login')) {
      setActivePath('landing');
    } else {
      setActivePath(path);
    }
  };

  const handleLoginSuccess = (userData) => {
    justLoggedInRef.current = true;
    setUser(userData);
    try {
      sessionStorage.setItem('seo_dashboard_user', JSON.stringify(userData));
    } catch (e) {}

    const role = userData?.role?.toUpperCase();
    const secAccess = userData?.section_access;

    if (role === 'VENDOR') {
      setActivePath('search-visibility/off-page-scheduler');
    } else if (secAccess === 'Project Setup') {
      setActivePath('project-setup');
    } else if (secAccess === 'Search Visibility') {
      setActivePath('search-visibility/position-analysis');
    } else if (secAccess === 'AI Visibility') {
      setActivePath('ai-visibility/overview');
    } else if (secAccess === 'Content Engine') {
      setActivePath('content-engine');
    } else {
      setActivePath('search-visibility/position-analysis');
    }
  };

  const handleLogout = () => {
    justLoggedInRef.current = false;
    setUser(null);
    try {
      sessionStorage.removeItem('seo_dashboard_user');
    } catch (e) {}
    setActivePath('landing');
  };

  const isAuthPage = activePath === 'landing' || activePath === 'login' || activePath === 'signup' || activePath === 'admin-login';
  const pageInfo = PAGE_TITLES[activePath] || { title: activePath, subtitle: '' };

  if (isAuthPage) {
    return (
      <>
        {renderPage(activePath, handleNavigate, user, handleLoginSuccess, handleLogout)}
        <AccountUpdateModal open={Boolean(accountUpdateModal)} data={accountUpdateModal} onClose={() => setAccountUpdateModal(null)} />
      </>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar activePath={activePath} onNavigate={handleNavigate} user={user} />
      <div style={{ marginLeft: 'var(--sidebar-w)', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar
          title={pageInfo.title}
          subtitle={pageInfo.subtitle}
          activePath={activePath}
          onNavigate={handleNavigate}
          user={user}
          onLogout={handleLogout}
        />
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
          {renderPage(activePath, handleNavigate, user, handleLoginSuccess, handleLogout)}
        </main>
      </div>
      <AccountUpdateModal open={Boolean(accountUpdateModal)} data={accountUpdateModal} onClose={() => setAccountUpdateModal(null)} />
    </div>
  );
}
