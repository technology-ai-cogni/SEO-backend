import { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, ExternalLink, FileText, Filter, Download, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { canDownload } from '../../lib/permissions';
import { fetchDomainRows, fetchPageRows, fetchKeywordRows, runOrganicRankCheckApi } from '../../lib/projectsApi';

// MultiSelectField Component for Popover Filters
function MultiSelectField({ label, options, selectedValues = [], onChange }) {
  const [open, setOpen] = useState(false);
  const isAll = !selectedValues || selectedValues.length === 0;

  const toggleOption = (val) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter(v => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  const getPlural = (str) => {
    if (!str) return '';
    const lower = str.toLowerCase();
    if (lower.endsWith('y')) return str.slice(0, -1) + 'ies';
    if (lower.endsWith('s')) return str + 'es';
    return str + 's';
  };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>
        {label} {selectedValues.length > 0 && <span style={{ color: '#7c3aed', fontWeight: 800 }}>({selectedValues.length})</span>}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          fontSize: 12,
          padding: '6px 10px',
          borderRadius: 6,
          border: selectedValues.length > 0 ? '1px solid #7c3aed' : '1px solid #cbd5e1',
          background: selectedValues.length > 0 ? '#f5f3ff' : '#ffffff',
          color: selectedValues.length > 0 ? '#7c3aed' : '#334155',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontWeight: selectedValues.length > 0 ? 700 : 500
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isAll ? `All ${getPlural(label)}` : selectedValues.join(', ')}
        </span>
        <ChevronDown size={14} color="#64748b" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '105%',
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 200,
          padding: 6,
          maxHeight: 180,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, background: isAll ? '#f1f5f9' : 'transparent', color: isAll ? '#7c3aed' : '#475569' }}>
            <input
              type="checkbox"
              checked={isAll}
              onChange={() => onChange([])}
              style={{ accentColor: '#7c3aed' }}
            />
            All {getPlural(label)}
          </label>
          {options.map(opt => {
            const isChecked = selectedValues.includes(opt);
            return (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', background: isChecked ? '#f5f3ff' : 'transparent', color: isChecked ? '#7c3aed' : '#0f172a', fontWeight: isChecked ? 600 : 400 }}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleOption(opt)}
                  style={{ accentColor: '#7c3aed' }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ColumnHeaderFilter Component for Pill-Style Single Select Header Dropdown
function ColumnHeaderFilter({ title, options = [], selectedValues, onChange }) {
  const currentValue = Array.isArray(selectedValues)
    ? (selectedValues.length === 1 ? selectedValues[0] : (selectedValues.length > 1 ? selectedValues[0] : 'all'))
    : (selectedValues || 'all');

  return (
    <th style={{ padding: '8px 12px', fontWeight: 600 }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <select
          value={currentValue}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val === 'all' ? [] : [val]);
          }}
          style={{
            padding: '6px 28px 6px 12px',
            borderRadius: 10,
            border: currentValue !== 'all' ? '1px solid #7c3aed' : '1px solid #e2e8f0',
            background: currentValue !== 'all' ? '#f5f3ff' : '#ffffff',
            color: currentValue !== 'all' ? '#7c3aed' : '#64748b',
            fontSize: 12,
            fontWeight: 600,
            outline: 'none',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none'
          }}
        >
          <option value="all">{title}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          color={currentValue !== 'all' ? '#7c3aed' : '#94a3b8'}
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none'
          }}
        />
      </div>
    </th>
  );
}


// URL Normalizer & Validator for LLM Cited Pages
function normalizeAndValidateUrl(itemStr, targetDomain, registeredPages = []) {
  if (!itemStr) return '';
  const str = String(itemStr).trim();
  
  // Extract HTTP/HTTPS URL if present
  const httpMatch = str.match(/https?:\/\/[^\s"'<>]+/i);
  if (httpMatch) {
    let cleanUrl = httpMatch[0].replace(/[.,;)]+$/, '');
    return cleanUrl;
  }

  // Clean domain base
  const cleanDomain = String(targetDomain || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();
  const domainBase = cleanDomain ? `https://${cleanDomain}` : 'https://example.com';

  // Check if string contains a subpath or match against registered pages
  const lowerStr = str.toLowerCase();
  if (registeredPages && registeredPages.length > 0) {
    const matchedPage = registeredPages.find(p => {
      const pUrl = (p.url || p.landingPage || p.page_url || '').toLowerCase();
      const pKw = (p.kw || p.keyword || '').toLowerCase();
      return (pUrl && lowerStr.includes(pUrl)) || (pKw && lowerStr.includes(pKw));
    });
    if (matchedPage && (matchedPage.url || matchedPage.landingPage)) {
      return matchedPage.url || matchedPage.landingPage;
    }
  }

  // Fallback to domain root URL
  return domainBase;
}

export default function TopPagesPage({ user }) {
  const userCanDownload = canDownload(user);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveDomainTraffic, setLiveDomainTraffic] = useState(null);

  const [activeTooltip, setActiveTooltip] = useState(null);
  const tooltipTimeoutRef = useRef(null);

  const handleMouseEnterTooltip = (type) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    setActiveTooltip(type);
  };

  const handleMouseLeaveTooltip = () => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    tooltipTimeoutRef.current = setTimeout(() => {
      setActiveTooltip(null);
    }, 300);
  };

  const [pagesData, setPagesData] = useState([]);
  const [projectKeywords, setProjectKeywords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState('all'); // 'all' | 'informational' | 'commercial'
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100; // 'all' | 'landing' | 'blog'

  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const handleExportCSV = () => {
    if (!filteredPages || filteredPages.length === 0) {
      alert('No data available to download.');
      return;
    }
    const headers = ['Page URL', 'SV', 'Rank', 'Keyword', 'KW Diff', 'Cluster', 'Category', 'Type', 'Target Type', 'Target Subtype', 'Target Geo', 'Priority'];
    let csvContent = headers.map(h => `"${h}"`).join(',') + '\n';
    filteredPages.forEach(r => {
      const rowData = [
        r.url || '',
        r.sv ?? 'NA',
        r.rank || '',
        r.pageName || '',
        r.kd ?? 'n/a',
        r.cluster || '',
        r.category || '',
        r.type || '',
        r.targetType || '',
        r.targetSubtype || '',
        r.targetGeo || '',
        r.priority || ''
      ];
      csvContent += rowData.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = `${activeProject?.slug || 'top_pages'}_organic.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [columnFilters, setColumnFilters] = useState({
    cluster: [],
    category: [],
    type: [],
    targetType: [],
    targetSubtype: [],
    targetGeo: [],
    priority: []
  });
  // Region and date state
  const [selectedRegion, setSelectedRegion] = useState('IN');
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('2026-08-13');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleRunOrganicRankCheck = async () => {
    if (!activeProject?.slug || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const targetRegion = selectedRegion || activeProject?.location || 'India';
      await runOrganicRankCheckApi(activeProject.slug, targetRegion);
      const updatedKws = await fetchKeywordRows(activeProject.slug);
      if (updatedKws && updatedKws.length > 0) {
        setProjectKeywords(updatedKws);
      }
    } catch (err) {
      console.warn('[TopPagesPage] Organic rank check error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const COUNTRY_OPTIONS = [
    { code: 'IN', name: 'India' },
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
    { code: 'AE', name: 'UAE' },
    { code: 'SG', name: 'Singapore' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' }
  ];

  // Load project list on mount


  useEffect(() => {
    let isMounted = true;
    async function loadProjects() {
      try {
        setLoading(true);
        const domains = await fetchDomainRows();
        if (isMounted && domains && domains.length > 0) {
          setProjects(domains);
          const savedSlug = localStorage.getItem('bd_selected_project');
          const target = (savedSlug && domains.find(p => p.slug === savedSlug)) || domains[0];
          setActiveProject(target);
          await loadPageDataForProject(target);
        }
      } catch (err) {
        console.error('[TopPagesPage] Error loading projects:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadProjects();
    return () => { isMounted = false; };
  }, []);

  // Close the project dropdown / filter popover when clicking outside them
  useEffect(() => {
    function handleClickOutside(e) {
      if (!e.target.closest('.tp-project-menu')) setProjectMenuOpen(false);
      if (!e.target.closest('.tp-filter-menu')) setFilterMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch page and keyword data for selected project strictly from Project Setup
  const loadPageDataForProject = async (proj) => {
    if (!proj?.slug) return;
    try {
      setLoading(true);
      const [fetchedPages, fetchedKws] = await Promise.all([
        fetchPageRows(proj.slug).catch(() => []),
        fetchKeywordRows(proj.slug).catch(() => [])
      ]);

      const pages = fetchedPages || [];
      const kws = fetchedKws || [];
      setProjectKeywords(kws);

      // Map data directly from keywords section (and pages section fallback)
      let combinedPages = [];

      if (kws.length > 0) {
        combinedPages = kws.map((k, idx) => {
          const svStr = String(k.sv ?? k.search_volume ?? k.volume ?? '').replace(/[^0-9.]/g, '');
          const rawSv = svStr !== '' ? (Number(svStr) || 0) : null;
          // keyword rows from fetchKeywordRows expose difficulty as `kwDiff` (db col kw_diff)
          const rawKd = Number(String(k.kwDiff ?? k.kw_diff ?? k.kd ?? k.difficulty ?? k.keyword_difficulty ?? 0).replace(/[^0-9.]/g, '')) || null;
          const rawRank = Number(k.rank || k.position || k.rank_pos || k.intentRank || 0) || 0;
          const pageUrl = (k.landingPage || k.url || k.landing_page || k.page_url || k.page || proj.domain || '').trim();
          const kwName = k.kw || k.keyword || k.name || 'Keyword';

          return {
            id: k.id || `tp-kw-${idx}`,
            kw: kwName,
            pageName: kwName,
            url: pageUrl,
            sv: rawSv,
            rank: rawRank,
            kd: rawKd,
            cluster: k.cluster || k.group || 'General',
            category: k.category || k.cat || 'General',
            type: k.type || k.intent || k.search_intent || 'Informational',
            targetType: k.targetType || k.target_type || k.page_type || 'Landing Page',
            targetCategory: k.targetSubtype || k.target_category || k.targetCategory || k.subtype || 'Informational',
            targetSubtype: k.targetSubtype || k.target_category || k.targetCategory || k.subtype || 'Informational',
            targetGeo: k.targetGeo || k.geo || k.country || proj.country || 'India',
            priority: k.priority || k.prio || 'Medium',
            totalKws: 1,
            ranks: rawRank > 0 && rawRank < 101 ? [rawRank] : []
          };
        });
      } else if (pages.length > 0) {
        combinedPages = pages.map((p, idx) => {
          if (!p.url) return null;
          return {
            id: p.id || `tp-pg-${idx}`,
            kw: p.pageName || p.url,
            pageName: p.pageName || 'PAGE',
            url: p.url,
            sv: null,
            rank: 0,
            kd: null,
            cluster: p.cluster || 'General',
            category: p.category || 'General',
            type: 'Informational',
            targetType: p.targetType || 'Landing Page',
            targetCategory: p.targetCategory || 'Informational',
            targetSubtype: p.targetCategory || 'Informational',
            targetGeo: p.targetGeo || proj.country || 'India',
            priority: p.priority || 'Medium',
            totalKws: 1,
            ranks: []
          };
        }).filter(Boolean);
      }

      setPagesData(combinedPages);
    } catch (err) {
      console.error('[TopPagesPage] Error loading page data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle project switch
  const handleSelectProject = async (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
    await loadPageDataForProject(proj);
  };

  // Unique filter values
  const uniqueClusters = Array.from(new Set(pagesData.map(p => p.cluster).filter(Boolean))).sort();
  const uniqueCategories = Array.from(new Set(pagesData.map(p => p.category).filter(Boolean))).sort();
  const uniqueTypes = Array.from(new Set(pagesData.map(p => p.type).filter(Boolean))).sort();
  const uniqueTargetTypes = Array.from(new Set(pagesData.map(p => p.targetType).filter(Boolean))).sort();
  const uniqueTargetSubtypes = Array.from(new Set(pagesData.map(p => p.targetSubtype || p.targetCategory).filter(Boolean))).sort();
  const uniqueTargetGeos = Array.from(new Set(pagesData.map(p => p.targetGeo).filter(Boolean))).sort();
  const uniquePriorities = Array.from(new Set(pagesData.map(p => p.priority).filter(Boolean))).sort();

  const hasActiveFilters = Object.values(columnFilters).some(v => Array.isArray(v) ? v.length > 0 : v !== 'all') || intentFilter !== 'all' || typeFilter !== 'all';
  const resetAllFilters = () => {
    setColumnFilters({
      cluster: [],
      category: [],
      type: [],
      targetType: [],
      targetSubtype: [],
      targetGeo: [],
      priority: []
    });
    setIntentFilter('all');
    setTypeFilter('all');
  };

  // Filtered pages based on search & column filters
  const filteredPages = pagesData.filter(p => {
    const matchSearch = searchQuery === '' ||
      (p.kw && p.kw.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.pageName && p.pageName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.url && p.url.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.cluster && p.cluster.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchCluster = !columnFilters.cluster || columnFilters.cluster.length === 0 || columnFilters.cluster.includes(p.cluster);
    const matchCategory = !columnFilters.category || columnFilters.category.length === 0 || columnFilters.category.includes(p.category);
    const matchType = !columnFilters.type || columnFilters.type.length === 0 || columnFilters.type.includes(p.type);
    const matchTargetType = (!columnFilters.targetType || columnFilters.targetType.length === 0) ? (typeFilter === 'all' ? true : (typeFilter === 'landing' ? p.targetType.toLowerCase().includes('landing') : p.targetType.toLowerCase().includes('blog'))) : columnFilters.targetType.includes(p.targetType);
    const matchTargetSubtype = (!columnFilters.targetSubtype || columnFilters.targetSubtype.length === 0) ? (intentFilter === 'all' ? true : p.targetCategory.toLowerCase().includes(intentFilter.toLowerCase())) : (columnFilters.targetSubtype.includes(p.targetSubtype) || columnFilters.targetSubtype.includes(p.targetCategory));
    const matchTargetGeo = !columnFilters.targetGeo || columnFilters.targetGeo.length === 0 || columnFilters.targetGeo.includes(p.targetGeo);
    const matchPriority = !columnFilters.priority || columnFilters.priority.length === 0 || columnFilters.priority.includes(p.priority);

    return matchSearch && matchCluster && matchCategory && matchType && matchTargetType && matchTargetSubtype && matchTargetGeo && matchPriority;
  });

  const pageCount = Math.max(1, Math.ceil(filteredPages.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedPages = filteredPages.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Calculate metrics
  const totalPagesCount = pagesData.length;
  const totalKwsSum = pagesData.reduce((acc, p) => acc + p.totalKws, 0);

  // Read stored Moz / RapidAPI domain metrics from localStorage (saved on Brand Analysis page)
  let storedMetrics = null;
  if (activeProject?.slug) {
    try {
      const raw = localStorage.getItem(`bd_domain_metrics_${activeProject.slug}`);
      if (raw) storedMetrics = JSON.parse(raw);
    } catch (e) { }
  }

  const liveTraffic = storedMetrics?.traffic ?? activeProject?.traffic ?? activeProject?.organic_traffic;

  // Calculate Organic Traffic & Avg Traffic across pages (0 fallback)
  const totalOrganicTraffic = pagesData.reduce((acc, p) => acc + (Number(p.traffic) || Number(p.organic_traffic) || 0), 0) || Number(liveTraffic) || 0;
  const avgTraffic = totalPagesCount > 0 ? Math.round(totalOrganicTraffic / totalPagesCount) : 0;

  // Calculate Avg Position: (total keyword position / number of keywords) from intent, excluding rank 101
  const intentRanks = (projectKeywords || [])
    .map(k => {
      const raw = k.rank ?? k.position ?? k.rankVal ?? k.rank_meta?.rank;
      const val = Number(raw);
      return raw != null && !isNaN(val) && val > 0 && val < 101 ? val : null;
    })
    .filter(r => r !== null);

  const pageRanksList = pagesData.flatMap(p => p.ranks || []).filter(r => typeof r === 'number' && r > 0 && r < 101);
  const activeRanks = intentRanks.length > 0 ? intentRanks : pageRanksList;

  const totalKeywordPosition = activeRanks.reduce((acc, r) => acc + r, 0);
  const numberOfKeywords = activeRanks.length;
  const avgPosition = numberOfKeywords > 0
    ? (totalKeywordPosition / numberOfKeywords).toFixed(1)
    : 0;

  // Calculate Top Pages (Top 1, Top 3, Top 10) count & list of unique URLs using best (upper/lowest numeric) rank
  const bestPageRankMap = {};
  const bestPageUrlMap = {};

  (projectKeywords || []).forEach(k => {
    const rawUrl = (k.landingPage || k.url || k.page_url || k.landing_page || k.page || '').trim();
    if (!rawUrl) return;
    const cleanUrl = rawUrl.toLowerCase();

    const rawRank = k.rank ?? k.position ?? k.rankVal ?? k.rank_meta?.rank;
    const rankVal = Number(rawRank);
    if (rawRank != null && !isNaN(rankVal) && rankVal > 0 && rankVal <= 10) {
      if (bestPageRankMap[cleanUrl] == null || rankVal < bestPageRankMap[cleanUrl]) {
        bestPageRankMap[cleanUrl] = rankVal;
        bestPageUrlMap[cleanUrl] = rawUrl;
      }
    }
  });

  (pagesData || []).forEach(p => {
    const cleanUrl = (p.url || '').trim().toLowerCase();
    if (!cleanUrl) return;

    (p.ranks || []).forEach(r => {
      if (typeof r === 'number' && r > 0 && r <= 10) {
        if (bestPageRankMap[cleanUrl] == null || r < bestPageRankMap[cleanUrl]) {
          bestPageRankMap[cleanUrl] = r;
          bestPageUrlMap[cleanUrl] = p.url;
        }
      }
    });
  });

  const top1PagesList = [];
  const top3PagesList = [];
  const top10PagesList = [];

  Object.entries(bestPageRankMap).forEach(([cleanUrl, rank]) => {
    const item = { url: bestPageUrlMap[cleanUrl] || cleanUrl, rank };
    if (rank === 1) {
      top1PagesList.push(item);
    } else if (rank >= 2 && rank <= 3) {
      top3PagesList.push(item);
    } else if (rank >= 4 && rank <= 10) {
      top10PagesList.push(item);
    }
  });

  return (
    <div style={{ position: 'relative', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ─── HEADER BAR: Dashboard: domain.com v [Link] 🇮🇳 India v 📅 Date ───── */}
      {(() => {
        const currentDomainDisplay = activeProject?.domain || activeProject?.name || 'Select Domain';
        const activeCountry = COUNTRY_OPTIONS.find(c => c.code === selectedRegion) || COUNTRY_OPTIONS[0];
        const filteredCountries = COUNTRY_OPTIONS.filter(c =>
          c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
          c.code.toLowerCase().includes(countrySearch.toLowerCase())
        );

        return (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            background: '#ffffff',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid #E4DFEE',
            boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
          }}>
            {/* Left Side: Dashboard: domain.com v */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h1 style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 20,
                fontWeight: 800,
                color: '#1A1A1A',
                margin: 0
              }}>
                <span>Project:</span>
                <div className="tp-project-menu" style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setProjectMenuOpen(!projectMenuOpen)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontSize: 20,
                      fontWeight: 800,
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {currentDomainDisplay}
                    <ChevronDown size={18} style={{ transform: projectMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>

                  {projectMenuOpen && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: 6,
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                      zIndex: 1000,
                      minWidth: 200,
                      padding: '4px 0',
                      display: 'flex',
                      flexDirection: 'column'
                    }}>
                      {projects.map(p => (
                        <button
                          key={p.slug}
                          onClick={() => handleSelectProject(p)}
                          style={{
                            padding: '8px 14px',
                            fontSize: 13.5,
                            fontWeight: activeProject?.slug === p.slug ? 700 : 500,
                            color: activeProject?.slug === p.slug ? '#7c3aed' : '#1e293b',
                            backgroundColor: activeProject?.slug === p.slug ? '#f5f3ff' : 'transparent',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'background 0.12s'
                          }}
                        >
                          {p.domain || p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <a
                  href={`https://${currentDomainDisplay}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#7c3aed', display: 'inline-flex', alignItems: 'center', marginLeft: 4 }}
                >
                  <ExternalLink size={16} />
                </a>
              </h1>
            </div>

            {/* Right Side: Country Selector & Date Picker */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 13,
              color: '#64748b',
              fontWeight: 500
            }}>
              {/* Country Selector */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
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
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
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
                    <div style={{ padding: '8px 8px 6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: '#ffffff',
                        border: '1.5px solid #818cf8',
                        borderRadius: 8,
                        padding: '4px 8px'
                      }}>
                        <Search size={14} style={{ color: '#64748b' }} />
                        <input
                          type="text"
                          placeholder="Search"
                          value={countrySearch}
                          onChange={e => setCountrySearch(e.target.value)}
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

                    <div style={{ overflowY: 'auto', maxHeight: 210, padding: '4px 0' }}>
                      {filteredCountries.map((c) => (
                        <button
                          key={c.code}
                          onClick={() => {
                            setSelectedRegion(c.code);
                            setCountryMenuOpen(false);
                          }}
                          style={{
                            width: '100%',
                            padding: '7px 12px',
                            fontSize: 13,
                            fontWeight: c.code === selectedRegion ? 700 : 500,
                            color: '#0f172a',
                            backgroundColor: c.code === selectedRegion ? '#eff6ff' : 'transparent',
                            border: 'none',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10
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
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Date Picker Button */}
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    const hiddenInput = document.getElementById('tp_header_date_picker');
                    if (hiddenInput) hiddenInput.showPicker ? hiddenInput.showPicker() : hiddenInput.click();
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#2563eb',
                    cursor: 'pointer',
                    outline: 'none',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span>📅</span>
                  <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                    {new Date(selectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </button>
                <input
                  id="tp_header_date_picker"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                />
              </div>

              {/* Organic Re-analyze Button */}
              <div style={{ marginLeft: 'auto' }}>
                <button
                  onClick={handleRunOrganicRankCheck}
                  disabled={isAnalyzing}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                    opacity: isAnalyzing ? 0.75 : 1,
                    boxShadow: '0 2px 10px rgba(74, 26, 140, 0.3)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => {
                    if (!isAnalyzing) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8E3CE0 100%)';
                      e.currentTarget.style.boxShadow = '0 4px 14px rgba(123, 47, 190, 0.4)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isAnalyzing) {
                      e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 100%)';
                      e.currentTarget.style.boxShadow = '0 2px 10px rgba(74, 26, 140, 0.3)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }
                  }}
                >
                  <Sparkles size={14} className={isAnalyzing ? 'animate-spin' : ''} />
                  <span>{isAnalyzing ? 'Analyzing...' : 'Re-analyze'}</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── SUMMARY CARDS ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>

        {/* CARD 1: Traffic */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #E4DFEE',
          borderRadius: 12,
          padding: '16px 20px',
          boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#6B677E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Traffic</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#00A6DF' }}>
            0
          </div>
        </div>

        {/* CARD 2: Top Pages in Top 1, Top 3, Top 10 with Hover Popovers */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #E4DFEE',
          borderRadius: 12,
          padding: '14px 20px',
          boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ fontSize: 12, color: '#6B677E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>
            Top Pages
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, alignItems: 'center' }}>

            {/* Top 1 */}
            <div
              onMouseEnter={() => handleMouseEnterTooltip('top1')}
              onMouseLeave={handleMouseLeaveTooltip}
              style={{ display: 'flex', flexDirection: 'column', position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#6B677E', fontWeight: 700 }}>Top 1</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#7B2FBE' }}>{top1PagesList.length}</span>

              {activeTooltip === 'top1' && (
                <div
                  onMouseEnter={() => handleMouseEnterTooltip('top1')}
                  onMouseLeave={handleMouseLeaveTooltip}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 8,
                    background: '#ffffff',
                    color: '#1A1A1A',
                    border: '1px solid #E4DFEE',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    boxShadow: '0 10px 25px rgba(74, 26, 140, 0.12)',
                    zIndex: 100,
                    maxHeight: 180,
                    overflowY: 'auto',
                    width: 280,
                    pointerEvents: 'auto'
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#7B2FBE', marginBottom: 6, borderBottom: '1px solid #F4F1FA', paddingBottom: 4 }}>
                    Top 1 Pages
                  </div>
                  {top1PagesList.length === 0 ? (
                    <div style={{ color: '#8A8A9A' }}>No pages in Top 1</div>
                  ) : (
                    top1PagesList.map((item, i) => (
                      <div key={i} style={{ color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', wordBreak: 'break-all' }}>
                        • {item.url} <span style={{ color: '#00BFA2', fontWeight: 700 }}>(Rank {item.rank})</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Top 3 */}
            <div
              onMouseEnter={() => handleMouseEnterTooltip('top3')}
              onMouseLeave={handleMouseLeaveTooltip}
              style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #E4DFEE', paddingLeft: 10, position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#6B677E', fontWeight: 700 }}>Top 3</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#00BFA2' }}>{top3PagesList.length}</span>

              {activeTooltip === 'top3' && (
                <div
                  onMouseEnter={() => handleMouseEnterTooltip('top3')}
                  onMouseLeave={handleMouseLeaveTooltip}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: -40,
                    marginTop: 8,
                    background: '#ffffff',
                    color: '#1A1A1A',
                    border: '1px solid #E4DFEE',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    boxShadow: '0 10px 25px rgba(74, 26, 140, 0.12)',
                    zIndex: 100,
                    maxHeight: 180,
                    overflowY: 'auto',
                    width: 280,
                    pointerEvents: 'auto'
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#7B2FBE', marginBottom: 6, borderBottom: '1px solid #F4F1FA', paddingBottom: 4 }}>
                    Top 3 Pages
                  </div>
                  {top3PagesList.length === 0 ? (
                    <div style={{ color: '#8A8A9A' }}>No pages in Top 3</div>
                  ) : (
                    top3PagesList.map((item, i) => (
                      <div key={i} style={{ color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', wordBreak: 'break-all' }}>
                        • {item.url} <span style={{ color: '#00BFA2', fontWeight: 700 }}>(Rank {item.rank})</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Top 10 */}
            <div
              onMouseEnter={() => handleMouseEnterTooltip('top10')}
              onMouseLeave={handleMouseLeaveTooltip}
              style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #E4DFEE', paddingLeft: 10, position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#6B677E', fontWeight: 700 }}>Top 10</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#D4007A' }}>{top10PagesList.length}</span>

              {activeTooltip === 'top10' && (
                <div
                  onMouseEnter={() => handleMouseEnterTooltip('top10')}
                  onMouseLeave={handleMouseLeaveTooltip}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 8,
                    background: '#ffffff',
                    color: '#1A1A1A',
                    border: '1px solid #E4DFEE',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    boxShadow: '0 10px 25px rgba(74, 26, 140, 0.12)',
                    zIndex: 100,
                    maxHeight: 180,
                    overflowY: 'auto',
                    width: 280,
                    pointerEvents: 'auto'
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#7B2FBE', marginBottom: 6, borderBottom: '1px solid #F4F1FA', paddingBottom: 4 }}>
                    Top 10 Pages
                  </div>
                  {top10PagesList.length === 0 ? (
                    <div style={{ color: '#8A8A9A' }}>No pages in Top 10</div>
                  ) : (
                    top10PagesList.map((item, i) => (
                      <div key={i} style={{ color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', wordBreak: 'break-all' }}>
                        • {item.url} <span style={{ color: '#00BFA2', fontWeight: 700 }}>(Rank {item.rank})</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* CARD 3: Avg. Position */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #E4DFEE',
          borderRadius: 12,
          padding: '16px 20px',
          boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#6B677E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Avg. Position</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#7B2FBE' }}>{avgPosition || '0'}</div>
        </div>

      </div>

      {/* ─── SEARCH & FILTERS BAR ───────────────────────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #E4DFEE',
        borderRadius: 12,
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
      }}>
        {/* Search Box */}
        <div style={{ position: 'relative', flex: 1, maxWidth: 280 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search pages by name, URL, category, or cluster..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 14px 9px 36px',
              fontSize: 13,
              borderRadius: 12,
              border: '1.5px solid #e2e8f0',
              background: '#f8fafc',
              outline: 'none',
              color: '#0f172a'
            }}
          />
        </div>

        {/* Download CSV Button */}
        {userCanDownload && (
          <button
            onClick={handleExportCSV}
            title="Export CSV Data"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f8fafc',
              color: '#64748b',
              border: '1.5px solid #e2e8f0',
              borderRadius: 12,
              padding: '9px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#334155'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }}
          >
            <Download size={16} />
          </button>
        )}

        {/* Filter Trigger Button & Popover */}
        <div className="tp-filter-menu" style={{ position: 'relative' }}>
          <button
            onClick={() => setFilterMenuOpen(!filterMenuOpen)}
            title="Filter options"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: hasActiveFilters ? '#f5f3ff' : '#f8fafc',
              color: hasActiveFilters ? '#7c3aed' : '#64748b',
              border: hasActiveFilters ? '1.5px solid #7c3aed' : '1.5px solid #e2e8f0',
              borderRadius: 12,
              padding: '9px 14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              if (!hasActiveFilters) { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#334155'; }
            }}
            onMouseLeave={e => {
              if (!hasActiveFilters) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }
            }}
          >
            <Filter size={16} />
          </button>

          {filterMenuOpen && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: '110%',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
              zIndex: 100,
              padding: 16,
              width: 320,
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Filter Top Pages</span>
                {hasActiveFilters && (
                  <button
                    onClick={resetAllFilters}
                    style={{ fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Reset All
                  </button>
                )}
              </div>

              {/* Filter Options Grid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                <MultiSelectField
                  label="Cluster"
                  options={uniqueClusters}
                  selectedValues={columnFilters.cluster}
                  onChange={vals => setColumnFilters({ ...columnFilters, cluster: vals })}
                />
                <MultiSelectField
                  label="Category"
                  options={uniqueCategories}
                  selectedValues={columnFilters.category}
                  onChange={vals => setColumnFilters({ ...columnFilters, category: vals })}
                />
                <MultiSelectField
                  label="Type"
                  options={uniqueTypes}
                  selectedValues={columnFilters.type}
                  onChange={vals => setColumnFilters({ ...columnFilters, type: vals })}
                />
                <MultiSelectField
                  label="Target Type"
                  options={uniqueTargetTypes}
                  selectedValues={columnFilters.targetType}
                  onChange={vals => setColumnFilters({ ...columnFilters, targetType: vals })}
                />
                <MultiSelectField
                  label="Target Subtype"
                  options={uniqueTargetSubtypes}
                  selectedValues={columnFilters.targetSubtype}
                  onChange={vals => setColumnFilters({ ...columnFilters, targetSubtype: vals })}
                />
                <MultiSelectField
                  label="Target Geo"
                  options={uniqueTargetGeos}
                  selectedValues={columnFilters.targetGeo}
                  onChange={vals => setColumnFilters({ ...columnFilters, targetGeo: vals })}
                />
                <MultiSelectField
                  label="Priority"
                  options={uniquePriorities}
                  selectedValues={columnFilters.priority}
                  onChange={vals => setColumnFilters({ ...columnFilters, priority: vals })}
                />
              </div>

              <button
                onClick={() => setFilterMenuOpen(false)}
                style={{
                  width: '100%',
                  padding: '7px',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: '#2D2D44',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  marginTop: 4,
                  boxShadow: '0 2px 6px rgba(45, 45, 68, 0.25)'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1F1F30'}
                onMouseLeave={e => e.currentTarget.style.background = '#2D2D44'}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── TOP PAGES DATA TABLE ─────────────────────────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #E4DFEE',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#FAF8FD', borderBottom: '1px solid #E4DFEE', color: '#4E4E61', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>PAGE URL</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>SV</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>RANK</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>KEYWORD</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>KW DIFF</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>CLUSTER</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>CATEGORY</th>
                <ColumnHeaderFilter
                  title="Type"
                  options={uniqueTypes}
                  selectedValues={columnFilters.type}
                  onChange={val => setColumnFilters({ ...columnFilters, type: val })}
                />
                <ColumnHeaderFilter
                  title="Target Type"
                  options={uniqueTargetTypes}
                  selectedValues={columnFilters.targetType}
                  onChange={val => setColumnFilters({ ...columnFilters, targetType: val })}
                />
                <ColumnHeaderFilter
                  title="Target Subtype"
                  options={uniqueTargetSubtypes}
                  selectedValues={columnFilters.targetSubtype}
                  onChange={val => setColumnFilters({ ...columnFilters, targetSubtype: val })}
                />
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>TARGET GEO</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>PRIORITY</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    Loading pages for {activeProject?.domain || activeProject?.name}...
                  </td>
                </tr>
              ) : filteredPages.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    No pages found under Project Setup for {activeProject?.domain || activeProject?.name}.
                  </td>
                </tr>
              ) : (
                pagedPages.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>

                    {/* PAGE URL */}
                    <td style={{ padding: '12px 16px', color: '#2563eb', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        title={row.url}
                        style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, maxWidth: '100%' }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.url}
                        </span>
                        <ExternalLink size={12} style={{ flexShrink: 0 }} />
                      </a>
                    </td>

                    {/* SV */}
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: row.sv != null ? '#0f172a' : '#94a3b8', whiteSpace: 'nowrap' }}>
                      {row.sv != null ? row.sv.toLocaleString() : 'NA'}
                    </td>

                    {/* RANK */}
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.rank > 0 ? row.rank : <span style={{ color: '#94a3b8', fontWeight: 400 }}>—</span>}
                    </td>

                    {/* KEYWORD / PAGE NAME */}
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.pageName}
                    </td>

                    {/* KW DIFF */}
                    <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {row.kd !== null && row.kd !== undefined ? (
                          <>
                            <div style={{ width: 36, height: 4, background: '#e2e8f0', borderRadius: 99 }}>
                              <div style={{
                                height: '100%',
                                borderRadius: 99,
                                width: `${Math.min(row.kd, 100)}%`,
                                background: row.kd > 60 ? '#ef4444' : row.kd > 30 ? '#f59e0b' : '#10b981'
                              }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{row.kd}</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>n/a</span>
                        )}
                      </div>
                    </td>

                    {/* CLUSTER */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 6, display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {row.cluster}
                      </span>
                    </td>

                    {/* CATEGORY */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ background: '#f1f5f9', color: '#334155', fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 6, display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {row.category}
                      </span>
                    </td>

                    {/* TYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.type || 'Informational'}
                    </td>

                    {/* TARGET TYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.targetType}
                    </td>

                    {/* TARGET SUBTYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.targetCategory}
                    </td>

                    {/* TARGET GEO */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.targetGeo || 'India'}
                    </td>

                    {/* PRIORITY */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.priority || 'Medium'}
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination Controls */}
        {filteredPages.length > 0 && (
          <div style={{
            padding: '12px 20px',
            background: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 13,
            color: '#64748b'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#ffffff',
                  color: safePage <= 1 ? '#cbd5e1' : '#475569',
                  cursor: safePage <= 1 ? 'default' : 'pointer',
                  opacity: safePage <= 1 ? 0.5 : 1
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Page:</span>
              <input
                type="text"
                value={safePage}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n)) setPage(Math.min(Math.max(1, n), pageCount));
                }}
                style={{
                  width: 38,
                  height: 28,
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  padding: '2px 4px',
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#0f172a',
                  outline: 'none',
                  background: '#ffffff'
                }}
              />
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>of {pageCount}</span>
              <button
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#ffffff',
                  color: safePage >= pageCount ? '#cbd5e1' : '#475569',
                  cursor: safePage >= pageCount ? 'default' : 'pointer',
                  opacity: safePage >= pageCount ? 0.5 : 1
                }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 500 }}>
              100 per page
            </div>
          </div>
        )}
      </div>

      {/* ORGANIC RANK CHECK CONTENT BLUR OVERLAY */}
      {isAnalyzing && (
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
                Checking Organic SERP Rankings...
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                Checking live Google organic positions for <strong style={{ color: '#7c3aed' }}>{activeProject?.name || activeProject?.domain}</strong>. Please wait a moment.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
