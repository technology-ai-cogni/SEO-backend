import { useState, useEffect } from 'react';
import { ExternalLink, Plus, Share2, Settings, Info, X, CheckCircle, Globe, Monitor, ChevronDown, Search } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { fetchDomainRows, fetchKeywordRows, fetchPageRows, runAiAnalysis } from '../../lib/projectsApi';

export default function PositionAnalysisPage({ onNavigate }) {
  const [projects, setProjects] = useState([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [activeProject, setActiveProject] = useState(null);
  const [kwCount, setKwCount] = useState(650);
  const [pageCount, setPageCount] = useState(150);
  const [blogCount, setBlogCount] = useState(0);
  const [clusterCount, setClusterCount] = useState(0);
  const [netPotential, setNetPotential] = useState(0);
  const [aiTab, setAiTab] = useState('Overview');
  const [loading, setLoading] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [analysisKeyword, setAnalysisKeyword] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState('');
  const [topKeywords, setTopKeywords] = useState([]);
  const [multiResults, setMultiResults] = useState([]);
  const [tabResults, setTabResults] = useState({});
  const [analyzingTabs, setAnalyzingTabs] = useState({});

  // Hidden cards state
  const [closedCards, setClosedCards] = useState({});
  const [selectedRegion, setSelectedRegion] = useState('US');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [hoveredChartLine, setHoveredChartLine] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [hoveredKwIndex, setHoveredKwIndex] = useState(null);

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

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);
        const domains = await fetchDomainRows();
        if (isMounted && domains && domains.length > 0) {
          setProjects(domains);
          const first = domains[0];
          setSelectedSlug(first.slug);
          setActiveProject(first);

          // Fetch project-specific data if present
          try {
            const kws = await fetchKeywordRows(first.slug);
            if (kws && kws.length > 0 && isMounted) {
              setKwCount(kws.length);
              const blogs = kws.filter(k => k.targetType === 'Blog Page').length;
              setBlogCount(blogs);
              const clusters = new Set(kws.map(k => k.cluster).filter(Boolean)).size;
              setClusterCount(clusters);

              const svSum = kws.reduce((acc, k) => {
                const val = Number(String(k.sv || 0).replace(/[^0-9.]/g, '')) || 0;
                return acc + val;
              }, 0);
              setNetPotential(svSum);

              const sortedKws = [...kws].sort((a, b) => (b.sv || 0) - (a.sv || 0));
              setTopKeywords(sortedKws.slice(0, 2).map(k => k.kw));
            } else if (isMounted) {
              setKwCount(first.keywords || 0);
              setBlogCount(first.blogPages || 0);
              setClusterCount(0);
              setNetPotential(0);
            }
            const pgs = await fetchPageRows(first.slug);
            if (pgs && pgs.length > 0 && isMounted) {
              setPageCount(pgs.length);
            } else if (kws && kws.length > 0 && isMounted) {
              const uniquePages = new Set(kws.map(k => k.landingPage).filter(Boolean)).size;
              setPageCount(uniquePages || kws.length);
            } else if (isMounted) {
              setPageCount(first.targetPages || 0);
            }
          } catch (e) {
            // keep fallbacks
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
  }, []);

  const handleSelectProject = async (slug) => {
    setSelectedSlug(slug);
    const p = projects.find(item => item.slug === slug);
    if (p) {
      setActiveProject(p);
      try {
        const kws = await fetchKeywordRows(p.slug);
        if (kws && kws.length > 0) {
          setKwCount(kws.length);
          const blogs = kws.filter(k => k.targetType === 'Blog Page').length;
          setBlogCount(blogs);
          const clusters = new Set(kws.map(k => k.cluster).filter(Boolean)).size;
          setClusterCount(clusters);

          const svSum = kws.reduce((acc, k) => {
            const val = Number(String(k.sv || 0).replace(/[^0-9.]/g, '')) || 0;
            return acc + val;
          }, 0);
          setNetPotential(svSum);

          const sortedKws = [...kws].sort((a, b) => (b.sv || 0) - (a.sv || 0));
          setTopKeywords(sortedKws.slice(0, 2).map(k => k.kw));
        } else {
          setKwCount(p.keywords || 0);
          setBlogCount(p.blogPages || 0);
          setClusterCount(0);
          setNetPotential(0);
          setTopKeywords([]);
        }

        const pgs = await fetchPageRows(p.slug);
        if (pgs && pgs.length > 0) setPageCount(pgs.length);
        else if (kws && kws.length > 0) {
          const uniquePages = new Set(kws.map(k => k.landingPage).filter(Boolean)).size;
          setPageCount(uniquePages || kws.length);
        } else {
          setPageCount(p.targetPages || 0);
        }
      } catch (e) {
        // fallbacks
      }
    }
  };

  const toggleClose = (cardId) => {
    setClosedCards(prev => ({ ...prev, [cardId]: true }));
  };

  // Load cached AI analysis results from localStorage whenever project or active tab changes
  useEffect(() => {
    if (!activeProject?.slug) return;
    const tabKey = aiTab.toLowerCase();
    const cacheKey = `ai_results_${activeProject.slug}_${tabKey}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTabResults(prev => ({ ...prev, [tabKey]: parsed }));
        }
      }
    } catch (err) {
      console.error('Error loading cached AI analysis:', err);
    }
  }, [activeProject?.slug, aiTab]);

  const handleAiAnalysis = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!topKeywords.length || !activeProject) return;
    const tabKey = aiTab.toLowerCase();
    setAnalyzingTabs(prev => ({ ...prev, [tabKey]: true }));
    setAnalysisError('');
    try {
      const results = [];
      const domain = activeProject.domain || activeProject.name || 'socialoffline.in';
      const countryObj = COUNTRY_OPTIONS.find(c => c.code === selectedRegion);
      const countryName = countryObj ? countryObj.name : selectedRegion || 'India';
      for (const kw of topKeywords) {
        const data = await runAiAnalysis(activeProject.slug, kw, tabKey, domain, countryName);
        results.push({ keyword: kw, ...data.result });
      }
      setTabResults(prev => ({ ...prev, [tabKey]: results }));
      const cacheKey = `ai_results_${activeProject.slug}_${tabKey}`;
      localStorage.setItem(cacheKey, JSON.stringify(results));
    } catch (err) {
      setAnalysisError(err.message);
    } finally {
      setAnalyzingTabs(prev => ({ ...prev, [tabKey]: false }));
    }
  };

  const domainDisplay = activeProject?.domain || activeProject?.name || 'ittisa.org';
  const locationDisplay = activeProject?.location || 'India (Google)';

  const getRegionBadgeInfo = (project, dateVal) => {
    const loc = (project?.target_regions || project?.location || project?.country || 'US').toLowerCase();

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

  return (
    <div style={{
      padding: '24px 32px',
      background: 'var(--bg, #f8fafc)',
      minHeight: '100vh',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
      color: '#1e293b'
    }}>
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
            Dashboard:
            {projects.length > 1 ? (
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <button
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
                  <div style={{
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

          {/* Interactive Country Dropdown & Metadata aligned with the end of the first box (removed if AI Search card is closed) */}
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
                      outline: 'none'
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{activeCountry.flag}</span>
                    <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{activeCountry.name}</span>
                    <ChevronDown size={14} style={{ color: '#2563eb', transform: countryMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>

                  {countryMenuOpen && (
                    <div style={{
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
                      <div style={{ overflowY: 'auto', maxHeight: 210, padding: '4px 0' }}>
                        {filteredCountries.length > 0 ? (
                          filteredCountries.map(c => (
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
                                fontWeight: c.code === selectedRegion ? 600 : 500,
                                color: '#0f172a',
                                backgroundColor: c.code === selectedRegion ? '#eff6ff' : 'transparent',
                                border: 'none',
                                textAlign: 'left',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                transition: 'background 0.12s'
                              }}
                              onMouseEnter={e => {
                                if (c.code !== selectedRegion) e.currentTarget.style.backgroundColor = '#f8fafc';
                              }}
                              onMouseLeave={e => {
                                if (c.code !== selectedRegion) e.currentTarget.style.backgroundColor = 'transparent';
                              }}
                            >
                              <span style={{ fontSize: 15 }}>{c.flag}</span>
                              <span>{c.name}</span>
                            </button>
                          ))
                        ) : (
                          <div style={{ padding: '12px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                            No countries found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Interactive Date Picker */}
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    padding: '1px 3px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#0f172a',
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    maxWidth: 96,
                    height: 20,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    transition: 'border-color 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#cbd5e1'}
                />
              </div>
            );
          })()}
        </div>

        {/* Right Column (directly above Second Box / SEO Card): Actions */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10
        }}>
          <button
            onClick={() => onNavigate ? onNavigate('project-setup') : (window.location.hash = '#project-setup')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '9px 16px',
              fontSize: 13.5,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)',
              transition: 'background 0.15s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'}
            onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
          >
            <Plus size={16} />
            Create SEO Project
          </button>

          <button
            onClick={() => navigator.clipboard.writeText(window.location.href)}
            style={{
              background: '#ffffff',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Share2 size={14} />
            Share
          </button>

          <button
            style={{
              background: '#ffffff',
              color: '#64748b',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* ─── QUICK METRICS (Between Header Bar and Cards) ─────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: '16px 44px',
        marginTop: 24,
        marginBottom: 12,
        fontFamily: 'var(--font-body, system-ui, sans-serif)'
      }}>
        {[
          { label: 'Authority Score', value: activeProject?.da || 'N/A' },
          { label: 'Organic Traffic', value: activeProject?.traffic ? Number(activeProject.traffic).toLocaleString() : '0' },
          { label: 'Keywords', value: (kwCount || activeProject?.keywords || 0).toLocaleString() },
          { label: 'Total Pages', value: (pageCount || activeProject?.targetPages || 0).toLocaleString() },
          { label: 'Total Blogs', value: (blogCount || activeProject?.blogPages || 0).toLocaleString() },
          { label: 'Total Clusters', value: clusterCount.toLocaleString() },
          { label: 'Net Potential', value: netPotential ? netPotential.toLocaleString() : '0' }
        ].map((item) => (
          <div key={item.label} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            textAlign: 'center'
          }}>
            <span style={{
              color: '#2828caff',
              fontWeight: 700,
              fontSize: 16,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums'
            }}>
              {item.value}
            </span>
            <span style={{
              color: '#64748b',
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: '0.02em',
              textTransform: 'uppercase'
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
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                background: '#f3e8ff',
                color: '#7c3aed',
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: 6,
                letterSpacing: '0.5px'
              }}>
                AI SEARCH
              </span>
              <X size={14} style={{ cursor: 'pointer', color: '#64748b' }} onClick={() => toggleClose('aiSearch')} />
            </div>

            {/* Sub-nav tabs */}
            <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', pb: 10 }}>
              {['Overview', 'ChatGPT', 'Gemini', 'AI Overview'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setAiTab(tab)}
                  style={{
                    background: aiTab === tab ? '#ede9fe' : 'transparent',
                    color: aiTab === tab ? '#7c3aed' : '#64748b',
                    fontWeight: aiTab === tab ? 700 : 500,
                    fontSize: 13,
                    border: 'none',
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
                      <button
                        onClick={handleAiAnalysis}
                        disabled={isCurrentTabAnalyzing || !topKeywords.length}
                        style={{
                          background: '#7c3aed',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '10px 20px',
                          fontSize: 13.5,
                          fontWeight: 700,
                          cursor: isCurrentTabAnalyzing || !topKeywords.length ? 'not-allowed' : 'pointer',
                          opacity: isCurrentTabAnalyzing || !topKeywords.length ? 0.7 : 1,
                          boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                      >
                        {isCurrentTabAnalyzing ? `Analyzing Top ${topKeywords.length} Keywords via ${aiTab}...` : `Analyze Top ${topKeywords.length} Keywords`}
                      </button>
                      {topKeywords.length > 0 && (
                        <span style={{ fontSize: 12.5, color: '#64748b' }}>
                          Keywords: {topKeywords.map(k => `"${k}"`).join(', ')}
                        </span>
                      )}
                      {analysisError && (
                        <div style={{ color: '#ef4444', fontSize: 13, fontWeight: 600 }}>{analysisError}</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* 1. Analyzed Keywords Box */}
                      <div style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 4, borderBottom: '1px solid #f1f5f9' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Analyzed Keywords</span>
                          <div style={{ display: 'flex', gap: 20 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', width: 55, textAlign: 'right' }}>Mentions</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', width: 65, textAlign: 'right' }}>Cited pages</span>
                          </div>
                        </div>
                        {currentTabResults.map((res, i) => {
                          const kwUrls = res.results || [];
                          const rawDomain = activeProject?.domain || activeProject?.name || '';
                          const cleanDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
                          const kwMentions = kwUrls.filter(u => cleanDomain && u.url?.toLowerCase().includes(cleanDomain)).length;
                          const kwCitations = Math.min(kwUrls.length, 10);
                          return (
                            <div
                              key={i}
                              style={{
                                position: 'relative',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: 12.5,
                                color: '#334155',
                                padding: '4px 6px',
                                borderRadius: 6,
                                cursor: 'pointer',
                                backgroundColor: hoveredKwIndex === i ? '#f8fafc' : 'transparent',
                                transition: 'background 0.12s'
                              }}
                              onMouseEnter={() => setHoveredKwIndex(i)}
                              onMouseLeave={() => setHoveredKwIndex(null)}
                            >
                              <span style={{ fontWeight: 600, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 220 }}>
                                "{res.keyword}"
                              </span>
                              <div style={{ display: 'flex', gap: 20 }}>
                                <span style={{ fontWeight: 700, color: '#0f172a', width: 55, textAlign: 'right' }}>{kwMentions}</span>
                                <span style={{ fontWeight: 700, color: '#7c3aed', width: 65, textAlign: 'right' }}>{kwCitations}</span>
                              </div>

                              {/* Hover Competitors Popover */}
                              {hoveredKwIndex === i && (
                                <div
                                  onMouseEnter={() => setHoveredKwIndex(i)}
                                  onMouseLeave={() => setHoveredKwIndex(null)}
                                  style={{
                                    position: 'absolute',
                                    bottom: '100%',
                                    right: 0,
                                    paddingBottom: 4,
                                    zIndex: 1000
                                  }}
                                >
                                  <div style={{
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: 10,
                                    padding: 12,
                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.12)',
                                    width: 330,
                                    maxHeight: 200,
                                    overflowY: 'auto'
                                  }}>
                                    <div style={{ fontSize: 11.5, fontWeight: 800, color: '#7c3aed', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid #f1f5f9' }}>
                                      Competitors / Ranking URLs for "{res.keyword}"
                                    </div>
                                    {kwUrls.length > 0 ? (
                                      kwUrls.map((urlObj, idx) => (
                                        <div key={idx} style={{ fontSize: 11.5, color: '#1e293b', marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                          <span style={{ fontWeight: 700, color: '#0f172a' }}>
                                            {idx + 1}. {(() => {
                                              if (urlObj.title && urlObj.title !== '(No Title)' && urlObj.title.trim() !== '') {
                                                return urlObj.title;
                                              }
                                              try {
                                                const u = new URL(urlObj.url);
                                                const dom = u.hostname.replace('www.', '').split('.')[0];
                                                const capDom = dom.charAt(0).toUpperCase() + dom.slice(1);
                                                const pathParts = u.pathname.split('/').filter(Boolean);
                                                if (pathParts.length > 0) {
                                                  const slug = pathParts[pathParts.length - 1].replace(/[-_]/g, ' ');
                                                  if (slug.length > 3) return `${capDom} - ${slug}`;
                                                }
                                                return `${capDom} Page`;
                                              } catch (err) {
                                                return 'Web Result';
                                              }
                                            })()}
                                          </span>
                                          <a
                                            href={urlObj.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            style={{ color: '#2563eb', fontSize: 11, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', textDecoration: 'none' }}
                                          >
                                            {urlObj.url}
                                          </a>
                                        </div>
                                      ))
                                    ) : (
                                      <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No competitors returned.</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* 2. Dedicated Domain Rank Tracker Feature */}
                      <div style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 4, borderBottom: '1px solid #f1f5f9' }}>
                          <span style={{ fontSize: 11.5, fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                            Domain Rank Tracker
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(() => {
                            const firstRes = currentTabResults[0] || {};
                            const kwUrls = firstRes.results || [];
                            const rawDomain = activeProject?.domain || activeProject?.name || '';
                            const cleanDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();

                            let matchIndex = cleanDomain ? kwUrls.findIndex(u => u.url?.toLowerCase().includes(cleanDomain)) : -1;

                            if (matchIndex === -1 && cleanDomain && firstRes.ai_answer) {
                              const lines = firstRes.ai_answer.split('\n');
                              for (let l of lines) {
                                if (l.toLowerCase().includes(cleanDomain)) {
                                  const rankMatch = l.match(/^(?:#|\b)?(\d{1,2})[\.\)\s]/);
                                  if (rankMatch) {
                                    matchIndex = parseInt(rankMatch[1], 10) - 1;
                                    break;
                                  }
                                }
                              }
                            }

                            let rankText = '101';
                            let badgeBg = 'transparent';
                            let badgeColor = '#ef4444';

                            if (matchIndex >= 0) {
                              rankText = `#${matchIndex + 1}`;
                              badgeBg = '#dcfce7';
                              badgeColor = '#15803d';
                            } else if (firstRes.ai_answer && cleanDomain && firstRes.ai_answer.toLowerCase().includes(cleanDomain)) {
                              rankText = 'Mentioned in AI';
                              badgeBg = '#eff6ff';
                              badgeColor = '#2563eb';
                            }

                            const othersVal = matchIndex >= 0 ? matchIndex : -1;

                            return (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: '#1e293b' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 240 }}>
                                    "{rawDomain || 'dogseechew.in'}"
                                  </span>
                                  <span style={{
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    color: badgeColor,
                                    backgroundColor: badgeBg,
                                    padding: '2px 10px',
                                    borderRadius: 12,
                                    minWidth: 95,
                                    textAlign: 'center',
                                    display: 'inline-block'
                                  }}>
                                    {rankText}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: '#1e293b' }}>
                                  <span style={{ fontWeight: 600, color: '#334155' }}>
                                    "Others"
                                  </span>
                                  <span style={{
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    color: '#64748b',
                                    backgroundColor: 'transparent',
                                    padding: '2px 10px',
                                    minWidth: 95,
                                    textAlign: 'center',
                                    display: 'inline-block'
                                  }}>
                                    {othersVal}
                                  </span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Re-analyze Action */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button
                          onClick={handleAiAnalysis}
                          disabled={isCurrentTabAnalyzing}
                          style={{
                            background: 'transparent',
                            color: '#7c3aed',
                            border: '1px solid #ddd6fe',
                            borderRadius: 6,
                            padding: '4px 12px',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: isCurrentTabAnalyzing ? 'not-allowed' : 'pointer',
                            opacity: isCurrentTabAnalyzing ? 0.6 : 1
                          }}
                        >
                          {isCurrentTabAnalyzing ? `Analyzing via ${aiTab}...` : 'Re-analyze Keywords'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 24, alignItems: 'center' }}>
                {/* Left Meter */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                  <div style={{ position: 'relative', width: 120, height: 65, display: 'flex', justifyContent: 'center', alignItems: 'flex-end' }}>
                    <svg width="120" height="65" viewBox="0 0 120 65">
                      <defs>
                        <linearGradient id="aiVisibilityGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#7c3aed" />
                          <stop offset="100%" stopColor="#a855f7" />
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
                      {/* Perfectly Aligned Progress Track */}
                      <path
                        d="M 12 58 A 48 48 0 0 1 108 58"
                        fill="none"
                        stroke="url(#aiVisibilityGrad)"
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray="150.8"
                        strokeDashoffset={150.8 * (1 - 90 / 100)}
                        style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
                      />
                    </svg>
                    <div style={{ position: 'absolute', bottom: 2, textAlign: 'center' }}>
                      <span style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>90</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, marginTop: 4 }}>AI Visibility</div>

                  <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>7</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Mentions</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#7c3aed' }}>38</div>
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
                      <span style={{ color: '#0f172a', fontWeight: 700, width: 55, textAlign: 'right' }}>Mentions</span>
                      <span style={{ color: '#7c3aed', fontWeight: 700, width: 65, textAlign: 'right' }}>Cited pages</span>
                    </div>
                  </div>
                  {[
                    { name: 'ChatGPT', val1: 0, val2: 17 },
                    { name: 'AI Overview', val1: 1, val2: 15 },
                    { name: 'AI Mode', val1: 2, val2: 20 },
                    { name: 'Gemini', val1: 4, val2: 9 },
                  ].map(row => (
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
                        <span style={{ fontWeight: 700, color: '#0f172a', width: 55, textAlign: 'right' }}>{row.val1}</span>
                        <span style={{ fontWeight: 700, color: '#7c3aed', width: 65, textAlign: 'right' }}>{row.val2}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rank Audit Complete Status Banner — Overview only */}
            {aiTab === 'Overview' && (
              <div style={{
                background: '#f8fafc',
                border: '1.5px dashed #c084fc',
                borderRadius: 10,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 4
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: '#7c3aed',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0
                  }}>
                    ✓
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Rank Audit Complete</div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 1 }}>
                      Ranks successfully generated for all {kwCount} keywords.
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowReport(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#7c3aed',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                    flexShrink: 0
                  }}
                >
                  View Report
                </button>
              </div>
            )}
          </div>
        )}

        {/* CARD 2: SEO */}
        {!closedCards.seoCard && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}>
            {/* Card Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                background: '#e0f2fe',
                color: '#0284c7',
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 10px',
                borderRadius: 6,
                letterSpacing: '0.5px'
              }}>
                SEO
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                <X size={14} style={{ cursor: 'pointer' }} onClick={() => toggleClose('seoCard')} />
              </div>
            </div>

            {/* 3 Column Metrics */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              paddingTop: 10
            }}>
              {/* Metric 1 */}
              <div>
                <div style={{ fontSize: 13, color: '#334155', fontWeight: 500, marginBottom: 6 }}>Authority Score</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>19</div>
                <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>Semrush: 2.4M</div>
              </div>

              {/* Metric 2 */}
              <div>
                <div style={{ fontSize: 13, color: '#334155', fontWeight: 500, marginBottom: 6 }}>Organic Traffic</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>261</div>
                <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>+96.24%</div>
              </div>

              {/* Metric 3 */}
              <div>
                <div style={{ fontSize: 13, color: '#334155', fontWeight: 500, marginBottom: 6 }}>Org. Keywords</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{kwCount}</div>
                <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>+28.46%</div>
              </div>
            </div>

            {/* Lower Section: Categories on Left | Line In Between | Top 1, Top 3 & Top 10 Columns on Right */}
            <div style={{
              display: 'flex',
              alignItems: 'stretch',
              gap: 16,
              paddingTop: 12,
              borderTop: '1px solid #f1f5f9',
              marginTop: 4
            }}>
              {/* Left Side: Channel Names */}
              <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Category</div>
                {[
                  'Links',
                  'Local',
                  'Google Shopping'
                ].map(name => (
                  <div
                    key={name}
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: '#0f172a',
                      height: 24,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    {name}
                  </div>
                ))}
              </div>

              {/* Right Side: Top 1, Top 3 & Top 10 Columns */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Column Headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <span>Top 1</span>
                  <span>Top 3</span>
                  <span>Top 10</span>
                </div>

                {/* Row Values for Links, Local, Google Shopping */}
                {[
                  { id: 'links', top1: '5', top3: '14', top10: '58', color: '#16a34a' },
                  { id: 'local', top1: '1', top3: '2', top10: '9', color: '#7c3aed' },
                  { id: 'shopping', top1: '0', top3: '0', top10: '0', color: '#94a3b8' }
                ].map(row => (
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
                    <span style={{ color: row.color }}>{row.top1}</span>
                    <span style={{ color: row.color }}>{row.top3}</span>
                    <span style={{ color: row.color }}>{row.top10}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── FULL-WIDTH BRAND DISCOVERY GRID ───────────────── */}
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
          {/* Left Section: Top Product with Mentions & Cited sub-columns */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              background: '#f3e8ff',
              color: '#7c3aed',
              fontSize: 11,
              fontWeight: 800,
              padding: '4px 12px',
              borderRadius: 6,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              TOP PRODUCT
            </span>
            {/* Vertical Line sub-container with Mentions & Cited */}
            <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'stretch', gap: 16 }}>
              {/* Mentions Sub-column */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Mentions
                  </span>
                </div>
                {[
                  { name: 'IB Diploma Program', count: '42' },
                  { name: 'Primary Admissions', count: '28' },
                  { name: 'STEM Robotics Lab', count: '19' },
                  { name: 'Bilingual Curriculum', count: '15' },
                  { name: 'Early Childhood Edu', count: '11' }
                ].map((item, idx) => (
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
                    <span style={{ fontWeight: 600, color: '#334155' }}>{item.name}</span>
                    <span style={{ fontWeight: 800, color: '#16a34a', background: '#f0fdf4', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>

              {/* Vertical Divider */}
              <div style={{ width: '1px', background: '#e2e8f0' }} />

              {/* Cited Sub-column */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Cited
                  </span>
                </div>
                {[
                  { source: 'owis.edu.sg/ib-diploma', count: '18' },
                  { source: 'owis.edu.sg/primary', count: '12' },
                  { source: 'owis.edu.sg/stem-lab', count: '9' },
                  { source: 'owis.edu.sg/bilingual', count: '7' },
                  { source: 'owis.edu.sg/admissions', count: '4' }
                ].map((item, idx) => (
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
                    <span style={{ fontWeight: 600, color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 130 }}>{item.source}</span>
                    <span style={{ fontWeight: 800, color: '#7c3aed', background: '#f5f3ff', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Single Vertical Separator Line in between */}
          <div style={{ width: '1px', background: '#e2e8f0' }} />

          {/* Right Section: Intent with Cluster & Category sub-columns */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              background: '#f3e8ff',
              color: '#7c3aed',
              fontSize: 11,
              fontWeight: 800,
              padding: '4px 12px',
              borderRadius: 6,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              INTENT
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
                {[
                  { name: 'Informational', share: '48%' },
                  { name: 'Navigational', share: '26%' },
                  { name: 'Commercial', share: '16%' },
                  { name: 'Transactional', share: '7%' },
                  { name: 'Local Intent', share: '3%' }
                ].map((item, idx) => (
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
                    <span style={{ fontWeight: 600, color: '#334155' }}>{item.name}</span>
                    <span style={{ fontWeight: 800, color: '#2563eb', background: '#eff6ff', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
                      {item.share}
                    </span>
                  </div>
                ))}
              </div>

              {/* Vertical Divider */}
              <div style={{ width: '1px', background: '#e2e8f0' }} />

              {/* Category Sub-column */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ textAlign: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Category
                  </span>
                </div>
                {[
                  { name: 'School Fee & Cost', count: '34' },
                  { name: 'Curriculum IB', count: '29' },
                  { name: 'Campus Tour', count: '18' },
                  { name: 'Admissions Inquiry', count: '14' },
                  { name: 'Location & Map', count: '9' }
                ].map((item, idx) => (
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
                    <span style={{ fontWeight: 600, color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 130 }}>{item.name}</span>
                    <span style={{ fontWeight: 800, color: '#d97706', background: '#fffbeb', padding: '2px 7px', borderRadius: 4, fontSize: 11 }}>
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <span style={{
              background: '#f3e8ff',
              color: '#7c3aed',
              fontSize: 11,
              fontWeight: 800,
              padding: '4px 12px',
              borderRadius: 6,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}>
              PAGE ANALYSIS
            </span>

            {/* 3 Sub-columns Container: Page Name | Cluster | Category */}
            <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'stretch', gap: 16 }}>
              {(() => {
                const pageAnalysisData = [
                  {
                    name: '/ib-diploma',
                    clusters: ['Informational (3)', 'Navigational (2)', 'Commercial (1)'],
                    clusterTrend: { direction: 'up', change: '2' },
                    categories: ['High Potential', 'Brand Search', 'Comparison'],
                    categoryTrend: { direction: 'up', change: '1' }
                  },
                  {
                    name: '/primary-school',
                    clusters: ['Informational (2)', 'Navigational (1)', 'Local Intent (1)'],
                    clusterTrend: { direction: 'down', change: '1' },
                    categories: ['High Potential', 'Admissions Inquiry', 'Location & Map', 'Campus Tour', 'Brand Search', 'Fee Structure'],
                    categoryTrend: { direction: 'up', change: '3' }
                  },
                  {
                    name: '/stem-lab',
                    clusters: ['Informational (2)', 'Commercial (1)'],
                    clusterTrend: { direction: 'up', change: '1' },
                    categories: ['Curriculum IB', 'Equipment & Tech'],
                    categoryTrend: { direction: 'down', change: '1' }
                  },
                  {
                    name: '/bilingual-learning',
                    clusters: ['Informational (3)', 'Commercial (1)', 'Transactional (1)'],
                    clusterTrend: { direction: 'up', change: '2' },
                    categories: ['Curriculum IB', 'High Potential', 'Comparison', 'Direct Leads'],
                    categoryTrend: { direction: 'up', change: '2' }
                  },
                  {
                    name: '/admissions',
                    clusters: ['Navigational (1)', 'Transactional (1)'],
                    clusterTrend: { direction: 'down', change: '1' },
                    categories: ['Admissions Inquiry', 'School Fee & Cost', 'Campus Tour'],
                    categoryTrend: { direction: 'down', change: '2' }
                  }
                ];

                return (
                  <>
                    {/* Sub-column 1: Page Name */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ textAlign: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Page Name
                        </span>
                      </div>
                      {pageAnalysisData.map((item, idx) => (
                        <div key={idx} style={{ padding: '6px 10px', borderRadius: 6, background: idx % 2 === 0 ? '#f8fafc' : 'transparent', fontSize: 12, fontWeight: 600, color: '#334155', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </div>
                      ))}
                    </div>

                    {/* Vertical Divider 1 */}
                    <div style={{ width: '1px', background: '#e2e8f0' }} />

                    {/* Sub-column 2: Cluster */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ textAlign: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Cluster
                        </span>
                      </div>
                      {pageAnalysisData.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            position: 'relative'
                          }}
                        >
                          <span
                            onMouseEnter={() => setActiveTooltip(`cluster-${idx}`)}
                            onMouseLeave={() => setActiveTooltip(null)}
                            style={{
                              fontWeight: 800,
                              color: '#0f172a',
                              fontSize: 13,
                              cursor: 'pointer',
                              display: 'inline-block'
                            }}
                          >
                            {item.clusters.length}
                          </span>

                          {/* Up/Down Trend Indicator */}
                          <span style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: item.clusterTrend.direction === 'up' ? '#16a34a' : '#dc2626'
                          }}>
                            {item.clusterTrend.direction === 'up' ? '▲' : '▼'} {item.clusterTrend.change}
                          </span>

                          {/* Hover Tooltip Popup */}
                          {activeTooltip === `cluster-${idx}` && (
                            <div style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              marginBottom: 6,
                              background: '#0f172a',
                              color: '#ffffff',
                              padding: '8px 12px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2), 0 4px 6px -4px rgba(0,0,0,0.1)',
                              zIndex: 100,
                              pointerEvents: 'none'
                            }}>
                              <div style={{ fontWeight: 800, color: '#93c5fd', marginBottom: 4, borderBottom: '1px solid #334155', paddingBottom: 2 }}>
                                Clusters ({item.clusters.length})
                              </div>
                              {item.clusters.map((c, i) => (
                                <div key={i} style={{ color: '#f8fafc', padding: '1px 0' }}>• {c}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Vertical Divider 2 */}
                    <div style={{ width: '1px', background: '#e2e8f0' }} />

                    {/* Sub-column 3: Category */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ textAlign: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Category
                        </span>
                      </div>
                      {pageAnalysisData.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            background: idx % 2 === 0 ? '#f8fafc' : 'transparent',
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            position: 'relative'
                          }}
                        >
                          <span
                            onMouseEnter={() => setActiveTooltip(`cat-${idx}`)}
                            onMouseLeave={() => setActiveTooltip(null)}
                            style={{
                              fontWeight: 800,
                              color: '#0f172a',
                              fontSize: 13,
                              cursor: 'pointer',
                              display: 'inline-block'
                            }}
                          >
                            {item.categories.length}
                          </span>

                          {/* Up/Down Trend Indicator */}
                          <span style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: item.categoryTrend.direction === 'up' ? '#16a34a' : '#dc2626'
                          }}>
                            {item.categoryTrend.direction === 'up' ? '▲' : '▼'} {item.categoryTrend.change}
                          </span>

                          {/* Hover Tooltip Popup */}
                          {activeTooltip === `cat-${idx}` && (
                            <div style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              marginBottom: 6,
                              background: '#0f172a',
                              color: '#ffffff',
                              padding: '8px 12px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2), 0 4px 6px -4px rgba(0,0,0,0.1)',
                              zIndex: 100,
                              pointerEvents: 'none'
                            }}>
                              <div style={{ fontWeight: 800, color: '#fde047', marginBottom: 4, borderBottom: '1px solid #334155', paddingBottom: 2 }}>
                                Categories ({item.categories.length})
                              </div>
                              {item.categories.map((cat, i) => (
                                <div key={i} style={{ color: '#f8fafc', padding: '1px 0' }}>• {cat}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Right Section: Cluster Tracking Line Graph */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            {/* Line Chart Area */}
            {(() => {
              const clusterTrendData = [
                { week: 'W1', '/ib-diploma': 2, '/primary-school': 5, '/stem-lab': 1, '/bilingual-learning': 3, '/admissions': 3 },
                { week: 'W2', '/ib-diploma': 3, '/primary-school': 4, '/stem-lab': 2, '/bilingual-learning': 4, '/admissions': 2 },
                { week: 'W3', '/ib-diploma': 4, '/primary-school': 5, '/stem-lab': 2, '/bilingual-learning': 4, '/admissions': 3 },
                { week: 'W4', '/ib-diploma': 5, '/primary-school': 4, '/stem-lab': 3, '/bilingual-learning': 5, '/admissions': 2 },
                { week: 'W5', '/ib-diploma': 6, '/primary-school': 4, '/stem-lab': 3, '/bilingual-learning': 5, '/admissions': 2 }
              ];

              const legendPages = [
                { name: '/ib-diploma', color: '#2563eb' },
                { name: '/primary-school', color: '#16a34a' },
                { name: '/stem-lab', color: '#d97706' },
                { name: '/bilingual-learning', color: '#9333ea' },
                { name: '/admissions', color: '#dc2626' }
              ];

              return (
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                  <div style={{ display: 'flex', gap: 16, width: '100%', height: 220, marginTop: 12 }}>
                    {/* Page Name Legend List on Left */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', minWidth: 130 }}>
                      {legendPages.map((page, idx) => {
                        const isHovered = hoveredChartLine === page.name;
                        return (
                          <div
                            key={idx}
                            onMouseEnter={() => setHoveredChartLine(page.name)}
                            onMouseLeave={() => setHoveredChartLine(null)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11,
                              fontWeight: isHovered ? 800 : 600,
                              color: isHovered ? page.color : '#334155',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              opacity: hoveredChartLine && !isHovered ? 0.4 : 1
                            }}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: page.color, display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 115 }}>{page.name}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Line Graph Tracking Cluster */}
                    <div style={{ flex: 1, height: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={clusterTrendData}
                          margin={{ top: 20, right: 10, left: -25, bottom: 0 }}
                          onMouseLeave={() => setHoveredChartLine(null)}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="week" stroke="#94a3b8" fontSize={10.5} tickLine={false} />
                          <YAxis stroke="#94a3b8" fontSize={10.5} tickLine={false} domain={[0, 8]} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const targetItem = (hoveredChartLine && payload.find(p => p.dataKey === hoveredChartLine)) || payload[0];
                                if (!targetItem) return null;
                                return (
                                  <div style={{
                                    background: '#0f172a',
                                    border: 'none',
                                    borderRadius: 8,
                                    color: '#fff',
                                    fontSize: 11,
                                    padding: '8px 12px',
                                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)'
                                  }}>
                                    <div style={{ fontWeight: 700, color: targetItem.color, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: targetItem.color, display: 'inline-block' }} />
                                      {targetItem.dataKey}
                                    </div>
                                    <div style={{ color: '#f8fafc', fontWeight: 600 }}>
                                      Clusters: <span style={{ color: targetItem.color, fontWeight: 800 }}>{targetItem.value}</span>
                                    </div>
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
                  </div>

                  {/* Clean Black Text Below Graph - Left Aligned Starting at Red Circle (Right after W2) */}
                  <div style={{
                    fontSize: 13,
                    fontWeight: 800,
                    color: '#0f172a',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    marginTop: 6,
                    textAlign: 'left',
                    width: '100%',
                    paddingLeft: 275
                  }}>
                    Cluster Trend Tracking
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ─── BOTTOM ROW: ON-PAGE, BACKLINK & ORGANIC TRAFFIC INSIGHTS CARDS ─────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 20
      }}>
        {/* CARD 5: On Page SEO Checker */}
        {!closedCards.onPage && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 140
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>On Page SEO Checker</span>
                  <Info size={14} color="#94a3b8" />
                </div>
                <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('onPage')} />
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Collect ideas on strategy, content, backlinks and more.
              </p>
            </div>
            <div>
              <button style={{
                background: '#f1f5f9',
                color: '#334155',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Set up
              </button>
            </div>
          </div>
        )}

        {/* CARD 6: Backlink Audit */}
        {!closedCards.backlink && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 140
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Backlink Audit</span>
                  <Info size={14} color="#94a3b8" />
                </div>
                <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('backlink')} />
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Detoxify your backlink portfolio and strengthen your website rankings.
              </p>
            </div>
            <div>
              <button style={{
                background: '#f1f5f9',
                color: '#334155',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Set up
              </button>
            </div>
          </div>
        )}

        {/* CARD 7: Organic Traffic Insights */}
        {!closedCards.organicTraffic && (
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
            minHeight: 140
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Organic Traffic Insights</span>
                  <Info size={14} color="#94a3b8" />
                </div>
                <X size={14} style={{ cursor: 'pointer', color: '#94a3b8' }} onClick={() => toggleClose('organicTraffic')} />
              </div>
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
                Uncover "not provided" keywords combining GA, GSC and Semrush data.
              </p>
            </div>
            <div>
              <button style={{
                background: '#f1f5f9',
                color: '#334155',
                border: 'none',
                borderRadius: 6,
                padding: '6px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Set up
              </button>
            </div>
          </div>
        )}
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
                  background: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
