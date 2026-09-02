import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Search, ChevronDown, CheckCircle, Lock, ShieldAlert, Calendar, Sparkles, RefreshCw } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchDomainRows, fetchKeywordRows, fetchPageRows, runAiVisibilityAnalysis, fetchProjectSummaryApi, fetchDomainMetricsApi, runOrganicRankCheckApi, fetchAiAnalysisHistory } from '../../lib/projectsApi';
import { hasPermission, PERMISSIONS, isReadOnlyUser, canRunActions, canRunBrandDiscovery, isAssociateUser, canRunAiModelAnalysis, recordAiModelAnalysisRun } from '../../lib/permissions';

function AiVisibilityArcGauge({ visibility = 0, mentions = 0, citedPages = 0, kwMentionsList = [], kwCitationsList = [], totalKeywords = 0, projectTotalKeywords = 0 }) {
  const [hoverType, setHoverType] = useState(null); // null | 'mentions' | 'cited'
  const hoverTimeoutRef = useRef(null);

  const handleMouseEnter = (type) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoverType(type);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHoverType(null);
    }, 300);
  };

  const runKeywords = totalKeywords || 0;
  const projectTotal = projectTotalKeywords || runKeywords || 0;

  // Progress percentage based on ratio of keywords run vs project total keywords
  const keywordsRatioPercent = projectTotal > 0 ? Math.min(100, (runKeywords / projectTotal) * 100) : 0;

  let currentValue = keywordsRatioPercent;
  let currentLabel = hoverType === 'mentions' ? 'Mentions' : hoverType === 'cited' ? 'Cited pages' : '';
  let centerText = hoverType === 'mentions' ? `${mentions}` : hoverType === 'cited' ? `${citedPages}` : `${runKeywords} / ${projectTotal}`;

  if (hoverType === 'mentions') {
    currentValue = projectTotal > 0 ? Math.min(100, (mentions / projectTotal) * 100) : 0;
  } else if (hoverType === 'cited') {
    currentValue = projectTotal > 0 ? Math.min(100, (citedPages / projectTotal) * 100) : 0;
  }

  const radius = 60;
  const strokeWidth = 12;
  const circumference = Math.PI * radius;
  const progressOffset = circumference - (Math.min(Math.max(currentValue, 0), 100) / 100) * circumference;

  const strokeColor = hoverType === 'mentions' ? '#2563eb' : hoverType === 'cited' ? '#7c3aed' : '#8b5cf6';

  return (
    <div style={{
      background: '#7f4747ff',
      border: '1px solid #46576dff',
      borderRadius: 12,
      padding: '14px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      width: '100%'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        gap: 20,
        width: '100%'
      }}>
        {/* LEFT SIDE: Compact Arc Gauge Graph */}
        <div style={{ position: 'relative', width: 150, height: 85, display: 'flex', justifyContent: 'center' }}>
          <svg width="150" height="85" viewBox="0 0 150 85">
            <path
              d="M 15 75 A 60 60 0 0 1 135 75"
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
            <path
              d="M 15 75 A 60 60 0 0 1 135 75"
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={progressOffset}
              style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s ease' }}
            />
          </svg>

          <div style={{
            position: 'absolute',
            top: currentLabel ? 26 : 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: centerText.length > 5 ? 19 : 28, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
              {centerText}
            </span>
            {currentLabel && (
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b', marginTop: 3 }}>
                {currentLabel}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT SIDE: Mentions & Cited Pages metrics with Hover Keyword Popovers */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28
        }}>
          {/* Mentions Metric Box */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => handleMouseEnter('mentions')}
            onMouseLeave={handleMouseLeave}
          >
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: 'pointer',
              padding: '8px 14px',
              borderRadius: 10,
              backgroundColor: hoverType === 'mentions' ? '#eff6ff' : '#f8fafc',
              border: hoverType === 'mentions' ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
              transition: 'all 0.15s',
              minWidth: 90
            }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#0f172a' }}>{mentions}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginTop: 2 }}>Mentions</span>
            </div>

            {/* Mentions Hover Keywords Popover */}
            {hoverType === 'mentions' && (
              <div
                onMouseEnter={() => handleMouseEnter('mentions')}
                onMouseLeave={handleMouseLeave}
                style={{
                  position: 'absolute',
                  bottom: '105%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  paddingBottom: 6,
                  zIndex: 1000
                }}
              >
                <div style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  padding: 12,
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.12)',
                  width: 250,
                  maxHeight: 180,
                  overflowY: 'auto'
                }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#2563eb', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #f1f5f9' }}>
                    Mentioned Keywords ({mentions})
                  </div>
                  {kwMentionsList.length > 0 ? (
                    kwMentionsList.map((kw, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: '#1e293b', marginBottom: 4, fontWeight: 600 }}>
                        {i + 1}. "{kw}"
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 11.5, color: '#64748b', fontStyle: 'italic' }}>
                      No brand mentions found for target domain.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cited Pages Metric Box */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => handleMouseEnter('cited')}
            onMouseLeave={handleMouseLeave}
          >
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: 'pointer',
              padding: '8px 14px',
              borderRadius: 10,
              backgroundColor: hoverType === 'cited' ? '#f5f3ff' : '#f8fafc',
              border: hoverType === 'cited' ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
              transition: 'all 0.15s',
              minWidth: 90
            }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#7c3aed' }}>{citedPages}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#7c3aed', marginTop: 2 }}>Cited pages</span>
            </div>

            {/* Cited Pages Hover Keywords Popover */}
            {hoverType === 'cited' && (
              <div
                onMouseEnter={() => handleMouseEnter('cited')}
                onMouseLeave={handleMouseLeave}
                style={{
                  position: 'absolute',
                  bottom: '105%',
                  right: 0,
                  paddingBottom: 6,
                  zIndex: 1000
                }}
              >
                <div style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  padding: 12,
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.12)',
                  width: 270,
                  maxHeight: 180,
                  overflowY: 'auto'
                }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#7c3aed', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #f1f5f9' }}>
                    Cited Pages ({citedPages})
                  </div>
                  {kwCitationsList.length > 0 ? (
                    kwCitationsList.map((item, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: '#1e293b', marginBottom: 4, fontWeight: 600 }}>
                        {i + 1}. {item}
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 11.5, color: '#64748b', fontStyle: 'italic' }}>
                      No cited pages found for target domain.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function extractTop2PerCategory(kws) {
  if (!kws || kws.length === 0) return [];
  const groups = {};
  kws.forEach(k => {
    const cat = k.category || k.category_name || k.targetSubtype || k.subtype || k.cluster || '-';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(k);
  });

  const selected = [];
  Object.keys(groups).sort().forEach(cat => {
    const sortedInCat = [...groups[cat]].sort((a, b) => {
      const parseNum = (val) => {
        if (val == null) return null;
        const n = Number(String(val).replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      const svA = parseNum(a.sv ?? a.search_volume ?? a.volume ?? a.searchVolume);
      const svB = parseNum(b.sv ?? b.search_volume ?? b.volume ?? b.searchVolume);

      // 1. If SV is present for both or either, prioritize higher SV
      if (svA !== null || svB !== null) {
        const valA = svA ?? -1;
        const valB = svB ?? -1;
        if (valA !== valB) return valB - valA;
      }

      // 2. If SV is not present or equal, sort deterministically by rank (ascending)
      const rankA = parseNum(a.rank) ?? 999;
      const rankB = parseNum(b.rank) ?? 999;
      if (rankA !== rankB) return rankA - rankB;

      // 3. Fallback to alphabetical text sorting
      const textA = String(a.kw || a.keyword || '');
      const textB = String(b.kw || b.keyword || '');
      return textA.localeCompare(textB);
    });

    const top2 = sortedInCat.slice(0, 2);
    top2.forEach(item => {
      const keywordStr = String(item.kw || item.keyword || '').trim();
      if (keywordStr && !selected.includes(keywordStr)) {
        selected.push(keywordStr);
      }
    });
  });

  return selected;
}

const COUNTRY_OPTIONS = [
  { code: 'AF', flag: '🇦🇫', name: 'Afghanistan' },
  { code: 'AL', flag: '🇦🇱', name: 'Albania' },
  { code: 'DZ', flag: '🇩🇿', name: 'Algeria' },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia' },
  { code: 'AT', flag: '🇦🇹', name: 'Austria' },
  { code: 'BD', flag: '🇧🇩', name: 'Bangladesh' },
  { code: 'BE', flag: '🇧🇪', name: 'Belgium' },
  { code: 'BR', flag: '🇧🇷', name: 'Brazil' },
  { code: 'CA', flag: '🇨🇦', name: 'Canada' },
  { code: 'CL', flag: '🇨🇱', name: 'Chile' },
  { code: 'CN', flag: '🇨🇳', name: 'China' },
  { code: 'CO', flag: '🇨🇴', name: 'Colombia' },
  { code: 'CZ', flag: '🇨🇿', name: 'Czech Republic' },
  { code: 'DK', flag: '🇩🇰', name: 'Denmark' },
  { code: 'EG', flag: '🇪🇬', name: 'Egypt' },
  { code: 'FI', flag: '🇫🇮', name: 'Finland' },
  { code: 'FR', flag: '🇫🇷', name: 'France' },
  { code: 'DE', flag: '🇩🇪', name: 'Germany' },
  { code: 'GR', flag: '🇬🇷', name: 'Greece' },
  { code: 'HU', flag: '🇭🇺', name: 'Hungary' },
  { code: 'IN', flag: '🇮🇳', name: 'India' },
  { code: 'ID', flag: '🇮🇩', name: 'Indonesia' },
  { code: 'IE', flag: '🇮🇪', name: 'Ireland' },
  { code: 'IL', flag: '🇮🇱', name: 'Israel' },
  { code: 'IT', flag: '🇮🇹', name: 'Italy' },
  { code: 'JP', flag: '🇯🇵', name: 'Japan' },
  { code: 'KE', flag: '🇰🇪', name: 'Kenya' },
  { code: 'MY', flag: '🇲🇾', name: 'Malaysia' },
  { code: 'MX', flag: '🇲🇽', name: 'Mexico' },
  { code: 'NL', flag: '🇳🇱', name: 'Netherlands' },
  { code: 'NZ', flag: '🇳🇿', name: 'New Zealand' },
  { code: 'NG', flag: '🇳🇬', name: 'Nigeria' },
  { code: 'NO', flag: '🇳🇴', name: 'Norway' },
  { code: 'PK', flag: '🇵🇰', name: 'Pakistan' },
  { code: 'PH', flag: '🇵🇭', name: 'Philippines' },
  { code: 'PL', flag: '🇵🇱', name: 'Poland' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal' },
  { code: 'RO', flag: '🇷🇴', name: 'Romania' },
  { code: 'SA', flag: '🇸🇦', name: 'Saudi Arabia' },
  { code: 'SG', flag: '🇸🇬', name: 'Singapore' },
  { code: 'ZA', flag: '🇿🇦', name: 'South Africa' },
  { code: 'KR', flag: '🇰🇷', name: 'South Korea' },
  { code: 'ES', flag: '🇪🇸', name: 'Spain' },
  { code: 'SE', flag: '🇸🇪', name: 'Sweden' },
  { code: 'CH', flag: '🇨🇭', name: 'Switzerland' },
  { code: 'TH', flag: '🇹🇭', name: 'Thailand' },
  { code: 'TR', flag: '🇹🇷', name: 'Turkey' },
  { code: 'AE', flag: '🇦🇪', name: 'United Arab Emirates' },
  { code: 'GB', flag: '🇬🇧', name: 'United Kingdom' },
  { code: 'US', flag: '🇺🇸', name: 'United States' },
  { code: 'VN', flag: '🇻🇳', name: 'Vietnam' }
];

function RankHoverCell({ count, kwList, title, color }) {
  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef(null);
  const list = kwList || [];

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 300);
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative', display: 'inline-block', cursor: count > 0 ? 'pointer' : 'default' }}
    >
      <span style={{
        color: color,
        borderBottom: isHovered && count > 0 ? `1.5px dashed ${color}` : '1.5px solid transparent',
        transition: 'all 0.15s'
      }}>
        {count}
      </span>

      {isHovered && list.length > 0 && (
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'absolute',
            bottom: '120%',
            right: 0,
            background: '#ffffff',
            color: '#0f172a',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12,
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            zIndex: 9999,
            whiteSpace: 'nowrap',
            maxHeight: 220,
            overflowY: 'auto',
            minWidth: 200,
            border: '1px solid #cbd5e1',
            textAlign: 'left',
            pointerEvents: 'auto'
          }}
        >
          <div style={{ fontWeight: 800, color: '#2563eb', marginBottom: 6, fontSize: 11.5, borderBottom: '1px solid #e2e8f0', paddingBottom: 4 }}>
            {title} ({list.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.map((k, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                <span style={{ color: '#1e293b', fontWeight: 600 }}>{k.kw}</span>
                <span style={{ color: '#16a34a', fontWeight: 700 }}>{k.rank}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PositionAnalysisPage({ onNavigate, user }) {
  const isReadOnly = isReadOnlyUser(user);
  const [associateAnalyzed, setAssociateAnalyzed] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [activeProject, setActiveProject] = useState(null);
  const userCanRunActions = (canRunActions(user) || canRunBrandDiscovery(user, activeProject?.slug)) && !associateAnalyzed;
  const [kwCount, setKwCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [blogCount, setBlogCount] = useState(0);
  const [clusterCount, setClusterCount] = useState(0);
  const [netPotential, setNetPotential] = useState(0);
  const [aiTab, setAiTab] = useState('Overview');
  const [pageAnalysisLlm, setPageAnalysisLlm] = useState('chatgpt');
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  const [topKeywords, setTopKeywords] = useState([]);
  const [multiResults, setMultiResults] = useState([]);
  const [tabResults, setTabResults] = useState({});
  const [analyzingTabs, setAnalyzingTabs] = useState({});
  const [projectKeywords, setProjectKeywords] = useState([]);
  const [projectPages, setProjectPages] = useState([]);
  const [unauthorizedModal, setUnauthorizedModal] = useState({ show: false, message: '' });
  const [showDateModal, setShowDateModal] = useState(false);
  const [isAnalyzingOverlay, setIsAnalyzingOverlay] = useState(false);

  // Hidden cards state
  const [closedCards, setClosedCards] = useState({});
  const [selectedRegion, setSelectedRegion] = useState('US');
  const [selectedDate, setSelectedDate] = useState(() => localStorage.getItem('bd_selected_date') || new Date().toISOString().split('T')[0]);
  const dateInputRef = useRef(null);
  const countryListRef = useRef(null);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [hoveredChartLine, setHoveredChartLine] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [highlightedCountryIndex, setHighlightedCountryIndex] = useState(0);
  const [hoveredKwIndex, setHoveredKwIndex] = useState(null);

  // Sync country from the domain's target location whenever project changes
  useEffect(() => {
    const loc = activeProject?.location;
    if (!loc || loc === 'Global') {
      setSelectedRegion('US');
      return;
    }
    const match = COUNTRY_OPTIONS.find(c => c.name.toLowerCase() === loc.toLowerCase());
    setSelectedRegion(match ? match.code : 'US');
  }, [activeProject?.location]);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        const domains = await fetchDomainRows();
        const isVendor = user?.category === 'Vendor' || user?.role?.toUpperCase() === 'VENDOR';
        const vendorProjectName = isVendor && user?.assigned_project && user.assigned_project !== 'All Projects' ? user.assigned_project : null;

        if (isMounted && domains && domains.length > 0) {
          let targetProject = null;

          if (vendorProjectName) {
            const matched = domains.find(p =>
              p.name?.toLowerCase() === vendorProjectName.toLowerCase() ||
              p.slug?.toLowerCase() === vendorProjectName.toLowerCase() ||
              p.domain?.toLowerCase() === vendorProjectName.toLowerCase()
            );

            if (matched) {
              setProjects([matched]);
              targetProject = matched;
            } else {
              setProjects([]);
              setUnauthorizedModal({
                show: true,
                message: `You are not authorized to view this project or no project setup data exists for your assigned project ("${vendorProjectName}").`
              });
              setLoading(false);
              return;
            }
          } else {
            setProjects(domains);
            const savedSlug = localStorage.getItem('bd_selected_project');
            targetProject = (savedSlug && domains.find(p => p.slug === savedSlug)) || domains[0];
          }

          setSelectedSlug(targetProject.slug);
          setActiveProject(targetProject);

          // Fast Parallel Fetch (Fix #1 & Fix #2)
          try {
            const [summary, kws, pgs] = await Promise.all([
              fetchProjectSummaryApi(targetProject.slug),
              fetchKeywordRows(targetProject.slug),
              fetchPageRows(targetProject.slug)
            ]);

            if (isMounted) {
              const hasData = (summary && summary.kw_count > 0) || (kws && kws.length > 0) || (pgs && pgs.length > 0);
              if (vendorProjectName && !hasData) {
                setUnauthorizedModal({
                  show: true,
                  message: `You are not authorized to view this project data or no keyword/rank data exists for your assigned project ("${vendorProjectName}").`
                });
              }

              if (summary && summary.kw_count > 0) {
                setKwCount(summary.kw_count);
                setNetPotential(summary.net_potential || 0);
                setClusterCount(summary.cluster_count || 0);
                setPageCount(summary.page_count || 0);
                setBlogCount(summary.blog_count || 0);
              }

              if (kws && kws.length > 0) {
                setProjectKeywords(kws);
                if (!summary || summary.kw_count === 0) {
                  setKwCount(kws.length);
                  setClusterCount(new Set(kws.map(k => k.cluster).filter(Boolean)).size);
                  const svSum = kws.reduce((acc, k) => acc + (Number(String(k.sv || 0).replace(/[^0-9.]/g, '')) || 0), 0);
                  setNetPotential(svSum);
                }
                setTopKeywords(extractTop2PerCategory(kws));
              }

              if (pgs && pgs.length > 0) {
                setProjectPages(pgs);
                if (!summary || summary.page_count === 0) {
                  setPageCount(pgs.length);
                }
              }
            }
          } catch (e) {
            console.warn('[PositionAnalysisPage] Parallel load notice:', e);
          }
        } else if (isMounted && (!domains || domains.length === 0)) {
          if (isVendor) {
            setUnauthorizedModal({
              show: true,
              message: `You are not authorized to view this project data or no setup data exists in the system.`
            });
          }
        }
      } catch (err) {
        console.error('Error loading projects:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, [user]);

  useEffect(() => {
    function handleClickOutside(event) {
      const isProjectButton = event.target.closest('.project-menu-btn');
      const isProjectMenu = event.target.closest('.project-menu-panel');
      if (!isProjectButton && !isProjectMenu) {
        setProjectMenuOpen(false);
      }

      const isCountryButton = event.target.closest('.country-menu-btn');
      const isCountryMenu = event.target.closest('.country-menu-panel');
      if (!isCountryButton && !isCountryMenu) {
        setCountryMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setHighlightedCountryIndex(0);
  }, [countrySearch, countryMenuOpen]);

  useEffect(() => {
    if (countryListRef.current) {
      const activeEl = countryListRef.current.children[highlightedCountryIndex];
      if (activeEl && activeEl.scrollIntoView) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedCountryIndex]);

  const handleSelectProject = async (slug) => {
    const isVendor = user?.category === 'Vendor' || user?.role?.toUpperCase() === 'VENDOR';
    const vendorProjectName = isVendor && user?.assigned_project && user.assigned_project !== 'All Projects' ? user.assigned_project : null;

    const p = projects.find(item => item.slug === slug);
    if (!p) return;

    if (vendorProjectName && p.name?.toLowerCase() !== vendorProjectName.toLowerCase() && p.slug?.toLowerCase() !== vendorProjectName.toLowerCase() && p.domain?.toLowerCase() !== vendorProjectName.toLowerCase()) {
      setUnauthorizedModal({
        show: true,
        message: `You are not authorized to view data for project "${p.name || slug}". Your vendor profile is restricted to "${vendorProjectName}".`
      });
      return;
    }

    setSelectedSlug(slug);
    localStorage.setItem('bd_selected_project', slug);
    if (p) {
      setActiveProject(p);
      try {
        const isBlogItem = (item) => {
          if (!item) return false;
          const val = String(
            item.targetType ||
            item.target_type ||
            item.pageType ||
            item.page_type ||
            item.type ||
            item.targetCategory ||
            item.landing_blog ||
            item['Target Type'] ||
            item['TargetType'] ||
            item['Landing / Blog'] ||
            item['landing / blog'] ||
            ''
          ).toLowerCase().trim();
          return val.includes('blog');
        };

        const kws = await fetchKeywordRows(p.slug);
        if (kws && kws.length > 0) {
          setProjectKeywords(kws);
          setKwCount(kws.length);
          const clusters = new Set(kws.map(k => k.cluster).filter(Boolean)).size;
          setClusterCount(clusters);

          const svSum = kws.reduce((acc, k) => {
            const val = Number(String(k.sv || 0).replace(/[^0-9.]/g, '')) || 0;
            return acc + val;
          }, 0);
          setNetPotential(svSum);

          setTopKeywords(extractTop2PerCategory(kws));
        } else {
          setKwCount(p.keywords || 0);
          setClusterCount(0);
          setNetPotential(0);
          setProjectKeywords([]);
          setTopKeywords([]);
        }

        const pgs = await fetchPageRows(p.slug);
        if (pgs && pgs.length > 0) {
          setProjectPages(pgs);
          setPageCount(pgs.length);
          const pgsBlogs = pgs.filter(p => isBlogItem(p)).length;
          if (pgsBlogs > 0) {
            setBlogCount(pgsBlogs);
          } else if (kws && kws.length > 0) {
            const kwsBlogs = new Set(kws.filter(k => isBlogItem(k)).map(k => k.landingPage || k.url || k.kw).filter(Boolean)).size;
            setBlogCount(kwsBlogs || (p.blogPages || 0));
          } else {
            setBlogCount(p.blogPages || 0);
          }
        } else if (kws && kws.length > 0) {
          const uniquePages = new Set(kws.map(k => k.landingPage).filter(Boolean)).size;
          setPageCount(uniquePages || kws.length);
          const kwsBlogs = new Set(kws.filter(k => isBlogItem(k)).map(k => k.landingPage || k.url || k.kw).filter(Boolean)).size;
          setBlogCount(kwsBlogs || (p.blogPages || 0));
          setProjectPages([]);
        } else {
          setPageCount(p.targetPages || 0);
          setBlogCount(p.blogPages || 0);
          setProjectPages([]);
        }
      } catch (e) {
        // fallbacks
      }
    }
  };

  const toggleClose = (cardId) => {
    setClosedCards(prev => ({ ...prev, [cardId]: true }));
  };

  // Load cached AI analysis results & live domain metrics from localStorage whenever project changes
  useEffect(() => {
    if (!activeProject?.slug) return;
    // Restore cached live DA & Spam Score if present, or fetch live metrics
    const metricCacheKey = `bd_domain_metrics_${activeProject.slug}`;
    let loadedCache = false;
    try {
      const cachedMetrics = localStorage.getItem(metricCacheKey);
      if (cachedMetrics) {
        const parsed = JSON.parse(cachedMetrics);
        if ((parsed?.da || parsed?.spam_score || parsed?.ss) && parsed?.spam_score !== '0%') {
          loadedCache = true;
          setActiveProject(prev => prev ? {
            ...prev,
            da: parsed.da ?? prev.da,
            spam_score: parsed.spam_score || parsed.ss || prev.spam_score || '0%',
            total_traffic: parsed.total_traffic || prev.total_traffic || '0'
          } : prev);
        }
      }
    } catch (e) { }

    if (!loadedCache && activeProject?.domain) {
      fetchDomainMetricsApi(activeProject.domain).then(res => {
        const m = res?.metrics || res;
        if (res?.status === 'success' || m?.da || m?.ss) {
          const liveDa = m.da ?? 0;
          const liveSs = m.ss || m.spam_score || '0%';
          const metricsToSave = {
            da: liveDa,
            spam_score: liveSs,
            ss: liveSs
          };
          try {
            localStorage.setItem(metricCacheKey, JSON.stringify(metricsToSave));
          } catch (err) { }
          setActiveProject(prev => prev ? {
            ...prev,
            da: liveDa,
            spam_score: liveSs,
            ss: liveSs
          } : prev);
        }
      }).catch(err => console.warn('[PositionAnalysisPage] Failed to fetch domain metrics:', err));
    }

    const tabs = ['overview', 'chatgpt', 'gemini', 'ai overview'];
    const newResults = {};

    // 1. Try local cache first for instant UI response
    tabs.forEach(tabKey => {
      const cacheKey = `ai_results_${activeProject.slug}_${tabKey}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            newResults[tabKey] = parsed;
          }
        }
      } catch (err) { }
    });
    if (Object.keys(newResults).length > 0) {
      setTabResults(prev => ({ ...prev, ...newResults }));
    }

    // 2. Fetch latest AI Analysis runs directly from Supabase DB for cross-system syncing
    fetchAiAnalysisHistory(activeProject.slug)
      .then(history => {
        if (history && history.length > 0) {
          const dbTabResults = {};
          const engines = ['chatgpt', 'gemini', 'ai overview'];

          engines.forEach(eng => {
            const match = history.find(h => (h.engine || '').toLowerCase().trim() === eng || (h.engine || '').toLowerCase().includes(eng));
            if (match) {
              const resObj = {
                ai_visibility: match.ai_visibility || 0,
                mentions: match.mentions || 0,
                cited_pages: match.cited_pages || 0,
                mentioned_keywords: match.mentioned_keywords || [],
                cited_pages_list: match.cited_pages_list || [],
                total_keywords: match.total_keywords || 0
              };
              dbTabResults[eng] = [resObj];
              // Update local cache so next tab switch is instant
              try {
                localStorage.setItem(`ai_results_${activeProject.slug}_${eng}`, JSON.stringify([resObj]));
              } catch (e) { }
            }
          });

          // Overview aggregation from DB
          const validDb = engines.map(eng => dbTabResults[eng] ? dbTabResults[eng][0] : null).filter(Boolean);
          if (validDb.length > 0) {
            const totalMentions = validDb.reduce((sum, r) => sum + (r.mentions || 0), 0);
            const totalCited = validDb.reduce((sum, r) => sum + (r.cited_pages || 0), 0);
            dbTabResults['overview'] = [{
              ...validDb[0],
              mentions: totalMentions,
              cited_pages: totalCited
            }];
          }

          setTabResults(prev => ({ ...dbTabResults, ...prev }));

          // Reconstruct multi-period trend history (P1..P15) across all devices from Supabase history
          try {
            engines.forEach(eng => {
              const engHistory = history
                .filter(h => (h.engine || '').toLowerCase().trim() === eng || (h.engine || '').toLowerCase().includes(eng))
                .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

              if (engHistory.length > 0) {
                const reconstructedHits = engHistory.slice(0, 15).map((run, idx) => {
                  const cCounts = {};
                  const cited = run.cited_pages_list || [];
                  cited.forEach(item => {
                    const pageUrl = typeof item === 'string' ? item : (item.url || item.cited_url || item.page || '');
                    if (!pageUrl) return;
                    const normUrl = pageUrl.trim().toLowerCase();
                    const matchedKw = (projectKeywords || []).find(k => {
                      const kUrl = (k.landingPage || k.url || k.page_url || '').trim().toLowerCase();
                      return kUrl && (kUrl === normUrl || kUrl.includes(normUrl) || normUrl.includes(kUrl));
                    });
                    const cName = matchedKw?.cluster || matchedKw?.type || '-';
                    cCounts[cName] = (cCounts[cName] || 0) + 1;
                  });
                  return {
                    dateStr: `Hit ${idx + 1}`,
                    clusterCounts: cCounts
                  };
                });
                localStorage.setItem(`ai_period_hits_${activeProject.slug}_${eng}`, JSON.stringify(reconstructedHits));
              }
            });
          } catch (histErr) {
            console.warn('[PositionAnalysisPage] Failed to reconstruct period history from DB:', histErr);
          }
        }
      })
      .catch(err => console.warn('[PositionAnalysisPage] Supabase history sync notice:', err));

  }, [activeProject?.slug]);

  const saveHitToPeriodHistory = (projectSlug, engineKey, visibilityResult, optionalKws = null) => {
    if (!projectSlug || !engineKey) return;
    const normEngine = engineKey.toLowerCase().trim();
    const storageKey = `ai_period_hits_${projectSlug}_${normEngine}`;
    let hits = [];
    try {
      hits = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch (e) { }

    const kwsSource = optionalKws || projectKeywords || [];
    let clusterCounts = {};

    if (normEngine === 'organic') {
      const uniquePagesByCluster = {};
      kwsSource.forEach(k => {
        const pUrl = (k.landingPage || k.url || k.page_url || k.landing_page_url || '').trim().toLowerCase();
        if (pUrl) {
          const cName = k.cluster || k.type || '-';
          if (!uniquePagesByCluster[cName]) {
            uniquePagesByCluster[cName] = new Set();
          }
          uniquePagesByCluster[cName].add(pUrl);
        }
      });
      Object.keys(uniquePagesByCluster).forEach(cName => {
        clusterCounts[cName] = uniquePagesByCluster[cName].size;
      });

      if (Object.keys(clusterCounts).length === 0) {
        const uniqueUrls = new Set();
        (projectPages || []).forEach(p => {
          const pUrl = (p.url || p.page_url || '').trim().toLowerCase();
          const cName = p.cluster || p.type || '-';
          if (pUrl && !uniqueUrls.has(pUrl)) {
            uniqueUrls.add(pUrl);
            clusterCounts[cName] = (clusterCounts[cName] || 0) + 1;
          }
        });
      }
    } else {
      const citedPages = visibilityResult?.cited_pages_list || [];
      citedPages.forEach((item) => {
        const pageUrl = typeof item === 'string' ? item : (item.url || item.cited_url || item.page || '');
        if (!pageUrl) return;

        const normUrl = pageUrl.trim().toLowerCase();
        const matchedKw = kwsSource.find(k => {
          const kUrl = (k.landingPage || k.url || k.page_url || '').trim().toLowerCase();
          return kUrl && (kUrl === normUrl || kUrl.includes(normUrl) || normUrl.includes(kUrl));
        });

        const clusterName = matchedKw?.cluster || matchedKw?.type || '-';
        clusterCounts[clusterName] = (clusterCounts[clusterName] || 0) + 1;
      });

      if (Object.keys(clusterCounts).length === 0) {
        kwsSource.forEach(k => {
          const cName = k.cluster || k.type || '-';
          clusterCounts[cName] = (clusterCounts[cName] || 0) + 1;
        });
      }
    }

    const hitObj = {
      timestamp: new Date().toISOString(),
      dateStr: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      result: visibilityResult,
      clusterCounts
    };

    hits.push(hitObj);

    // FIFO Sliding Window: Max 15 periods (P1 to P15)
    if (hits.length > 15) {
      hits = hits.slice(-15);
    }

    localStorage.setItem(storageKey, JSON.stringify(hits));
    return hits;
  };

  const handleAiAnalysis = async (e, options = {}) => {
    if (e) e.preventDefault();
    const analyzeAll = true;
    const targetEngine = null;

    if (!activeProject?.slug) return;
    const domain = activeProject.domain || activeProject.name || '';
    const kwSource = (topKeywords && topKeywords.length > 0) ? topKeywords : projectKeywords;
    const kwList = kwSource.map(k => (typeof k === 'string' ? k : (k.kw || k.keyword || k.name))).filter(Boolean);
    const countryName = activeProject.location || 'India';

    setIsAnalyzingOverlay(true);

    try {
      // 1. Organic Rank Check Task
      const organicTaskPromise = (async () => {
        const targetRegion = selectedRegion || activeProject.location || 'India';
        try {
          await runOrganicRankCheckApi(activeProject.slug, targetRegion);
          const updatedKws = await fetchKeywordRows(activeProject.slug);
          if (updatedKws && updatedKws.length > 0) {
            setProjectKeywords(updatedKws);
            saveHitToPeriodHistory(activeProject.slug, 'organic', { total_keywords: updatedKws.length }, updatedKws);
          }
        } catch (err) {
          console.warn('[PositionAnalysisPage] Organic rank check warning:', err);
        }
      })();

      // 2. AI Visibility Analysis Task
      const aiTaskPromise = (async () => {
        if (analyzeAll) {
          setAnalyzingTabs({
            chatgpt: true,
            gemini: true,
            'ai overview': true,
            overview: true
          });
          setAnalysisError('');

          try {
            const engines = [
              { key: 'chatgpt', engine: 'chatgpt' },
              { key: 'gemini', engine: 'gemini' },
              { key: 'ai overview', engine: 'ai overview' }
            ];

            const allResults = await Promise.all(
              engines.map(async ({ key, engine }) => {
                try {
                  const data = await runAiVisibilityAnalysis(activeProject.slug, domain, countryName, kwList, engine);
                  const visibilityResult = data?.result || {
                    ai_visibility: 0,
                    mentions: 0,
                    cited_pages: 0,
                    mentioned_keywords: [],
                    cited_pages_list: [],
                    total_keywords: kwList.length
                  };
                  return { key, result: [visibilityResult] };
                } catch (err) {
                  return {
                    key,
                    result: [{
                      ai_visibility: 0,
                      mentions: 0,
                      cited_pages: 0,
                      mentioned_keywords: [],
                      cited_pages_list: [],
                      total_keywords: kwList.length
                    }]
                  };
                }
              })
            );

            const newTabResults = {};
            allResults.forEach(({ key, result }) => {
              newTabResults[key] = result;
              localStorage.setItem(`ai_results_${activeProject.slug}_${key}`, JSON.stringify(result));
              if (result && result[0]) {
                saveHitToPeriodHistory(activeProject.slug, key, result[0]);
              }
            });

            // Overview aggregation
            const valid = allResults.map(r => r.result[0]).filter(Boolean);
            if (valid.length > 0) {
              const avgVis = Math.round(valid.reduce((sum, r) => sum + (r.ai_visibility || 0), 0) / valid.length);
              const totalMentions = valid.reduce((sum, r) => sum + (r.mentions || 0), 0);
              const totalCited = valid.reduce((sum, r) => sum + (r.cited_pages || 0), 0);

              const overviewRes = [{
                ...valid[0],
                ai_visibility: avgVis,
                mentions: totalMentions,
                cited_pages: totalCited
              }];
              newTabResults['overview'] = overviewRes;
              localStorage.setItem(`ai_results_${activeProject.slug}_overview`, JSON.stringify(overviewRes));
            }

            setTabResults(prev => ({ ...prev, ...newTabResults }));

            if (isAssociateUser(user)) {
              recordAiModelAnalysisRun(user, activeProject?.slug, 'all');
              setAssociateAnalyzed(true);
            }
          } catch (err) {
            setAnalysisError(err.message);
          } finally {
            setAnalyzingTabs({
              chatgpt: false,
              gemini: false,
              'ai overview': false,
              overview: false
            });
          }
        } else {
          // CARD / INSIDE MODEL BUTTON: Analyze ONLY for that specific model/tab
          const currentTab = (targetEngine || aiTab).toLowerCase();
          if (currentTab === 'overview') {
            return handleAiAnalysis(e, { analyzeAll: true });
          }

          if (currentTab === 'organic') {
            // ORGANIC ONLY: Hit organic rank check without AI LLMs
            const targetRegion = selectedRegion || activeProject.location || 'India';
            await runOrganicRankCheckApi(activeProject.slug, targetRegion);
            const updatedKws = await fetchKeywordRows(activeProject.slug);
            if (updatedKws && updatedKws.length > 0) {
              setProjectKeywords(updatedKws);
              saveHitToPeriodHistory(activeProject.slug, 'organic', { total_keywords: updatedKws.length }, updatedKws);
            }
            return;
          }

          const engineKey = currentTab.includes('gemini') ? 'gemini' : currentTab.includes('overview') ? 'ai overview' : 'chatgpt';

          setAnalyzingTabs(prev => ({ ...prev, [engineKey]: true, [currentTab]: true }));
          setAnalysisError('');

          try {
            const data = await runAiVisibilityAnalysis(activeProject.slug, domain, countryName, kwList, engineKey);
            const visibilityResult = data?.result || {
              ai_visibility: 0,
              mentions: 0,
              cited_pages: 0,
              mentioned_keywords: [],
              cited_pages_list: [],
              total_keywords: kwList.length
            };

            const results = [visibilityResult];
            setTabResults(prev => ({ ...prev, [engineKey]: results, [currentTab]: results }));
            localStorage.setItem(`ai_results_${activeProject.slug}_${engineKey}`, JSON.stringify(results));
            localStorage.setItem(`ai_results_${activeProject.slug}_${currentTab}`, JSON.stringify(results));
            saveHitToPeriodHistory(activeProject.slug, engineKey, visibilityResult);

            if (isAssociateUser(user)) {
              recordAiModelAnalysisRun(user, activeProject?.slug, engineKey);
              setAssociateAnalyzed(true);
            }
          } catch (err) {
            setAnalysisError(err.message);
          } finally {
            setAnalyzingTabs(prev => ({ ...prev, [engineKey]: false, [currentTab]: false }));
          }
        }
      })();

      await Promise.allSettled([organicTaskPromise, aiTaskPromise]);
    } finally {
      setIsAnalyzingOverlay(false);
    }
  };

  const domainDisplay = activeProject?.domain || activeProject?.name || (projects && projects[0] ? projects[0].domain || projects[0].name : '');
  const locationDisplay = activeProject?.location || 'India (Google)';

  const getDynamicClusters = () => {
    if (!projectKeywords || projectKeywords.length === 0) {
      return [];
    }

    const counts = {};
    let total = 0;
    projectKeywords.forEach(k => {
      const clusterName = k.cluster || k.type || '';
      if (clusterName) {
        counts[clusterName] = (counts[clusterName] || 0) + 1;
        total += 1;
      }
    });

    if (total === 0) {
      return [{ name: 'N/A', share: '0' }];
    }

    return Object.entries(counts)
      .map(([name, count]) => ({
        name,
        share: String(count),
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const getDynamicCategories = () => {
    if (!projectKeywords || projectKeywords.length === 0) {
      return [];
    }

    const counts = {};
    let hasCategories = false;
    projectKeywords.forEach(k => {
      const catName = k.category || '';
      if (catName) {
        counts[catName] = (counts[catName] || 0) + 1;
        hasCategories = true;
      }
    });

    if (!hasCategories) {
      return [{ name: 'N/A', count: '0' }];
    }

    return Object.entries(counts)
      .map(([name, count]) => ({
        name,
        count: String(count),
        rawCount: count
      }))
      .sort((a, b) => b.rawCount - a.rawCount)
      .slice(0, 5);
  };

  const getDynamicPageAnalysisData = (targetLlm = pageAnalysisLlm) => {
    if (!projectKeywords || projectKeywords.length === 0) {
      return [];
    }

    const isOrganic = String(targetLlm).toLowerCase() === 'organic';

    if (isOrganic) {
      // ORGANIC TAB: Process all dynamic project keywords, extract unique links, filter rank <= 5
      const pageMap = {};

      (projectKeywords || []).forEach(k => {
        const pageUrl = String(k.landingPage || k.url || k.page_url || k.landing_page || '').trim();
        if (!pageUrl) return;

        const cluster = String(k.cluster || k.type || '-').trim();
        const category = String(k.category || k.targetSubtype || k.subtype || '-').trim();
        const kwText = k.kw || k.keyword || '';

        const rawRank = k.rank ?? k.position ?? k.rankVal ?? k.rank_meta?.rank ?? k.intentRank;
        const rankVal = rawRank != null && !isNaN(Number(rawRank)) ? Number(rawRank) : null;
        const isTop5 = rankVal !== null && rankVal > 0 && rankVal <= 5;

        if (!pageMap[pageUrl]) {
          const rawName = pageUrl.split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || kwText || 'PAGE';
          pageMap[pageUrl] = {
            url: pageUrl,
            pageName: rawName.toUpperCase(),
            categoryName: category,
            clusterName: cluster,
            rank: rankVal,
            isTop5: isTop5
          };
        } else {
          if (rankVal !== null && (pageMap[pageUrl].rank === null || rankVal < pageMap[pageUrl].rank)) {
            pageMap[pageUrl].rank = rankVal;
            pageMap[pageUrl].isTop5 = isTop5;
          }
        }
      });

      // Include projectPages
      (projectPages || []).forEach(p => {
        const pageUrl = String(p.url || '').trim();
        if (!pageUrl || pageMap[pageUrl]) return;
        const cluster = String(p.cluster || p.targetCluster || '-').trim();
        const category = String(p.category || p.targetCategory || '-').trim();
        const rawName = p.pageName || p.name || pageUrl.split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || 'PAGE';

        pageMap[pageUrl] = {
          url: pageUrl,
          pageName: rawName.toUpperCase(),
          categoryName: category,
          clusterName: cluster,
          rank: null,
          isTop5: false
        };
      });

      let allPages = Object.values(pageMap);
      let top5Pages = allPages.filter(p => p.isTop5);
      if (top5Pages.length === 0) {
        top5Pages = allPages.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      }

      return top5Pages;
    }

    // AI LLM TABS (ChatGPT, Gemini, AI Overview)
    const llmKey = targetLlm === 'ai overview' ? 'ai overview' : targetLlm === 'gemini' ? 'gemini' : 'chatgpt';
    let llmResults = tabResults[llmKey] || tabResults[targetLlm] || [];
    let activeRes = llmResults[0] || {};

    if ((!activeRes.cited_pages_list || activeRes.cited_pages_list.length === 0) && (!activeRes.mentioned_keywords || activeRes.mentioned_keywords.length === 0) && activeProject?.slug) {
      try {
        const stored = localStorage.getItem(`ai_results_${activeProject.slug}_${llmKey}`) ||
                       localStorage.getItem(`ai_results_${activeProject.slug}_${llmKey.replace(/\s+/g, '')}`) ||
                       localStorage.getItem(`ai_results_${activeProject.slug}_${llmKey.replace(/\s+/g, '_')}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          activeRes = Array.isArray(parsed) ? parsed[0] : parsed;
        }
      } catch (e) {}
    }
    
    const citedPagesList = activeRes.cited_pages_list || [];
    const mentionsList = activeRes.mentioned_keywords || [];
    const itemsToProcess = citedPagesList.length > 0 ? citedPagesList : mentionsList;

    if (!itemsToProcess || itemsToProcess.length === 0) {
      // Fallback to Project Setup keywords if no AI run data is present yet
      return (projectKeywords || []).map(k => {
        const finalUrl = k.landingPage || k.landing_page_url || k.page_url || k.url || 'https://euroschoolindia.com';
        const pageName = finalUrl.split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || (k.kw || k.keyword || 'PAGE');
        return {
          url: finalUrl,
          pageName: pageName.toUpperCase(),
          categoryName: k.category || k.targetSubtype || k.subtype || 'General',
          clusterName: k.cluster || k.type || 'General',
          keyword: k.kw || k.keyword || ''
        };
      });
    }

    return itemsToProcess.map(citationStr => {
      let kw = String(citationStr || '').trim();
      let urlStr = kw;
      if (kw.includes(' - ')) {
        const parts = kw.split(' - ');
        kw = parts[0].trim();
        urlStr = parts.slice(1).join(' - ').trim();
      }

      const cleanKwVal = kw.toLowerCase().trim();

      let kwMatch = projectKeywords.find(k => String(k.kw || k.keyword || '').toLowerCase().trim() === cleanKwVal);
      if (!kwMatch) {
        kwMatch = projectKeywords.find(k => {
          const kText = String(k.kw || k.keyword || '').toLowerCase().trim();
          return kText && (kText.includes(cleanKwVal) || cleanKwVal.includes(kText));
        });
      }

      const clusterName = kwMatch?.cluster || kwMatch?.type || 'General';
      const categoryName = kwMatch?.category || kwMatch?.targetSubtype || kwMatch?.subtype || 'General';
      const finalUrl = kwMatch?.landingPage || kwMatch?.landing_page_url || kwMatch?.page_url || kwMatch?.url || urlStr;
      const pageName = finalUrl.split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || kw;

      return {
        url: finalUrl,
        pageName: pageName.toUpperCase(),
        categoryName: categoryName,
        clusterName: clusterName,
        keyword: kw
      };
    });
  };

  const computeLiveMetrics = () => {
    const defaultMentions = [
      { name: 'IB Diploma Program', count: 42 },
      { name: 'Primary Admissions', count: 28 },
      { name: 'STEM Robotics Lab', count: 19 },
      { name: 'Bilingual Curriculum', count: 15 },
      { name: 'Early Childhood Edu', count: 11 }
    ];

    const defaultCited = [
      { source: `${domainDisplay}/ib-diploma`, count: 18 },
      { source: `${domainDisplay}/primary`, count: 12 },
      { source: `${domainDisplay}/stem-lab`, count: 9 },
      { source: `${domainDisplay}/bilingual`, count: 7 },
      { source: `${domainDisplay}/admissions`, count: 4 }
    ];

    if (!multiResults || multiResults.length === 0) {
      return { mentions: defaultMentions, cited: defaultCited };
    }

    const domainLower = domainDisplay.toLowerCase();

    // 1. Compute Cited pages from multiResults
    const citedCounts = {};
    multiResults.forEach(res => {
      if (res.results && Array.isArray(res.results)) {
        res.results.forEach(urlItem => {
          const urlStr = urlItem.url || '';
          if (urlStr.toLowerCase().includes(domainLower)) {
            let cleanUrl = urlStr
              .replace(/^(https?:\/\/)?(www\.)?/, '')
              .replace(/\/$/, '')
              .toLowerCase();
            citedCounts[cleanUrl] = (citedCounts[cleanUrl] || 0) + 1;
          }
        });
      }
    });

    let cited = Object.entries(citedCounts).map(([source, count]) => ({
      source,
      count
    })).sort((a, b) => b.count - a.count);

    if (cited.length === 0) {
      cited = [
        { source: 'No citations found', count: 0 }
      ];
    }

    // 2. Compute Mentions by Cluster from multiResults
    const clusterMentions = {};
    multiResults.forEach(res => {
      const kwName = res.keyword || '';
      const kwObj = projectKeywords.find(k => k.kw?.toLowerCase() === kwName.toLowerCase());
      const cluster = kwObj?.cluster || '-';

      const ranksInResults = res.results && res.results.some(urlItem => (urlItem.url || '').toLowerCase().includes(domainLower));
      const mentionedInText = res.ai_answer && (
        res.ai_answer.toLowerCase().includes(domainLower) ||
        res.ai_answer.toLowerCase().includes((activeProject?.name || '').toLowerCase())
      );

      if (ranksInResults || mentionedInText) {
        clusterMentions[cluster] = (clusterMentions[cluster] || 0) + 1;
      }
    });

    let mentions = Object.entries(clusterMentions).map(([name, count]) => ({
      name,
      count
    })).sort((a, b) => b.count - a.count);

    if (mentions.length === 0) {
      mentions = [
        { name: 'No mentions found', count: 0 }
      ];
    }

    return { mentions, cited };
  };

  const { mentions, cited } = computeLiveMetrics();

  const getRegionBadgeInfo = (project, dateVal) => {
    let rawLoc = project?.target_regions || project?.location || project?.country || 'US';
    if (Array.isArray(rawLoc)) {
      rawLoc = rawLoc.join(', ');
    } else if (typeof rawLoc !== 'string') {
      rawLoc = String(rawLoc || 'US');
    }
    const loc = rawLoc.toLowerCase();

    let flag = '🇺🇸';
    let code = 'US';
    if (loc.includes('in') || loc.includes('india')) {
      flag = '🇮🇳';
      code = 'IN';
    } else if (loc.includes('sg') || loc.includes('singapore')) {
      flag = '🇸🇬';
      code = 'SG';
    } else if (loc.includes('uk') || loc.includes('gb') || loc.includes('united kingdom')) {
      flag = '🇬🇧';
      code = 'UK';
    } else if (loc.includes('ca') || loc.includes('canada')) {
      flag = '🇨🇦';
      code = 'CA';
    } else if (loc.includes('au') || loc.includes('australia')) {
      flag = '🇦🇺';
      code = 'AU';
    }

    let dateStr = '';
    try {
      if (dateVal && typeof dateVal === 'string' && dateVal.includes('-')) {
        const [y, m, d] = dateVal.split('-').map(Number);
        dateStr = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } else {
        dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
    } catch (e) {
      dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    return { flag, code, dateStr };
  };

  const badgeInfo = getRegionBadgeInfo(activeProject, selectedDate);

  if (loading || !activeProject) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
      }}>
        <style>{`
          @keyframes bd-spin { to { transform: rotate(360deg); } }
          @keyframes bd-sweep {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(300%); }
          }
        `}</style>

        {/* Thin spinner ring */}
        <div style={{
          width: 36, height: 36,
          borderRadius: '50%',
          border: '2.5px solid #E9E4F5',
          borderTopColor: '#7B2FBE',
          animation: 'bd-spin 0.8s linear infinite',
        }} />

        {/* Label */}
        <span style={{ fontSize: 13, color: '#94A3B8', fontWeight: 500, letterSpacing: '0.01em' }}>
          Loading Brand Discovery…
        </span>

        {/* Slim shimmer bar */}
        <div style={{ width: 180, height: 2, background: '#EDE9F7', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: '50%',
            background: 'linear-gradient(90deg, transparent, #7B2FBE, transparent)',
            animation: 'bd-sweep 1.4s ease-in-out infinite',
          }} />
        </div>
      </div>
    );
  }


  return (
    <div style={{
      position: 'relative',
      padding: '24px 32px',
      background: 'var(--bg, #f8fafc)',
      minHeight: '100vh',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
      color: '#1e293b'
    }}>
      <style>{`
        @keyframes bd-fade-up {
          0%   { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {/* ─── HEADER BAR ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
        gap: 20,
        marginBottom: 24,
        alignItems: 'center'
      }}>
        {/* Left Column (directly above First Box / AI SEARCH Card): Title on left, Region pill aligned with end of first box */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 16
        }}>
          <h1 style={{
            fontFamily: 'var(--font-display, inherit)',
            fontSize: 22,
            fontWeight: 800,
            color: '#0f172a',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            Project:
            {projects.length > 1 ? (
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
                  className="project-menu-btn"
                  onClick={() => setProjectMenuOpen(!projectMenuOpen)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 20,
                    fontWeight: 800,
                    color: '#7c3aed',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: 0,
                    margin: 0
                  }}
                >
                  <span>{domainDisplay}</span>
                  <ChevronDown size={18} style={{ color: '#7c3aed', transform: projectMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>

                {projectMenuOpen && (
                  <div
                    className="project-menu-panel"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 6,
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      zIndex: 1000,
                      minWidth: 200,
                      padding: '4px 0',
                      display: 'flex',
                      flexDirection: 'column'
                    }}>
                    {projects.map(p => (
                      <button
                        key={p.slug}
                        onClick={() => {
                          handleSelectProject(p.slug);
                          setProjectMenuOpen(false);
                        }}
                        style={{
                          padding: '8px 14px',
                          fontSize: 13.5,
                          fontWeight: p.slug === selectedSlug ? 700 : 500,
                          color: p.slug === selectedSlug ? '#7c3aed' : '#1e293b',
                          backgroundColor: p.slug === selectedSlug ? '#f5f3ff' : 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'background 0.12s'
                        }}
                        onMouseEnter={e => {
                          if (p.slug !== selectedSlug) e.currentTarget.style.backgroundColor = '#f8fafc';
                        }}
                        onMouseLeave={e => {
                          if (p.slug !== selectedSlug) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        {p.domain || p.name}
                        {p.slug === selectedSlug && <CheckCircle size={14} style={{ color: '#7c3aed' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span style={{ color: '#7c3aed' }}>{domainDisplay}</span>
            )}
            <a
              href={`https://${domainDisplay}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#7c3aed', display: 'inline-flex', alignItems: 'center', marginLeft: 4 }}
            >
              <ExternalLink size={16} />
            </a>
          </h1>

          {/* Country dropdown (defaults to domain target location, user can override) & date picker */}
          {!closedCards.aiSearch && (() => {
            const activeCountry = COUNTRY_OPTIONS.find(c => c.code === selectedRegion) || COUNTRY_OPTIONS.find(c => c.code === 'US') || COUNTRY_OPTIONS[0];
            const filteredCountries = COUNTRY_OPTIONS.filter(c =>
              c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
              c.code.toLowerCase().includes(countrySearch.toLowerCase())
            );

            return (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#64748b',
                fontWeight: 500
              }}>
                {/* Searchable Country Custom Dropdown */}
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <button
                    className="country-menu-btn"
                    onClick={() => {
                      setCountryMenuOpen(!countryMenuOpen);
                      setCountrySearch('');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#2563eb',
                      cursor: 'pointer',
                      outline: 'none',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <img
                      src={`https://flagcdn.com/16x12/${activeCountry.code.toLowerCase()}.png`}
                      width="16"
                      height="12"
                      alt={activeCountry.name}
                      style={{ borderRadius: 1.5, objectFit: 'cover' }}
                    />
                    <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{activeCountry.name}</span>
                    <ChevronDown size={14} style={{ color: '#2563eb', transform: countryMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>

                  {countryMenuOpen && (
                    <div
                      className="country-menu-panel"
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        marginTop: 6,
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 10,
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
                        zIndex: 1000,
                        width: 220,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                      }}>
                      {/* Search Input Box */}
                      <div style={{ padding: '8px 8px 6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: '#ffffff',
                          border: '1.5px solid #818cf8',
                          borderRadius: 8,
                          padding: '4px 8px',
                          boxShadow: '0 0 0 2px rgba(129, 140, 248, 0.2)'
                        }}>
                          <Search size={14} style={{ color: '#64748b' }} />
                          <input
                            type="text"
                            placeholder="Search"
                            value={countrySearch}
                            onChange={e => setCountrySearch(e.target.value)}
                            onKeyDown={e => {
                              if (filteredCountries.length === 0) return;
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setHighlightedCountryIndex(prev => (prev + 1) % filteredCountries.length);
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlightedCountryIndex(prev => (prev - 1 + filteredCountries.length) % filteredCountries.length);
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                const target = filteredCountries[highlightedCountryIndex] || filteredCountries[0];
                                if (target) {
                                  setSelectedRegion(target.code);
                                  setCountryMenuOpen(false);
                                }
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setCountryMenuOpen(false);
                              }
                            }}
                            autoFocus
                            style={{
                              border: 'none',
                              outline: 'none',
                              background: 'transparent',
                              fontSize: 12.5,
                              fontWeight: 500,
                              color: '#0f172a',
                              width: '100%'
                            }}
                          />
                        </div>
                      </div>

                      {/* Scrollable Countries List */}
                      <div ref={countryListRef} style={{ overflowY: 'auto', maxHeight: 210, padding: '4px 0' }}>
                        {filteredCountries.length > 0 ? (
                          filteredCountries.map((c, idx) => {
                            const isHighlighted = idx === highlightedCountryIndex;
                            const isSelected = c.code === selectedRegion;
                            return (
                              <button
                                key={c.code}
                                onClick={() => {
                                  setSelectedRegion(c.code);
                                  setCountryMenuOpen(false);
                                }}
                                onMouseEnter={() => setHighlightedCountryIndex(idx)}
                                style={{
                                  width: '100%',
                                  padding: '7px 12px',
                                  fontSize: 13,
                                  fontWeight: isSelected ? 700 : 500,
                                  color: '#0f172a',
                                  backgroundColor: isHighlighted ? '#e0f2fe' : (isSelected ? '#eff6ff' : 'transparent'),
                                  border: 'none',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  transition: 'background 0.12s'
                                }}
                              >
                                <img
                                  src={`https://flagcdn.com/16x12/${c.code.toLowerCase()}.png`}
                                  width="16"
                                  height="12"
                                  alt={c.name}
                                  style={{ borderRadius: 1.5, objectFit: 'cover' }}
                                />
                                <span>{c.name}</span>
                              </button>
                            );
                          })
                        ) : (
                          <div style={{ padding: '12px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                            No countries found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Custom Calendar Date Selector Button beside Country */}
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      const hiddenInput = document.getElementById('bd_header_date_picker');
                      if (hiddenInput) hiddenInput.showPicker ? hiddenInput.showPicker() : hiddenInput.click();
                    }}
                    title="Select Date"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#2563eb',
                      cursor: 'pointer',
                      outline: 'none',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <span style={{ fontSize: 14 }}>📅</span>
                    <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                      {(() => {
                        try {
                          const parts = selectedDate.split('-');
                          const dObj = new Date(parts[0], parts[1] - 1, parts[2]);
                          return dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        } catch (e) {
                          return selectedDate;
                        }
                      })()}
                    </span>
                  </button>
                  <input
                    id="bd_header_date_picker"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedDate(e.target.value);
                        localStorage.setItem('bd_selected_date', e.target.value);
                      }
                    }}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                  />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right Column: Actions */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10
        }}>
          {userCanRunActions && canRunAiModelAnalysis(user, activeProject?.slug, 'all', Object.values(tabResults).some(r => r && r.length > 0)) && (
            <button
              onClick={(e) => handleAiAnalysis(e, { analyzeAll: true })}
              disabled={Object.values(analyzingTabs).some(Boolean)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '9px 16px',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: Object.values(analyzingTabs).some(Boolean) ? 'not-allowed' : 'pointer',
                opacity: Object.values(analyzingTabs).some(Boolean) ? 0.7 : 1,
                boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35), 0 2px 6px rgba(212, 0, 122, 0.2)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { if (!Object.values(analyzingTabs).some(Boolean)) { e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
              onMouseLeave={e => { if (!Object.values(analyzingTabs).some(Boolean)) { e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'; e.currentTarget.style.transform = 'translateY(0)'; } }}
            >
              <Sparkles size={14} className={Object.values(analyzingTabs).some(Boolean) ? 'animate-spin' : ''} />
              <span>
                {Object.values(analyzingTabs).some(Boolean)
                  ? 'Analyzing...'
                  : (Object.values(tabResults).some(r => r && r.length > 0) ? 'Re-analyze' : 'Analyze')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ─── QUICK METRICS (Equally Distributed End-to-End) ─────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gap: 12,
        width: '100%',
        alignItems: 'center',
        justifyItems: 'stretch',
        marginTop: 24,
        marginBottom: 20,
        fontFamily: 'var(--font-body, system-ui, sans-serif)'
      }}>
        {[
          { label: 'Authority Score', value: activeProject?.da ?? 'N/A' },
          { label: 'Spam Score',      value: activeProject?.spam_score || activeProject?.ss || '0%' },
          { label: 'Organic Traffic', value: '0' },
          { label: 'Keywords',        value: (kwCount || activeProject?.keywords || 0).toLocaleString() },
          { label: 'Total Pages',     value: (pageCount || activeProject?.targetPages || 0).toLocaleString() },
          { label: 'Total Blogs',     value: (blogCount || activeProject?.blogPages || 0).toLocaleString() },
          { label: 'Total Clusters',  value: clusterCount.toLocaleString() },
          { label: 'Net Potential',   value: netPotential ? netPotential.toLocaleString() : '0' },
        ].map((item, idx) => (
          <div
            key={item.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              textAlign: 'center',
              background: 'linear-gradient(160deg, rgba(74, 26, 140, 0.10) 0%, #ffffff 65%)',
              border: '1px solid #E4DFEE',
              borderTop: '2.5px solid #4A1A8C',
              borderRadius: 10,
              padding: '10px 6px',
              boxShadow: '0 2px 8px rgba(74, 26, 140, 0.08)',
              transition: 'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1), border-top-color 0.18s ease',
              animation: 'bd-fade-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
              animationDelay: `${idx * 40}ms`,
              cursor: 'default'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 14px rgba(74, 26, 140, 0.12)';
              e.currentTarget.style.borderTopColor = '#7B2FBE';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(74, 26, 140, 0.08)';
              e.currentTarget.style.borderTopColor = '#4A1A8C';
            }}
          >
            <span style={{
              color: '#4A1A8C',
              fontWeight: 800,
              fontSize: 16,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums'
            }}>
              {item.value}
            </span>
            <span style={{
              color: '#6B677E',
              fontWeight: 700,
              fontSize: 10.5,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap'
            }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* ─── TOP ROW: AI SEARCH & SEO CARDS ────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
        gap: 20,
        marginBottom: 20
      }}>
        {/* CARD 1: AI SEARCH */}
        {!closedCards.aiSearch && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #E4DFEE',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                background: 'linear-gradient(135deg, #F6EEFD 0%, #FDEBF4 100%)',
                color: '#7B2FBE',
                fontSize: 11,
                fontWeight: 800,
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #E5CCF7',
                letterSpacing: '0.5px'
              }}>
                AI SEARCH
              </span>
            </div>

            {/* Sub-nav tabs */}
            <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
              {['Overview', 'ChatGPT', 'Gemini', 'AI Overview'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setAiTab(tab)}
                  style={{
                    background: aiTab === tab ? 'linear-gradient(135deg, #F6EEFD 0%, #FDEBF4 100%)' : 'transparent',
                    color: aiTab === tab ? '#7B2FBE' : '#64748b',
                    fontWeight: aiTab === tab ? 700 : 500,
                    fontSize: 13,
                    border: aiTab === tab ? '1px solid #E5CCF7' : '1px solid transparent',
                    borderRadius: 6,
                    padding: '5px 12px',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content Body */}
            {['ChatGPT', 'Gemini', 'AI Overview'].includes(aiTab) ? (() => {
              const tabKey = aiTab.toLowerCase();
              const currentTabResults = tabResults[tabKey] || [];
              const isCurrentTabAnalyzing = !!analyzingTabs[tabKey];

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 180 }}>
                  {currentTabResults.length === 0 ? (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      padding: '28px 12px',
                      textAlign: 'center'
                    }}>
                      {userCanRunActions && canRunAiModelAnalysis(user, activeProject?.slug, aiTab, currentTabResults.length > 0) && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <button
                            onClick={(e) => handleAiAnalysis(e, { analyzeAll: true })}
                            disabled={isCurrentTabAnalyzing || !topKeywords.length}
                            title="Run AI Analysis"
                            style={{
                              background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: 8,
                              padding: '10px 20px',
                              fontSize: 13.5,
                              fontWeight: 700,
                              cursor: (isCurrentTabAnalyzing || !topKeywords.length) ? 'not-allowed' : 'pointer',
                              opacity: (isCurrentTabAnalyzing || !topKeywords.length) ? 0.75 : 1,
                              boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35), 0 2px 6px rgba(212, 0, 122, 0.2)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={e => { if (!isCurrentTabAnalyzing && topKeywords.length) { e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                            onMouseLeave={e => { if (!isCurrentTabAnalyzing && topKeywords.length) { e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'; e.currentTarget.style.transform = 'translateY(0)'; } }}
                          >
                            <RefreshCw size={14} className={isCurrentTabAnalyzing ? 'animate-spin' : ''} />
                            <span>{isCurrentTabAnalyzing ? 'Analyzing...' : (currentTabResults.length > 0 ? 'Re-analyze' : 'Analyze')}</span>
                          </button>
                        </div>
                      )}
                      {analysisError && (
                        <div style={{ color: '#ef4444', fontSize: 13, fontWeight: 600 }}>{analysisError}</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* AI Visibility Arc Gauge Graph */}
                      {(() => {
                        const visibilityData = (() => {
                          if (!currentTabResults || !Array.isArray(currentTabResults) || currentTabResults.length === 0) {
                            const first = currentTabResults && typeof currentTabResults === 'object' && !Array.isArray(currentTabResults) ? currentTabResults : null;
                            if (first && (first.mentions !== undefined || first.mentioned_keywords !== undefined)) {
                              return {
                                ai_visibility: first.ai_visibility || 0,
                                mentions: first.mentions || (first.mentioned_keywords ? first.mentioned_keywords.length : 0),
                                cited_pages: first.cited_pages || (first.cited_pages_list ? first.cited_pages_list.length : 0),
                                mentioned_keywords: first.mentioned_keywords || [],
                                cited_pages_list: first.cited_pages_list || []
                              };
                            }
                            return { ai_visibility: 0, mentions: 0, cited_pages: 0, mentioned_keywords: [], cited_pages_list: [] };
                          }
                          const first = Array.isArray(currentTabResults) ? currentTabResults[0] : currentTabResults;
                          if (first && (typeof first.ai_visibility !== 'undefined' || typeof first.mentions !== 'undefined')) {
                            return first;
                          }
                          // Fallback calculation for old single-keyword format array [{ keyword, results: [...] }]
                          const cleanDomain = (activeProject?.domain || activeProject?.name || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
                          let mentionsCount = 0;
                          let citedCount = 0;
                          const mentionedKws = [];
                          const citedList = [];
                          (Array.isArray(currentTabResults) ? currentTabResults : []).forEach(res => {
                            const urls = res.results || [];
                            const domainMatches = urls.filter(u => cleanDomain && u.url?.toLowerCase().includes(cleanDomain));
                            if (domainMatches.length > 0) {
                              mentionsCount++;
                              mentionedKws.push(res.keyword);
                              domainMatches.forEach(dm => {
                                citedList.push(`${res.keyword} - ${dm.url}`);
                              });
                            }
                            citedCount += domainMatches.length;
                          });
                          const visScore = currentTabResults.length > 0 ? Math.round((mentionsCount / currentTabResults.length) * 100) : 0;
                          return {
                            ai_visibility: visScore,
                            mentions: mentionsCount,
                            cited_pages: citedCount,
                            mentioned_keywords: mentionedKws,
                            cited_pages_list: citedList
                          };
                        })();

                        const mList = visibilityData.mentioned_keywords || [];
                        const cList = visibilityData.cited_pages_list || [];
                        const mentionsVal = (typeof visibilityData.mentions === 'number' && visibilityData.mentions > 0)
                          ? visibilityData.mentions
                          : mList.length;
                        const citedVal = (typeof visibilityData.cited_pages === 'number' && visibilityData.cited_pages > 0)
                          ? visibilityData.cited_pages
                          : cList.length;

                        // Calculate actual deduplicated parsed keywords count (Top 2 per category searched by AI) vs Total Project Keywords
                        const getParsedKwCount = (kws) => {
                          if (!kws || !Array.isArray(kws) || kws.length === 0) return 0;
                          const categoryMap = {};
                          kws.forEach(k => {
                            const cat = String(k.category || k.cluster || 'General').trim();
                            if (!categoryMap[cat]) categoryMap[cat] = [];
                            categoryMap[cat].push(k);
                          });

                          const seen = new Set();
                          Object.values(categoryMap).forEach(kwGroup => {
                            const sorted = [...kwGroup].sort((a, b) => {
                              const svA = Number(String(a.sv || a.search_volume || a.kw_volume || 0).replace(/[^0-9.]/g, '')) || 0;
                              const svB = Number(String(b.sv || b.search_volume || b.kw_volume || 0).replace(/[^0-9.]/g, '')) || 0;
                              return svB - svA;
                            });

                            let addedInCat = 0;
                            for (const kObj of sorted) {
                              const kwText = String(kObj.kw || kObj.keyword || kObj.name || '').trim().toLowerCase();
                              if (kwText && !seen.has(kwText)) {
                                seen.add(kwText);
                                addedInCat++;
                                if (addedInCat >= 2) break;
                              }
                            }
                          });

                          return seen.size;
                        };

                        const totalProjectKws = projectKeywords && projectKeywords.length > 0 ? projectKeywords.length : (kwCount || 0);
                        const top2ParsedCount = getParsedKwCount(projectKeywords);
                        const parsedCount = top2ParsedCount > 0 ? top2ParsedCount : (visibilityData.total_keywords || totalProjectKws);

                        return (
                          <AiVisibilityArcGauge
                            visibility={visibilityData.ai_visibility ?? 0}
                            mentions={mentionsVal}
                            citedPages={citedVal}
                            kwMentionsList={mList}
                            kwCitationsList={cList}
                            totalKeywords={parsedCount}
                            projectTotalKeywords={totalProjectKws}
                          />
                        );
                      })()}

                      {/* Re-analyze Action */}
                      {userCanRunActions && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button
                            onClick={(e) => handleAiAnalysis(e, { analyzeAll: true })}
                            disabled={!!analyzingTabs[aiTab.toLowerCase()]}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              background: 'transparent',
                              color: '#7c3aed',
                              border: '1px solid #ddd6fe',
                              borderRadius: 6,
                              padding: '4px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: !!analyzingTabs[aiTab.toLowerCase()] ? 'not-allowed' : 'pointer',
                              opacity: !!analyzingTabs[aiTab.toLowerCase()] ? 0.6 : 1
                            }}
                          >
                            <Sparkles size={13} className={!!analyzingTabs[aiTab.toLowerCase()] ? 'animate-spin' : ''} />
                            <span>
                              {!!analyzingTabs[aiTab.toLowerCase()]
                                ? 'Analyzing...'
                                : ((tabResults[aiTab.toLowerCase()] || []).length > 0 ? 'Re-analyze' : 'Analyze')}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })() : (() => {
              const overviewPlatforms = [
                { key: 'chatgpt', name: 'ChatGPT' },
                { key: 'ai overview', name: 'AI Overview' },
                { key: 'gemini', name: 'Gemini' }
              ].map(({ key, name }) => {
                const modelResults = tabResults[key];
                const resArray = Array.isArray(modelResults) ? modelResults : (modelResults ? [modelResults] : []);
                const hasData = resArray.length > 0 && resArray[0] && typeof resArray[0].mentions !== 'undefined';
                const first = hasData ? resArray[0] : null;

                return {
                  name,
                  hasData,
                  mentions: hasData ? (first.mentions ?? 0) : 'N/A',
                  citedPages: hasData ? (first.cited_pages ?? 0) : 'N/A',
                  visibility: hasData ? (first.ai_visibility ?? 0) : null,
                  totalKeywords: hasData ? (first.total_keywords ?? topKeywords.length) : (topKeywords.length || 0)
                };
              });

              const analyzedPlatforms = overviewPlatforms.filter(p => p.hasData);
              const totalMentionsSum = analyzedPlatforms.length > 0
                ? analyzedPlatforms.reduce((sum, p) => sum + (typeof p.mentions === 'number' ? p.mentions : 0), 0)
                : 'N/A';
              const totalCitedSum = analyzedPlatforms.length > 0
                ? analyzedPlatforms.reduce((sum, p) => sum + (typeof p.citedPages === 'number' ? p.citedPages : 0), 0)
                : 'N/A';

              const overviewRunCount = analyzedPlatforms.length > 0
                ? (topKeywords.length > 0 ? topKeywords.length : (analyzedPlatforms[0].totalKeywords || 0))
                : 0;
              const overviewProjectTotal = kwCount || activeProject?.keywords || 0;
              const safeTotal = Math.max(1, overviewProjectTotal || 1);
              const overviewProgressPercent = Math.min(100, Math.max(0, (overviewRunCount / safeTotal) * 100));
              const overviewRatioText = `${overviewRunCount} / ${overviewProjectTotal}`;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 24, alignItems: 'center' }}>
                    {/* Left Meter */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                      <div style={{ position: 'relative', width: 120, height: 65, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
                        <svg width="120" height="65" viewBox="0 0 120 65">
                          <defs>
                            <linearGradient id="aiVisibilityGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#4A1A8C" />
                              <stop offset="50%" stopColor="#7B2FBE" />
                              <stop offset="100%" stopColor="#D4007A" />
                            </linearGradient>
                          </defs>
                          {/* Background Track */}
                          <path
                            d="M 12 58 A 48 48 0 0 1 108 58"
                            fill="none"
                            stroke="#e2e8f0"
                            strokeWidth="9"
                            strokeLinecap="round"
                          />
                          {/* Progress Track */}
                          <path
                            d="M 12 58 A 48 48 0 0 1 108 58"
                            fill="none"
                            stroke="url(#aiVisibilityGrad)"
                            strokeWidth="9"
                            strokeLinecap="round"
                            strokeDasharray="150.8"
                            strokeDashoffset={150.8 * (1 - overviewProgressPercent / 100)}
                            style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
                          />
                        </svg>
                        <div style={{ position: 'absolute', bottom: 14, textAlign: 'center' }}>
                          <span style={{ fontSize: overviewRatioText.length > 6 ? 16 : 22, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>
                            {overviewRatioText}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{totalMentionsSum}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>Mentions</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: '#7c3aed' }}>{totalCitedSum}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>Cited pages</div>
                        </div>
                      </div>
                    </div>

                    {/* Right Table List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#64748b',
                        paddingBottom: 4,
                        borderBottom: '1px solid #f1f5f9',
                        marginBottom: 2
                      }}>
                        <span>Platform</span>
                        <div style={{ display: 'flex', gap: 20 }}>
                          <span style={{ color: '#0f172a', fontWeight: 700, width: 65, textAlign: 'right' }}>Mentions</span>
                          <span style={{ color: '#7c3aed', fontWeight: 700, width: 75, textAlign: 'right' }}>Cited pages</span>
                        </div>
                      </div>
                      {overviewPlatforms.map(row => (
                        <div
                          key={row.name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: 13,
                            color: '#334155',
                            fontWeight: 500,
                            padding: '4px 0'
                          }}
                        >
                          <span>{row.name}</span>
                          <div style={{ display: 'flex', gap: 20 }}>
                            <span style={{ fontWeight: 700, color: row.hasData ? '#0f172a' : '#94a3b8', width: 65, textAlign: 'right' }}>
                              {row.mentions}
                            </span>
                            <span style={{ fontWeight: 700, color: row.hasData ? '#7c3aed' : '#94a3b8', width: 75, textAlign: 'right' }}>
                              {row.citedPages}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                    <button
                      onClick={() => onNavigate && onNavigate('search-visibility/ai-analysis')}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f1f5f9';
                        e.currentTarget.style.color = '#7c3aed';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#0f172a';
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#0f172a',
                        fontSize: 14.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 12px',
                        borderRadius: 6,
                        transition: 'all 0.15s ease-in-out'
                      }}
                    >
                      View all &gt;
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* CARD 2: SEO */}
        {!closedCards.seoCard && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #E4DFEE',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                background: 'linear-gradient(135deg, #E6FAF6 0%, #E6F8FF 100%)',
                color: '#008F7A',
                fontSize: 11,
                fontWeight: 800,
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #B8EFE5',
                letterSpacing: '0.5px'
              }}>
                SEO
              </span>
            </div>

            {/* Categories on Left | Top 1, Top 5 & Top 10 Columns on Right */}
            {(() => {
              const parseRank = (val) => {
                if (val == null) return null;
                const num = parseInt(String(val).replace(/[^0-9]/g, ''), 10);
                return isNaN(num) || num <= 0 ? null : num;
              };

              const calculateRanges = (kwList) => {
                const top1Map = new Map();
                const top5Map = new Map();
                const top10Map = new Map();

                kwList.forEach(k => {
                  const r = parseRank(k.rank);
                  const kwName = String(k.kw || k.keyword || '').trim();
                  if (!kwName || kwName === 'Keyword') return;

                  const lowerKey = kwName.toLowerCase();

                  if (r === 1) {
                    if (!top1Map.has(lowerKey)) {
                      top1Map.set(lowerKey, { kw: kwName, rank: r });
                    }
                  } else if (r >= 2 && r <= 5) {
                    if (!top5Map.has(lowerKey)) {
                      top5Map.set(lowerKey, { kw: kwName, rank: r });
                    }
                  } else if (r >= 6 && r <= 10) {
                    if (!top10Map.has(lowerKey)) {
                      top10Map.set(lowerKey, { kw: kwName, rank: r });
                    }
                  }
                });

                const top1Kws = Array.from(top1Map.values());
                const top5Kws = Array.from(top5Map.values());
                const top10Kws = Array.from(top10Map.values());

                return {
                  top1: top1Kws.length,
                  top1Kws,
                  top5: top5Kws.length,
                  top5Kws,
                  top10: top10Kws.length,
                  top10Kws
                };
              };

              const kws = projectKeywords || [];

              const linksKws = kws.filter(k => {
                const t = (k.type || k.category || k.cluster || '').toLowerCase();
                return !t.includes('local') && !t.includes('shopping');
              });

              const localKws = kws.filter(k => {
                const t = (k.type || k.category || k.cluster || k.targetSubtype || '').toLowerCase();
                return t.includes('local');
              });

              const shoppingKws = kws.filter(k => {
                const t = (k.type || k.category || k.cluster || k.targetSubtype || '').toLowerCase();
                return t.includes('shopping');
              });

              const linksCounts = kws.length > 0 ? calculateRanges(linksKws.length > 0 ? linksKws : kws) : { top1: 0, top1Kws: [], top5: 0, top5Kws: [], top10: 0, top10Kws: [] };
              const localCounts = kws.length > 0 ? calculateRanges(localKws) : { top1: 0, top1Kws: [], top5: 0, top5Kws: [], top10: 0, top10Kws: [] };
              const shoppingCounts = kws.length > 0 ? calculateRanges(shoppingKws) : { top1: 0, top1Kws: [], top5: 0, top5Kws: [], top10: 0, top10Kws: [] };

              const rows = [
                { id: 'links', label: 'Organic', ...linksCounts, color: '#16a34a' },
                { id: 'local', label: 'Local', ...localCounts, color: '#7c3aed' },
                { id: 'shopping', label: 'Google Shopping', ...shoppingCounts, color: '#94a3b8' }
              ];

              return (
                <div style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 16,
                  paddingTop: 4
                }}>
                  {/* Left Side: Channel Names */}
                  <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Category</div>
                    {rows.map(row => (
                      <div
                        key={row.id}
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: '#0f172a',
                          height: 24,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        {row.label}
                      </div>
                    ))}
                  </div>

                  {/* Right Side: Top 1, Top 5 & Top 10 Columns */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Column Headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      <span title="Rank 1">Top 1</span>
                      <span title="Rank 2 - 5">Top 5</span>
                      <span title="Rank 6 - 10">Top 10</span>
                    </div>

                    {/* Row Values for Links, Local, Google Shopping with Keyword Hover Tooltips */}
                    {rows.map(row => (
                      <div
                        key={row.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: 12,
                          alignItems: 'center',
                          height: 24,
                          fontSize: 13,
                          fontWeight: 800
                        }}
                      >
                        <RankHoverCell count={row.top1} kwList={row.top1Kws} title={`${row.label} Top 1`} color={row.color} />
                        <RankHoverCell count={row.top5} kwList={row.top5Kws} title={`${row.label} Top 2–5`} color={row.color} />
                        <RankHoverCell count={row.top10} kwList={row.top10Kws} title={`${row.label} Top 6–10`} color={row.color} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ─── FULL-WIDTH BRAND DISCOVERY GRID ───────────────── */}
      <div style={{
        width: '100%',
        background: '#ffffff',
        border: '1px solid #E4DFEE',
        borderRadius: 14,
        padding: 24,
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)',
        marginBottom: 20
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 24,
          minHeight: 120
        }}>
          {/* Left Section: Mentions & Cited sub-columns */}
          {(() => {
            const isOverview = (aiTab || 'overview').toLowerCase() === 'overview';
            const currentAiResults = tabResults[aiTab.toLowerCase()] || [];
            const visibilityData = currentAiResults[0] || {};
            const liveMentionedKws = visibilityData.mentioned_keywords || [];
            const liveCitedPagesList = visibilityData.cited_pages_list || [];

            // Group unique URLs and count citations (mapping to real project pages)
            const uniqueCitedUrlsMap = new Map();
            liveCitedPagesList.forEach(item => {
              const match = item.match(/https?:\/\/[^\s]+/i);
              let url = match ? match[0].trim() : item.trim();

              const itemKwMatch = item.includes(' - ') ? item.split(' - ')[0].trim().toLowerCase() : '';
              if (itemKwMatch && topKeywords && topKeywords.length > 0) {
                const foundKwRow = topKeywords.find(k => String(k.kw || k.keyword || '').trim().toLowerCase() === itemKwMatch);
                if (foundKwRow && (foundKwRow.landingPage || foundKwRow.page_url || foundKwRow.url)) {
                  url = foundKwRow.landingPage || foundKwRow.page_url || foundKwRow.url;
                }
              }

              if (url) {
                uniqueCitedUrlsMap.set(url, (uniqueCitedUrlsMap.get(url) || 0) + 1);
              }
            });
            const uniqueCitedPages = Array.from(uniqueCitedUrlsMap.entries())
              .map(([url, count]) => ({ url, count }))
              .sort((a, b) => b.count - a.count);

            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
                <span style={{
                  background: 'linear-gradient(135deg, #F6EEFD 0%, #FDEBF4 100%)',
                  color: '#7B2FBE',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid #E5CCF7',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase'
                }}>
                  AI SEARCH
                </span>
                {/* Vertical Line sub-container with Mentions & Cited */}
                <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'stretch', gap: 16 }}>
                  {/* Mentions Sub-column */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ textAlign: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Mentions ({isOverview ? 'N/A' : liveMentionedKws.length})
                      </span>
                    </div>

                    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                      {isOverview ? (
                        <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, padding: '20px 10px', textAlign: 'center' }}>
                          N/A
                        </div>
                      ) : liveMentionedKws.length > 0 ? (
                        liveMentionedKws.map((kw, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              borderRadius: 6,
                              background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                              fontSize: 12
                            }}
                          >
                            <span style={{ fontWeight: 600, color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                              "{kw}"
                            </span>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: 10, textAlign: 'center' }}>
                          No mentioned keywords yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Vertical Divider */}
                  <div style={{ width: '1px', background: '#e2e8f0' }} />

                  {/* Cited Sub-column */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ textAlign: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Cited ({isOverview ? 'N/A' : `${uniqueCitedPages.length} Unique Pages`})
                      </span>
                    </div>

                    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                      {isOverview ? (
                        <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 700, padding: '20px 10px', textAlign: 'center' }}>
                          N/A
                        </div>
                      ) : uniqueCitedPages.length > 0 ? (
                        uniqueCitedPages.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              borderRadius: 6,
                              background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                              fontSize: 12
                            }}
                          >
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontWeight: 600,
                                color: '#2563eb',
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                maxWidth: 200,
                                textDecoration: 'none'
                              }}
                              title={item.url}
                            >
                              {item.url}
                            </a>

                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: 10, textAlign: 'center' }}>
                          No cited pages yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Single Vertical Separator Line in between */}
          <div style={{ width: '1px', background: '#E4DFEE' }} />

          {/* Right Section: SEO with Cluster & Category sub-columns */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              background: 'linear-gradient(135deg, #E6FAF6 0%, #E6F8FF 100%)',
              color: '#008F7A',
              fontSize: 11,
              fontWeight: 800,
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid #B8EFE5',
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              SEO
            </span>
            {/* Vertical Line sub-container with Cluster & Category */}
            <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'stretch', gap: 16 }}>
              {/* Cluster Sub-column */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Cluster
                  </span>
                </div>
                {getDynamicClusters().map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: idx % 2 === 0 ? '#FAF8FD' : 'transparent',
                      fontSize: 12
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#334155' }}>{item.name}</span>
                    <span style={{ fontWeight: 800, color: '#0084B4', background: '#E6F8FF', border: '1px solid #BAE6FD', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                      {item.share}
                    </span>
                  </div>
                ))}
              </div>

              {/* Vertical Divider */}
              <div style={{ width: '1px', background: '#E4DFEE' }} />

              {/* Category Sub-column */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Category
                  </span>
                </div>
                {getDynamicCategories().map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: idx % 2 === 0 ? '#FAF8FD' : 'transparent',
                      fontSize: 12
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 130 }} title={item.name}>{item.name}</span>
                    <span style={{ fontWeight: 800, color: '#C026D3', background: '#FDF2F8', border: '1px solid #FBCFE8', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── FULL-WIDTH PAGE ANALYSIS GRID ───────────────── */}
      <div style={{
        width: '100%',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        marginBottom: 20
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 24,
          minHeight: 120
        }}>
          {/* Left Section: Page Analysis with 3 Sub-columns */}
          <div style={{ flex: 1.2, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              background: '#f3e8ff',
              color: '#7c3aed',
              fontSize: 11,
              fontWeight: 800,
              padding: '3px 10px',
              borderRadius: 6,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              PAGE ANALYSIS
            </span>

            {/* Dynamic Sub-nav tabs under PAGE ANALYSIS word */}
            <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 6, width: '100%', marginTop: 2, marginBottom: 4 }}>
              {[
                { key: 'organic', label: 'Organic' },
                { key: 'chatgpt', label: 'ChatGPT' },
                { key: 'gemini', label: 'Gemini' },
                { key: 'ai overview', label: 'AI Overview' }
              ].map((t) => {
                const isActive = pageAnalysisLlm === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setPageAnalysisLlm(t.key)}
                    style={{
                      background: isActive ? '#ede9fe' : 'transparent',
                      color: isActive ? '#7c3aed' : '#64748b',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: 13,
                      border: 'none',
                      borderRadius: 6,
                      padding: '5px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* 3 Sub-columns Container: URL | Category | Cluster */}
            <div style={{ width: '100%', minWidth: 0, flex: 1, display: 'flex', alignItems: 'stretch', gap: 12, maxHeight: 240, overflowY: 'auto' }}>
              {(() => {
                const pageAnalysisData = getDynamicPageAnalysisData(pageAnalysisLlm);

                return (
                  <>
                    {/* Sub-column 1: URL */}
                    <div style={{ flex: 1.5, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ textAlign: 'left', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {pageAnalysisLlm === 'organic' ? 'PAGE NAME' : 'CITATIONS'}
                        </span>
                      </div>
                      {pageAnalysisData.length === 0 ? (
                        <div style={{ padding: '12px 10px', borderRadius: 6, background: '#f8fafc', fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                          N/A
                        </div>
                      ) : (
                        pageAnalysisData.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 6,
                              background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                              fontSize: 12,
                              fontWeight: 700,
                              color: '#2563eb',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              overflow: 'hidden',
                              minWidth: 0
                            }}
                            title={item.url}
                          >
                            <a
                              href={String(item.url || '').startsWith('http') ? item.url : `https://${item.url}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                width: '100%',
                                display: 'block',
                                color: '#2563eb',
                                fontWeight: 700,
                                textDecoration: 'none'
                              }}
                            >
                              {item.url}
                            </a>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Vertical Divider 1 */}
                    <div style={{ width: '1px', background: '#e2e8f0', flexShrink: 0 }} />

                    {/* Sub-column 2: CATEGORY NAME (TEXT STRING, NO NUMBER) */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ textAlign: 'left', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Category
                        </span>
                      </div>
                      {pageAnalysisData.length === 0 ? (
                        <div style={{ padding: '12px 10px', borderRadius: 6, background: '#f8fafc', fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                          N/A
                        </div>
                      ) : (
                        pageAnalysisData.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 6,
                              background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                              fontSize: 12,
                              fontWeight: 700,
                              color: '#334155',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              overflow: 'hidden',
                              minWidth: 0
                            }}
                            title={item.categoryName}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', display: 'block', fontWeight: 700, color: '#334155' }}>
                              {item.categoryName || '-'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Vertical Divider 2 */}
                    <div style={{ width: '1px', background: '#e2e8f0', flexShrink: 0 }} />

                    {/* Sub-column 3: CLUSTER NAME (TEXT STRING, NO NUMBER) */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ textAlign: 'left', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Cluster
                        </span>
                      </div>
                      {pageAnalysisData.length === 0 ? (
                        <div style={{ padding: '12px 10px', borderRadius: 6, background: '#f8fafc', fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                          N/A
                        </div>
                      ) : (
                        pageAnalysisData.map((item, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 6,
                              background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                              fontSize: 12,
                              fontWeight: 700,
                              color: '#2563eb',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-start',
                              overflow: 'hidden',
                              minWidth: 0
                            }}
                            title={item.clusterName}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', display: 'block', fontWeight: 700, color: '#2563eb' }}>
                              {item.clusterName || '-'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Right Section: Cluster Tracking Line Graph */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            {(() => {
              const pageAnalysisData = getDynamicPageAnalysisData(pageAnalysisLlm);

              if (pageAnalysisData.length === 0) {
                return (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: 220,
                    color: '#94a3b8',
                    fontSize: 14,
                    fontWeight: 600,
                    border: '1px dashed #e2e8f0',
                    borderRadius: 8
                  }}>
                    N/A
                  </div>
                );
              }

              const llmKey = pageAnalysisLlm === 'organic' ? 'organic' : pageAnalysisLlm === 'ai overview' ? 'ai overview' : pageAnalysisLlm === 'gemini' ? 'gemini' : 'chatgpt';
              const storageKey = `ai_period_hits_${activeProject?.slug}_${llmKey}`;
              let savedHits = [];
              try {
                savedHits = JSON.parse(localStorage.getItem(storageKey) || '[]');
              } catch (e) { }

              // Calculate total page counts per cluster from left-side table data
              const clusterCounts = {};
              pageAnalysisData.forEach((item) => {
                const cName = item.clusterName || '-';
                clusterCounts[cName] = (clusterCounts[cName] || 0) + 1;
              });

              const uniqueClusters = Object.keys(clusterCounts);

              const periods = Array.from({ length: 15 }, (_, i) => `P${i + 1}`);
              // Determine how many analysis runs / period hits have actually been recorded
              const effectiveHits = savedHits.length > 0 ? savedHits : [{ dateStr: 'Hit 1', clusterCounts }];
              const recordedHitsCount = effectiveHits.length;

              const clusterTrendData = periods.map((period, wIdx) => {
                const row = { period };
                const hit = effectiveHits[wIdx];

                uniqueClusters.forEach((cName) => {
                  if (wIdx < recordedHitsCount && hit) {
                    if (hit.clusterCounts && hit.clusterCounts[cName] != null) {
                      row[cName] = hit.clusterCounts[cName];
                    } else {
                      row[cName] = clusterCounts[cName] || 0;
                    }
                  } else {
                    // Future unrecorded period: null so no point/line is drawn
                    row[cName] = null;
                  }
                });
                return row;
              });

              const colors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#06b6d4', '#ec4899', '#8b5cf6', '#eab308'];
              const legendPages = uniqueClusters.map((cName, idx) => ({
                name: cName,
                color: colors[idx % colors.length]
              }));

              return (
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'stretch' }}>
                  {/* Cluster Color Code Legend List (Horizontal Row Above Chart) */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'flex-start', paddingLeft: 35, marginBottom: 8 }}>
                    {legendPages.map((clusterItem, idx) => {
                      const isHovered = hoveredChartLine === clusterItem.name;
                      return (
                        <div
                          key={idx}
                          onMouseEnter={() => setHoveredChartLine(clusterItem.name)}
                          onMouseLeave={() => setHoveredChartLine(null)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 11.5,
                            fontWeight: isHovered ? 800 : 600,
                            color: isHovered ? clusterItem.color : '#334155',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            opacity: hoveredChartLine && !isHovered ? 0.35 : 1
                          }}
                        >
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: clusterItem.color, display: 'inline-block', flexShrink: 0 }} />
                          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 120 }} title={clusterItem.name}>
                            {clusterItem.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Line Graph Tracking Cluster */}
                  <div style={{ width: '100%', height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={clusterTrendData}
                        margin={{ top: 10, right: 15, left: 15, bottom: 20 }}
                        onMouseLeave={() => setHoveredChartLine(null)}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis
                          dataKey="period"
                          stroke="#94a3b8"
                          fontSize={9.5}
                          tickLine={false}
                          interval={0}
                          label={{ value: 'Periods', position: 'insideBottom', offset: -12, fill: '#64748b', fontSize: 11, fontWeight: 700 }}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          fontSize={11}
                          tickLine={true}
                          axisLine={true}
                          allowDecimals={false}
                          domain={[0, (dataMax) => (typeof dataMax === 'number' && !isNaN(dataMax) && dataMax > 0 ? Math.ceil(dataMax * 1.2) + 2 : 10)]}
                          tickFormatter={(val) => Math.round(val)}
                          label={{ value: 'Pages', angle: -90, position: 'insideLeft', offset: 10, fill: '#64748b', fontSize: 11, fontWeight: 700 }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const validPayload = payload.filter(p => p.value != null);
                              if (validPayload.length === 0) return null;
                              const pName = validPayload[0].payload.period;
                              const pIdx = periods.indexOf(pName);
                              const hitObj = savedHits[pIdx];

                              return (
                                <div style={{
                                  background: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 8,
                                  color: '#0f172a',
                                  fontSize: 11,
                                  padding: '8px 12px',
                                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05)',
                                  minWidth: 140
                                }}>
                                  <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>
                                    Period: {pName}
                                  </div>
                                  {hitObj?.dateStr && (
                                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                                      {hitObj.dateStr.replace(/,?\s*\d{1,2}:\d{2}.*/i, '')}
                                    </div>
                                  )}
                                  {validPayload.map((entry, idx) => (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: entry.color, fontWeight: 700 }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: entry.color, display: 'inline-block' }} />
                                        {entry.dataKey}:
                                      </div>
                                      <span style={{ color: '#0f172a', fontWeight: 800 }}>{entry.value} {entry.value === 1 ? 'Page' : 'Pages'}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        {legendPages.map((page) => {
                          const isHovered = hoveredChartLine === page.name;
                          return (
                            <Line
                              key={page.name}
                              type="monotone"
                              dataKey={page.name}
                              stroke={page.color}
                              connectNulls={false}
                              strokeWidth={isHovered ? 4 : (hoveredChartLine ? 1.5 : 2.5)}
                              strokeOpacity={hoveredChartLine && !isHovered ? 0.25 : 1}
                              dot={{ r: isHovered ? 5 : 3 }}
                              activeDot={{
                                r: 6,
                                onMouseEnter: () => setHoveredChartLine(page.name)
                              }}
                              onMouseEnter={() => setHoveredChartLine(page.name)}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Centered Aligned Title Below Graph */}
                  <div style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: '#0f172a',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    marginTop: 10,
                    textAlign: 'center',
                    width: '100%'
                  }}>
                    PAGE ANALYSIS
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* View all button redirecting to Top Pages tab */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
          <button
            onClick={() => {
              if (onNavigate) {
                if (pageAnalysisLlm === 'organic') {
                  onNavigate('search-visibility/top-pages');
                } else {
                  onNavigate('search-visibility/ai-analysis');
                }
              }
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.color = '#7c3aed';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#0f172a';
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#0f172a',
              fontSize: 14.5,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 12px',
              borderRadius: 6,
              transition: 'all 0.15s ease-in-out'
            }}
          >
            View all
          </button>
        </div>
      </div>



      {/* ─── MODAL REPORT VIEW (Triggered by View Report) ────────────────────────── */}
      {showReport && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.5)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 640,
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle color="#7c3aed" size={20} />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
                  Rank Audit Summary ({domainDisplay})
                </h3>
              </div>
              <X size={18} style={{ cursor: 'pointer' }} onClick={() => setShowReport(false)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13.5, color: '#334155' }}>
              <p style={{ margin: 0 }}>
                Brand discovery analysis was successfully generated for <strong>{domainDisplay}</strong> ({locationDisplay}).
              </p>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Total Tracked Keywords:</span>
                  <strong>{kwCount}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>Crawled Site Pages:</span>
                  <strong>{pageCount}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Location Target:</span>
                  <strong>{locationDisplay}</strong>
                </div>
              </div>
            </div>

            {multiResults && multiResults.length > 0 && (
              <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '40vh', overflowY: 'auto' }}>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>AI SEO Summaries</h4>
                {multiResults.map((res, idx) => (
                  <div key={idx} style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, color: '#334155' }}>
                    <div style={{ fontWeight: 800, color: '#7c3aed', fontSize: 14, marginBottom: 8 }}>Keyword: {res.keyword}</div>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: '#0f172a' }}>SEO Summary:</div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 12 }}>{res.seo_summary}</div>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: '#0f172a' }}>Top URLs:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(res.results || []).slice(0, 5).map((u, i) => (
                        <div key={i} style={{ color: '#64748b', fontSize: 12, wordBreak: 'break-all' }}>{i + 1}. {u.url}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setShowReport(false)}
                style={{
                  background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35), 0 2px 6px rgba(212, 0, 122, 0.2)',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'}
                onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Project Scoping - Unauthorized Popup Modal */}
      {unauthorizedModal.show && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            maxWidth: 460,
            width: '100%',
            padding: 32,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            textAlign: 'center',
            border: '1px solid #fee2e2',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#fef2f2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto',
              border: '1px solid #fca5a5'
            }}>
              <Lock size={32} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 12px 0', fontFamily: 'var(--font-display, inherit)' }}>
              You Are Not Authorized
            </h2>
            <p style={{ fontSize: 14, color: '#475569', margin: '0 0 26px 0', lineHeight: 1.6 }}>
              {unauthorizedModal.message || 'You are not authorized to view this project data or no data is available for your assigned project.'}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => setUnauthorizedModal({ show: false, message: '' })}
                style={{
                  flex: 1,
                  padding: '11px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: 10,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(220, 38, 38, 0.25)',
                  transition: 'all 0.15s ease'
                }}
              >
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BRAND ANALYSIS PAGE BLUR OVERLAY */}
      {isAnalyzingOverlay && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(248, 250, 252, 0.70)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: 180,
          borderRadius: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            width: '100%',
            maxWidth: 440,
            padding: '36px 32px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 18
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              background: '#f5f3ff',
              color: '#7c3aed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.15)'
            }}>
              <Sparkles size={32} className="animate-spin" />
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>
                Analyzing Brand & Organic Ranks...
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                Checking AI Mentions, Citations, and Organic SERP Rankings for <strong style={{ color: '#7c3aed' }}>{activeProject?.name || activeProject?.domain}</strong>. Please wait a moment.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
