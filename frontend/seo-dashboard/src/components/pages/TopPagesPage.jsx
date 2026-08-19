import { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, ExternalLink, FileText, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchDomainRows, fetchPageRows, fetchKeywordRows, fetchDomainMetricsApi } from '../../lib/projectsApi';

export default function TopPagesPage() {
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
  const [columnFilters, setColumnFilters] = useState({
    cluster: 'all',
    category: 'all',
    type: 'all',
    targetType: 'all',
    targetSubtype: 'all',
    targetGeo: 'all',
    priority: 'all'
  });
  // Region and date state
  const [selectedRegion, setSelectedRegion] = useState('IN');
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedDate, setSelectedDate] = useState('2026-08-13');

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
    // Auto-fetch domain metrics (Traffic / DA) from Moz API on project change
  useEffect(() => {
    if (activeProject?.domain || activeProject?.name) {
      const domain = activeProject.domain || activeProject.name;
      fetchDomainMetricsApi(domain)
        .then((metrics) => {
          if (metrics && (metrics.traffic || metrics.organic_traffic)) {
            const fetchedTraffic = metrics.traffic ?? metrics.organic_traffic;
            setLiveDomainTraffic(fetchedTraffic);
            if (activeProject.slug) {
              localStorage.setItem(`bd_domain_metrics_${activeProject.slug}`, JSON.stringify({
                da: metrics.da,
                traffic: fetchedTraffic
              }));
            }
          }
        })
        .catch(err => console.warn('[TopPagesPage] Domain metrics fetch notice:', err));
    }
  }, [activeProject?.slug, activeProject?.domain]);

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
          const rawSv = Number(String(k.sv || k.search_volume || k.volume || 0).replace(/[^0-9.]/g, '')) || 0;
          const rawKd = Number(String(k.kd || k.kw_diff || k.difficulty || 0).replace(/[^0-9.]/g, '')) || null;
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
            sv: 0,
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

  const hasActiveFilters = Object.values(columnFilters).some(v => v !== 'all') || intentFilter !== 'all' || typeFilter !== 'all';
  const resetAllFilters = () => {
    setColumnFilters({
      cluster: 'all',
      category: 'all',
      type: 'all',
      targetType: 'all',
      targetSubtype: 'all',
      targetGeo: 'all',
      priority: 'all'
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

    const matchCluster = columnFilters.cluster === 'all' || p.cluster === columnFilters.cluster;
    const matchCategory = columnFilters.category === 'all' || p.category === columnFilters.category;
    const matchType = columnFilters.type === 'all' || p.type === columnFilters.type;
    const matchTargetType = columnFilters.targetType === 'all' ? (typeFilter === 'all' ? true : (typeFilter === 'landing' ? p.targetType.toLowerCase().includes('landing') : p.targetType.toLowerCase().includes('blog'))) : p.targetType === columnFilters.targetType;
    const matchTargetSubtype = columnFilters.targetSubtype === 'all' ? (intentFilter === 'all' ? true : p.targetCategory.toLowerCase().includes(intentFilter.toLowerCase())) : (p.targetSubtype === columnFilters.targetSubtype || p.targetCategory === columnFilters.targetSubtype);
    const matchTargetGeo = columnFilters.targetGeo === 'all' || p.targetGeo === columnFilters.targetGeo;
    const matchPriority = columnFilters.priority === 'all' || p.priority === columnFilters.priority;

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
    } catch (e) {}
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
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: '#f8fafc', minHeight: '100vh' }}>
      
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
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
          }}>
            {/* Left Side: Dashboard: domain.com v */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h1 style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: 20,
                fontWeight: 800,
                color: '#0f172a',
                margin: 0
              }}>
                <span>Project:</span>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setProjectMenuOpen(!projectMenuOpen)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      fontSize: 20,
                      fontWeight: 800,
                      color: '#7c3aed',
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
            </div>
          </div>
        );
      })()}

      {/* ─── SUMMARY CARDS ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        
        {/* CARD 1: Traffic */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Traffic</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>
            {(() => {
              const parseTrafficNum = (val) => {
                if (val === undefined || val === null) return 0;
                if (typeof val === 'number') return val;
                const cleaned = String(val).replace(/[^0-9]/g, '');
                const parsed = parseInt(cleaned, 10);
                return !isNaN(parsed) ? parsed : 0;
              };

              const eff = parseTrafficNum(liveDomainTraffic) || parseTrafficNum(liveTraffic) || parseTrafficNum(activeProject?.traffic) || parseTrafficNum(activeProject?.organic_traffic);
              return eff > 0
                ? eff.toLocaleString()
                : (totalOrganicTraffic > 0 ? totalOrganicTraffic.toLocaleString() : '0');
            })()}
          </div>
        </div>

        {/* CARD 2: Top Pages in Top 1, Top 3, Top 10 with Hover Popovers */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '14px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>
            Top Pages
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, alignItems: 'center' }}>
            
            {/* Top 1 */}
            <div
              onMouseEnter={() => handleMouseEnterTooltip('top1')}
              onMouseLeave={handleMouseLeaveTooltip}
              style={{ display: 'flex', flexDirection: 'column', position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 1</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{top1PagesList.length}</span>

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
                    color: '#0f172a',
                    border: '1px solid #e2e8f0',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    maxHeight: 180,
                    overflowY: 'auto',
                    width: 280,
                    pointerEvents: 'auto'
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#7c3aed', marginBottom: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                    Top 1 Pages
                  </div>
                  {top1PagesList.length === 0 ? (
                    <div style={{ color: '#94a3b8' }}>No pages in Top 1</div>
                  ) : (
                    top1PagesList.map((item, i) => (
                      <div key={i} style={{ color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', wordBreak: 'break-all' }}>
                        • {item.url} <span style={{ color: '#16a34a', fontWeight: 700 }}>(Rank {item.rank})</span>
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
              style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 10, position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 3</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{top3PagesList.length}</span>

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
                    color: '#0f172a',
                    border: '1px solid #e2e8f0',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    maxHeight: 180,
                    overflowY: 'auto',
                    width: 280,
                    pointerEvents: 'auto'
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#7c3aed', marginBottom: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                    Top 3 Pages
                  </div>
                  {top3PagesList.length === 0 ? (
                    <div style={{ color: '#94a3b8' }}>No pages in Top 3</div>
                  ) : (
                    top3PagesList.map((item, i) => (
                      <div key={i} style={{ color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', wordBreak: 'break-all' }}>
                        • {item.url} <span style={{ color: '#16a34a', fontWeight: 700 }}>(Rank {item.rank})</span>
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
              style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 10, position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 10</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{top10PagesList.length}</span>

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
                    color: '#0f172a',
                    border: '1px solid #e2e8f0',
                    padding: '10px 14px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    maxHeight: 180,
                    overflowY: 'auto',
                    width: 280,
                    pointerEvents: 'auto'
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#7c3aed', marginBottom: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 4 }}>
                    Top 10 Pages
                  </div>
                  {top10PagesList.length === 0 ? (
                    <div style={{ color: '#94a3b8' }}>No pages in Top 10</div>
                  ) : (
                    top10PagesList.map((item, i) => (
                      <div key={i} style={{ color: '#334155', padding: '3px 0', borderBottom: '1px solid #f8fafc', wordBreak: 'break-all' }}>
                        • {item.url} <span style={{ color: '#16a34a', fontWeight: 700 }}>(Rank {item.rank})</span>
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
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '16px 20px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Avg. Position</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{avgPosition || '0'}</div>
        </div>

      </div>

      {/* ─── SEARCH & FILTERS BAR ───────────────────────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap'
      }}>
        {/* Search Box */}
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Search pages by name, URL, category, or cluster..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 12px 7px 32px',
              fontSize: 12.5,
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              outline: 'none'
            }}
          />
        </div>

        {/* Filter Trigger Button & Popover */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setFilterMenuOpen(!filterMenuOpen)}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: hasActiveFilters ? '1px solid #7c3aed' : '1px solid #cbd5e1',
              background: hasActiveFilters ? '#f5f3ff' : '#ffffff',
              color: hasActiveFilters ? '#7c3aed' : '#475569',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600
            }}
          >
            <Filter size={15} />
            {hasActiveFilters && (
              <span style={{
                background: '#7c3aed',
                color: '#ffffff',
                fontSize: 10,
                borderRadius: 99,
                width: 16,
                height: 16,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {Object.values(columnFilters).filter(v => v !== 'all').length + (intentFilter !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0)}
              </span>
            )}
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
                {/* Cluster */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>CLUSTER</label>
                  <select
                    value={columnFilters.cluster}
                    onChange={e => setColumnFilters({ ...columnFilters, cluster: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Clusters</option>
                    {uniqueClusters.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Category */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>CATEGORY</label>
                  <select
                    value={columnFilters.category}
                    onChange={e => setColumnFilters({ ...columnFilters, category: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Categories</option>
                    {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* Type */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TYPE</label>
                  <select
                    value={columnFilters.type}
                    onChange={e => setColumnFilters({ ...columnFilters, type: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Types</option>
                    {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Target Type */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TARGET TYPE</label>
                  <select
                    value={columnFilters.targetType}
                    onChange={e => setColumnFilters({ ...columnFilters, targetType: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Target Types</option>
                    {uniqueTargetTypes.map(tt => <option key={tt} value={tt}>{tt}</option>)}
                  </select>
                </div>

                {/* Target Subtype */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TARGET SUBTYPE</label>
                  <select
                    value={columnFilters.targetSubtype}
                    onChange={e => setColumnFilters({ ...columnFilters, targetSubtype: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Subtypes</option>
                    {uniqueTargetSubtypes.map(ts => <option key={ts} value={ts}>{ts}</option>)}
                  </select>
                </div>

                {/* Target Geo */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>TARGET GEO</label>
                  <select
                    value={columnFilters.targetGeo}
                    onChange={e => setColumnFilters({ ...columnFilters, targetGeo: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Geos</option>
                    {uniqueTargetGeos.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 }}>PRIORITY</label>
                  <select
                    value={columnFilters.priority}
                    onChange={e => setColumnFilters({ ...columnFilters, priority: e.target.value })}
                    style={{ width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="all">All Priorities</option>
                    {uniquePriorities.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <button
                onClick={() => setFilterMenuOpen(false)}
                style={{
                  width: '100%',
                  padding: '7px',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#ffffff',
                  background: '#7c3aed',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  marginTop: 4
                }}
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
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>KEYWORD</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>SV</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>RANK</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>PAGE URL</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>KW DIFF</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>CLUSTER</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>CATEGORY</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>TYPE</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>TARGET TYPE</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>TARGET SUBTYPE</th>
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
                    
                    {/* KEYWORD / PAGE NAME */}
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.pageName}
                    </td>

                    {/* SV */}
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.sv ? row.sv.toLocaleString() : 0}
                    </td>

                    {/* RANK */}
                    <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.rank > 0 ? row.rank : <span style={{ color: '#94a3b8', fontWeight: 400 }}>—</span>}
                    </td>

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

    </div>
  );
}
