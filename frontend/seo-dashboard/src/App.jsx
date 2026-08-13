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
import LoginPage from './components/pages/LoginPage';
import SignUpPage from './components/pages/SignUpPage';
import ProfilePage from './components/pages/ProfilePage';
import LandingPage from './components/pages/LandingPage';
import LogsPage from './components/pages/LogsPage';
import RecycleBinPage from './components/pages/RecycleBinPage';
import UsersPage from './components/pages/UsersPage';
import { Lock } from 'lucide-react';
import { totalKeywordCount, topKeywords } from './data/mockData';
import { fetchUsersApi } from './lib/projectsApi';
import { canAccessRoute } from './lib/permissions';

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
  'project-setup': { title: 'Project Setup', subtitle: 'Manage domains, pages, competitors and connectors' },
  'project-setup/domain': { title: 'Project Setup · Domain', subtitle: 'Manage tracked domains' },
  'project-setup/pages': { title: 'Project Setup · Pages', subtitle: 'Manage target and blog pages' },
  'project-setup/competitors': { title: 'Project Setup · Competitors', subtitle: 'Track competitor domains' },
  'project-setup/outreach': { title: 'Project Setup · Outreach', subtitle: 'Manage link outreach' },
  'project-setup/connectors': { title: 'Project Setup · Connectors', subtitle: 'Connect data sources' },
  'search-visibility/position-analysis': { title: 'Brand Discovery', subtitle: `${totalKeywordCount.toLocaleString()} keywords` },
  'search-visibility/ai-analysis': { title: 'AI Analysis', subtitle: 'Mentions and Citations analytics across AI Search Engines' },
  'search-visibility/keywords': { title: 'Keywords', subtitle: `${totalKeywordCount.toLocaleString()} tracked keywords` },
  'search-visibility/top-pages': { title: 'Top Pages', subtitle: 'Best performing pages by organic traffic' },
  'search-visibility/link-outreach': { title: 'Link Outreach', subtitle: 'Manage backlink acquisition campaigns' },
  'search-visibility/off-page-scheduler': { title: 'Monthly Operations', subtitle: 'Schedule off-page SEO activities' },
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
    case 'profile': return <ProfilePage user={user} onUserUpdate={onLoginSuccess} onNavigate={onNavigate} />;
    case 'users': return <UsersPage user={user} onNavigate={onNavigate} />;
    case 'recycle-bin': return <RecycleBinPage user={user} onNavigate={onNavigate} />;
    case 'logs': return <LogsPage user={user} onNavigate={onNavigate} />;
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

  // Track user in a ref to avoid stale closures during async redirects (like LoginPage timeout)
  const userRef = useRef(user);
  const justLoggedInRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
    if (user?.role?.toUpperCase() === 'VENDOR' && activePath !== 'search-visibility/off-page-scheduler' && activePath !== 'profile') {
      setActivePath('search-visibility/off-page-scheduler');
    }
  }, [user]);

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
            alert('Your account profile has been disabled by an administrator. You have been logged out.');
            return;
          }

          const freshRole = currentRecord.role || user.role;
          const freshCategory = currentRecord.category || user.category;
          const freshSec = currentRecord.section_access || user.section_access || 'Default';
          const freshPerm = currentRecord.permissions || user.permissions || 'Default';

          if (
            user.role !== freshRole ||
            user.category !== freshCategory ||
            user.section_access !== freshSec ||
            user.permissions !== freshPerm
          ) {
            const updatedUser = {
              ...user,
              role: freshRole,
              category: freshCategory,
              section_access: freshSec,
              permissions: freshPerm
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
    if (currentUser?.role?.toUpperCase() === 'VENDOR' && path !== 'profile' && path !== 'notifications' && path !== 'help') {
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
    return renderPage(activePath, handleNavigate, user, handleLoginSuccess, handleLogout);
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
    </div>
  );
}

