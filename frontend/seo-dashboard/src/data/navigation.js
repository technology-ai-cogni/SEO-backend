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
          { id: 'position-analysis', label: 'Brand Discovery', path: 'search-visibility/position-analysis' },
          { id: 'ai-analysis', label: 'Top Pages (AI)', path: 'search-visibility/ai-analysis' },
          { id: 'top-pages', label: 'Top Pages (Organic)', path: 'search-visibility/top-pages' },
          { id: 'keywords', label: 'Keywords', path: 'search-visibility/keywords' },
          { id: 'competitors', label: 'Competitors', path: 'search-visibility/competitors' },
        ],
      },
      {
        label: 'Operations',
        type: 'section',
        items: [
          { id: 'off-page-scheduler', label: 'Off-Page', path: 'search-visibility/off-page-scheduler' },
          { id: 'calendar', label: 'Calendar', path: 'search-visibility/calendar' },
          { id: 'activity-table', label: 'Activity Table', path: 'search-visibility/activity-table' },
        ],
      },
    ],
  },
  {
    id: 'settings-menu',
    label: 'Settings',
    icon: 'Settings',
    path: 'settings',
    children: [
      {
        label: 'CONFIGURATION',
        type: 'section',
        items: [
          { id: 'general-settings', label: 'General', path: 'settings/general' },
          { id: 'project-setup', label: 'Project Setup', path: 'project-setup' },
        ],
      },
    ],
  },
];
