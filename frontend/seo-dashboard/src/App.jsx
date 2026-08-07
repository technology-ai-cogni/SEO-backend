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
import { totalKeywordCount, topKeywords } from './data/mockData';

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
  'search-visibility/sales-pipeline': { title: 'Sales Pipeline', subtitle: 'Track keyword-to-conversion funnel' },
  'search-visibility/link-outreach': { title: 'Link Outreach', subtitle: 'Manage backlink acquisition campaigns' },
  'search-visibility/off-page-scheduler': { title: 'Off-Page Scheduler', subtitle: 'Schedule off-page SEO activities' },
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
    case 'dashboard': return <DashboardPage 
      activeProject={mockProject}
      keywords={topKeywords}
      user={user}
    />;
    case 'project-setup': return <ProjectSetupPage user={user} />;
    case 'search-visibility/position-analysis': return <PositionAnalysisPage onNavigate={onNavigate} />;
    case 'search-visibility/ai-analysis': return <AiAnalysisPage />;
    case 'search-visibility/keywords': return <KeywordsPage />;
    case 'search-visibility/top-pages': return <TopPagesPage />;
    case 'search-visibility/competitors': return <CompetitorsPage />;
    case 'ai-visibility':
    case 'ai-visibility/overview':
    case 'ai-visibility/brand-performance':
    case 'ai-visibility/competitor-insights': return <AIVisibilityPage />;
    case 'search-visibility/off-page-scheduler': return <OffPageSchedulerPage />;
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
      return saved ? 'search-visibility/position-analysis' : 'landing';
    } catch (e) {
      return 'landing';
    }
  });

  // Track user in a ref to avoid stale closures during async redirects (like LoginPage timeout)
  const userRef = useRef(user);
  const justLoggedInRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const handleNavigate = (path) => {
    const currentUser = userRef.current;
    if (currentUser && (path === 'landing' || path === 'login' || path === 'signup' || path === 'admin-login')) {
      setActivePath('search-visibility/position-analysis');
    } else if (currentUser && path === 'home') {
      if (justLoggedInRef.current) {
        justLoggedInRef.current = false;
        setActivePath('search-visibility/position-analysis');
      } else {
        setActivePath('home');
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
    setActivePath('search-visibility/position-analysis');
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
      <Sidebar activePath={activePath} onNavigate={handleNavigate} />
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

