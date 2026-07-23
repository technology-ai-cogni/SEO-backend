import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import HomePage from './components/pages/HomePage';
import DashboardPage from './components/pages/DashboardPage';
import PositionAnalysisPage from './components/pages/PositionAnalysisPage';
import KeywordsPage from './components/pages/KeywordsPage';
import TopPagesPage from './components/pages/TopPagesPage';
import AIVisibilityPage from './components/pages/AIVisibilityPage';
import ContentEnginePage from './components/pages/ContentEnginePage';
import ProjectSetupPage from './components/pages/ProjectSetupPage';
import CompetitorsPage from './components/pages/CompetitorsPage';
import PlaceholderPage from './components/pages/PlaceholderPage';
import { totalKeywordCount } from './data/mockData';

const PAGE_TITLES = {
  'home': { title: 'Home', subtitle: 'Your SEO workspace overview' },
  'project-setup': { title: 'Project Setup', subtitle: 'Manage domains, pages, competitors and connectors' },
  'project-setup/domain': { title: 'Project Setup · Domain', subtitle: 'Manage tracked domains' },
  'project-setup/pages': { title: 'Project Setup · Pages', subtitle: 'Manage target and blog pages' },
  'project-setup/competitors': { title: 'Project Setup · Competitors', subtitle: 'Track competitor domains' },
  'project-setup/outreach': { title: 'Project Setup · Outreach', subtitle: 'Manage link outreach' },
  'project-setup/connectors': { title: 'Project Setup · Connectors', subtitle: 'Connect data sources' },
  'search-visibility/position-analysis': { title: 'Position Tracking', subtitle: `OWIS · Singapore · Google · ${totalKeywordCount.toLocaleString()} keywords` },
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

function renderPage(path, onNavigate) {
  switch (path) {
    case 'home': return <HomePage onNavigate={onNavigate} />;
    case 'dashboard': return <DashboardPage />;
    case 'project-setup': return <ProjectSetupPage />;
    case 'search-visibility/position-analysis': return <PositionAnalysisPage onNavigate={onNavigate} />;
    case 'search-visibility/keywords': return <KeywordsPage />;
    case 'search-visibility/top-pages': return <TopPagesPage />;
    case 'search-visibility/competitors': return <CompetitorsPage />;
    case 'ai-visibility':
    case 'ai-visibility/overview':
    case 'ai-visibility/brand-performance':
    case 'ai-visibility/competitor-insights': return <AIVisibilityPage />;
    case 'content-engine': return <ContentEnginePage />;
    default: {
      const info = PAGE_TITLES[path];
      return <PlaceholderPage title={info?.title || path} />;
    }
  }
}

export default function App() {
  const [activePath, setActivePath] = useState('home');

  const pageInfo = PAGE_TITLES[activePath] || { title: activePath, subtitle: '' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar activePath={activePath} onNavigate={setActivePath} />
      <div style={{ marginLeft: 'var(--sidebar-w)', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Topbar title={pageInfo.title} subtitle={pageInfo.subtitle} />
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
          {renderPage(activePath, setActivePath)}
        </main>
      </div>
    </div>
  );
}
