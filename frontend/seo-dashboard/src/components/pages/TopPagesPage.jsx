import { useState, useEffect } from 'react';
import { Search, ChevronDown, ExternalLink, FileText } from 'lucide-react';
import { fetchDomainRows, fetchPageRows, fetchKeywordRows } from '../../lib/projectsApi';

export default function TopPagesPage() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [pagesData, setPagesData] = useState([]);
  const [projectKeywords, setProjectKeywords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState('all'); // 'all' | 'informational' | 'commercial'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'landing' | 'blog'
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

      // Map STRICTLY pages defined in Project Setup
      const combinedPages = pages.map(p => {
        if (!p.url) return null;
        const normUrl = p.url.trim().toLowerCase();
        const cleanTargetSlug = normUrl.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '');

        // Find matching intent keywords for this project setup page
        const matchingKws = kws.filter(k => {
          const rawKUrl = (k.landingPage || k.url || k.page_url || k.landing_page || k.page || '').trim();
          if (!rawKUrl) return false;
          const kNormUrl = rawKUrl.toLowerCase();
          if (kNormUrl === normUrl || kNormUrl.includes(normUrl) || normUrl.includes(kNormUrl)) return true;
          
          const kSlug = kNormUrl.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '');
          return cleanTargetSlug && kSlug && (cleanTargetSlug.includes(kSlug) || kSlug.includes(cleanTargetSlug));
        });

        const kwList = Array.from(new Set(matchingKws.map(k => k.kw).filter(Boolean)));

        // Collect ranks from matching keywords, exclude unranked (101)
        const pageRanks = matchingKws
          .map(k => {
            const raw = k.rank ?? k.position ?? k.rankVal ?? k.rank_meta?.rank;
            const val = Number(raw);
            return raw != null && !isNaN(val) && val > 0 && val < 101 ? val : null;
          })
          .filter(r => r !== null);

        const subtype = p.targetCategory || matchingKws.map(k => k.targetSubtype || k.subtype || k.intent).find(Boolean) || 'Informational';
        const targetType = p.targetType || matchingKws.map(k => k.targetType || k.page_type).find(Boolean) || 'Landing Page';

        const cleanPageName = p.pageName || p.url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ').toUpperCase() || 'PAGE';

        return {
          id: p.id || normUrl,
          pageName: cleanPageName,
          url: p.url,
          category: p.category || matchingKws.map(k => k.category).find(Boolean) || 'General',
          cluster: p.cluster || matchingKws.map(k => k.cluster).find(Boolean) || 'General',
          targetCategory: subtype,
          targetType: targetType,
          totalKws: kwList.length,
          ranks: pageRanks
        };
      }).filter(Boolean);

      // Sort by Total Keywords descending by default
      combinedPages.sort((a, b) => b.totalKws - a.totalKws);

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

  // Filtered pages based on search & intent/type dropdowns
  const filteredPages = pagesData.filter(p => {
    const matchSearch = searchQuery === '' || 
      p.pageName.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.cluster.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchIntent = intentFilter === 'all' || p.targetCategory.toLowerCase().includes(intentFilter.toLowerCase());
    const matchType = typeFilter === 'all' || (typeFilter === 'landing' ? p.targetType.toLowerCase().includes('landing') : p.targetType.toLowerCase().includes('blog'));
    
    return matchSearch && matchIntent && matchType;
  });

  // Calculate metrics
  const totalPagesCount = pagesData.length;
  const totalKwsSum = pagesData.reduce((acc, p) => acc + p.totalKws, 0);

  // Calculate Organic Traffic & Avg Traffic across pages (0 fallback)
  const totalOrganicTraffic = pagesData.reduce((acc, p) => acc + (Number(p.traffic) || Number(p.organic_traffic) || 0), 0) || Number(activeProject?.traffic) || 0;
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

  const [activeTooltip, setActiveTooltip] = useState(null); // null | 'top1' | 'top3' | 'top10'

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
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{avgTraffic || '0'}</div>
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
              onMouseEnter={() => setActiveTooltip('top1')}
              onMouseLeave={() => setActiveTooltip(null)}
              style={{ display: 'flex', flexDirection: 'column', position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 1</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{top1PagesList.length}</span>

              {activeTooltip === 'top1' && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: 8,
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
                  pointerEvents: 'none'
                }}>
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
              onMouseEnter={() => setActiveTooltip('top3')}
              onMouseLeave={() => setActiveTooltip(null)}
              style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 10, position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 3</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{top3PagesList.length}</span>

              {activeTooltip === 'top3' && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: -40,
                  marginBottom: 8,
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
                  pointerEvents: 'none'
                }}>
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
              onMouseEnter={() => setActiveTooltip('top10')}
              onMouseLeave={() => setActiveTooltip(null)}
              style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 10, position: 'relative', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 10</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{top10PagesList.length}</span>

              {activeTooltip === 'top10' && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  right: 0,
                  marginBottom: 8,
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
                  pointerEvents: 'none'
                }}>
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

        {/* Intent / Subtype Filter */}
        <select
          value={intentFilter}
          onChange={e => setIntentFilter(e.target.value)}
          style={{
            padding: '7px 12px',
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            color: '#334155',
            background: '#ffffff'
          }}
        >
          <option value="all">All Target Subtypes</option>
          <option value="informational">Informational</option>
          <option value="commercial">Commercial</option>
        </select>

        {/* Target Type Filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          style={{
            padding: '7px 12px',
            fontSize: 12.5,
            fontWeight: 600,
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            color: '#334155',
            background: '#ffffff'
          }}
        >
          <option value="all">All Target Types</option>
          <option value="landing">Landing Page</option>
          <option value="blog">Blog Page</option>
        </select>
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
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Page Name</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>URL</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Category</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Cluster</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Type</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Subtype</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    Loading pages for {activeProject?.domain || activeProject?.name}...
                  </td>
                </tr>
              ) : filteredPages.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    No pages found under Project Setup for {activeProject?.domain || activeProject?.name}.
                  </td>
                </tr>
              ) : (
                filteredPages.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                    
                    {/* PAGE NAME */}
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>
                      {row.pageName}
                    </td>

                    {/* URL */}
                    <td style={{ padding: '12px 16px', color: '#2563eb', whiteSpace: 'nowrap' }}>
                      <a href={row.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {row.url}
                        <ExternalLink size={11} />
                      </a>
                    </td>

                    {/* CATEGORY */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ background: '#f1f5f9', color: '#334155', fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 6, display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {row.category}
                      </span>
                    </td>

                    {/* CLUSTER */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      <span style={{ background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 6, display: 'inline-block', whiteSpace: 'nowrap' }}>
                        {row.cluster}
                      </span>
                    </td>

                    {/* TARGET TYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.targetType}
                    </td>

                    {/* TARGET SUBTYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.targetCategory}
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
