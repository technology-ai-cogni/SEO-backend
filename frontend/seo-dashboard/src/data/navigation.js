// Navigation structure derived from the Google Sheets sitemap
export const NAV_STRUCTURE = [
  {
    id: 'home',
    label: 'Home',
    icon: 'Home',
    path: 'home',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    path: 'dashboard',
  },
  {
    id: 'project-setup',
    label: 'Project Setup',
    icon: 'FolderOpen',
    path: 'project-setup',
  },
  {
    id: 'search-visibility',
    label: 'Search Visibility',
    icon: 'Search',
    path: 'search-visibility',
    color: '#f9e4e4',
    children: [
      {
        label: 'Performance',
        type: 'section',
        items: [
          { id: 'position-analysis', label: 'Position Analysis', path: 'search-visibility/position-analysis' },
          { id: 'keywords', label: 'Keywords', path: 'search-visibility/keywords' },
          { id: 'top-pages', label: 'Top Pages', path: 'search-visibility/top-pages' },
          { id: 'sales-pipeline', label: 'Sales Pipeline', path: 'search-visibility/sales-pipeline' },
        ],
      },
      {
        label: 'Operations',
        type: 'section',
        items: [
          { id: 'link-outreach', label: 'Link Outreach', path: 'search-visibility/link-outreach' },
          { id: 'off-page-scheduler', label: 'Off-Page Scheduler', path: 'search-visibility/off-page-scheduler' },
          { id: 'on-page', label: 'On-Page', path: 'search-visibility/on-page' },
          { id: 'competitors', label: 'Competitors', path: 'search-visibility/competitors' },
        ],
      },
      // Search sub-module (col C)
      {
        label: 'Search',
        type: 'section',
        items: [
          { id: 'search-overview', label: 'Overview', path: 'search-visibility/search/overview' },
          { id: 'predictive-analysis', label: 'Predictive Analysis', path: 'search-visibility/search/predictive-analysis' },
          { id: 'domain-overview', label: 'Domain Overview', path: 'search-visibility/search/domain-overview' },
          { id: 'site-health', label: 'Site Health', path: 'search-visibility/search/site-health' },
        ],
      },
    ],
  },
  {
    id: 'ai-visibility',
    label: 'AI Visibility',
    icon: 'Sparkles',
    path: 'ai-visibility',
    color: '#fef9e4',
    children: [
      {
        label: 'Performance',
        type: 'section',
        items: [
          { id: 'ai-overview', label: 'Overview', path: 'ai-visibility/overview' },
          { id: 'ai-brand-performance', label: 'Brand Performance', path: 'ai-visibility/brand-performance' },
        ],
      },
      {
        label: 'Operations',
        type: 'section',
        items: [
          { id: 'prompt-research', label: 'Prompt Research', path: 'ai-visibility/prompt-research' },
          { id: 'content-builder', label: 'Content Builder', path: 'ai-visibility/content-builder' },
          { id: 'competitor-insights', label: 'Competitor Insights', path: 'ai-visibility/competitor-insights' },
        ],
      },
    ],
  },
  {
    id: 'content-engine',
    label: 'Content Engine',
    icon: 'FileText',
    path: 'content-engine',
    color: '#e4ecf9',
    children: [
      {
        label: 'Performance',
        type: 'section',
        items: [
          { id: 'top-blogs', label: 'Top Blogs', path: 'content-engine/top-blogs' },
        ],
      },
      {
        label: 'Search',
        type: 'section',
        items: [
          { id: 'trend-spotting', label: 'Trend Spotting', path: 'content-engine/search/trend-spotting' },
          { id: 'calendar-builder', label: 'Calendar Builder', path: 'content-engine/search/calendar-builder' },
          { id: 'calendar', label: 'Calendar', path: 'content-engine/search/calendar' },
        ],
      },
      {
        label: 'Social',
        type: 'section',
        items: [
          { id: 'social-trend-spotting', label: 'Trend Spotting', path: 'content-engine/social/trend-spotting' },
          { id: 'social-calendar-builder', label: 'Calendar Builder', path: 'content-engine/social/calendar-builder' },
          { id: 'social-calendar', label: 'Calendar', path: 'content-engine/social/calendar' },
        ],
      },
      {
        label: 'Configurations',
        type: 'section',
        items: [
          { id: 'workflow-setup', label: 'Workflow Setup', path: 'content-engine/workflow-setup' },
          { id: 'brand-setup', label: 'Brand Setup', path: 'content-engine/brand-setup' },
        ],
      },
    ],
  },
];
