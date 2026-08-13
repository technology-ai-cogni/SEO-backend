import { useState, useEffect } from 'react';
import { Search, ChevronDown, ExternalLink, Sparkles, RefreshCw } from 'lucide-react';
import {
  fetchDomainRows,
  fetchKeywordRows,
  fetchAiAnalysisHistory,
  runAiVisibilityAnalysis
} from '../../lib/projectsApi';
import { supabase } from '../../lib/supabaseClient';
import { hasPermission, PERMISSIONS, canRunActions } from '../../lib/permissions';

export default function AiAnalysisPage({ user }) {
  const userCanRunActions = canRunActions(user);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectKeywords, setProjectKeywords] = useState([]);
  const [history, setHistory] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);

  // Sub-view & Filters
  const [selectedEngine, setSelectedEngine] = useState('chatgpt'); // 'chatgpt' | 'gemini' | 'ai overview'
  const [activeSubTab, setActiveSubTab] = useState('mentions'); // 'mentions' | 'citations'
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

  // Load projects list and initial data
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const domains = await fetchDomainRows();
        if (isMounted && domains && domains.length > 0) {
          setProjects(domains);
          const savedSlug = localStorage.getItem('bd_selected_project');
          const target = (savedSlug && domains.find(p => p.slug === savedSlug)) || domains[0];
          setActiveProject(target);
          await loadProjectData(target.slug);
        }
      } catch (err) {
        console.error('[AiAnalysisPage] Error loading projects:', err);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  const loadProjectData = async (slug) => {
    if (!slug) return;
    try {
      const [kws, hist] = await Promise.all([
        fetchKeywordRows(slug),
        fetchAiAnalysisHistory(slug)
      ]);
      setProjectKeywords(kws || []);
      setHistory(hist || []);
    } catch (e) {
      console.error('[AiAnalysisPage] Error loading project data:', e);
    }
  };

  const handleSelectProject = async (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
    await loadProjectData(proj.slug);
  };

  const handleRunAnalysis = async () => {
    if (!activeProject?.slug || analyzing) return;
    if (!userCanRunActions || !hasPermission(user, PERMISSIONS.RUN_ANALYSIS)) {
      alert('Permission Denied: You do not have permission to run AI analysis.');
      return;
    }
    setAnalyzing(true);
    try {
      const domain = activeProject?.domain || activeProject?.name || '';
      const kwList = projectKeywords.map(k => k.kw || k.keyword).filter(Boolean);
      
      const res = await runAiVisibilityAnalysis(activeProject.slug, domain, 'India', kwList, selectedEngine);
      const resObj = res?.result || {};
      
      // Update shared localStorage key used by Brand Discovery (PositionAnalysisPage)
      const engKey = selectedEngine.toLowerCase().trim();
      localStorage.setItem(`ai_results_${activeProject.slug}_${engKey}`, JSON.stringify([resObj]));
      
      // Auto-persist directly to Supabase table `ai_analysis`
      if (supabase && res?.result) {
        try {
          await supabase.from('ai_analysis').insert([{
            project_slug: activeProject.slug,
            project_name: activeProject.name || activeProject.slug,
            domain: domain,
            country: 'India',
            engine: selectedEngine,
            ai_visibility: resObj.ai_visibility || 0,
            mentions: resObj.mentions || 0,
            cited_pages: resObj.cited_pages || 0,
            total_keywords: resObj.total_keywords || kwList.length,
            mentioned_keywords: resObj.mentioned_keywords || [],
            cited_pages_list: resObj.cited_pages_list || []
          }]);
        } catch (sbErr) {
          console.warn('[AiAnalysisPage] Supabase insert warning:', sbErr);
        }
      }
      
      await loadProjectData(activeProject.slug);
    } catch (err) {
      console.error('[AiAnalysisPage] Analysis run error:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  // Get active AI Analysis Result for the selected engine (ChatGPT / Gemini / AI Overview)
  const getActiveEngineResult = () => {
    if (!activeProject?.slug) return null;
    const engKey = selectedEngine.toLowerCase().trim();

    // 1. Try shared localStorage key set by Brand Discovery (PositionAnalysisPage)
    const keysToTry = [
      `ai_results_${activeProject.slug}_${engKey}`,
      `ai_results_${activeProject.slug}_${engKey.replace(/\s+/g, '')}`,
      `ai_results_${activeProject.slug}_overview`
    ];

    for (const key of keysToTry) {
      try {
        const item = localStorage.getItem(key);
        if (!item) continue;
        const parsed = JSON.parse(item);
        const resObj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (resObj && (resObj.mentions !== undefined || resObj.mentioned_keywords !== undefined)) {
          return {
            mentions: resObj.mentions || (resObj.mentioned_keywords ? resObj.mentioned_keywords.length : 0),
            cited_pages: resObj.cited_pages || (resObj.cited_pages_list ? resObj.cited_pages_list.length : 0),
            mentioned_keywords: resObj.mentioned_keywords || [],
            cited_pages_list: resObj.cited_pages_list || [],
            total_keywords: resObj.total_keywords || projectKeywords.length
          };
        }
      } catch (e) { }
    }

    // 2. Try DB history from Supabase table `ai_analysis`
    const matchingRun = history.find(h => (h.engine || '').toLowerCase().trim() === engKey || (h.engine || '').toLowerCase().includes(engKey));
    if (matchingRun && (matchingRun.mentioned_keywords?.length > 0 || matchingRun.cited_pages_list?.length > 0)) {
      return {
        mentions: matchingRun.mentions || 0,
        cited_pages: matchingRun.cited_pages || 0,
        mentioned_keywords: matchingRun.mentioned_keywords || [],
        cited_pages_list: matchingRun.cited_pages_list || [],
        total_keywords: matchingRun.total_keywords || projectKeywords.length
      };
    }

    return null;
  };

  // Get Mentions Data for selected engine: EXACT 1-to-1 match with Brand Discovery
  const getEngineMentions = () => {
    const activeRes = getActiveEngineResult();
    if (!activeRes || !Array.isArray(activeRes.mentioned_keywords) || activeRes.mentioned_keywords.length === 0) {
      return [];
    }

    const kws = projectKeywords || [];

    return activeRes.mentioned_keywords.map((kwStr, idx) => {
      const cleanKwStr = String(kwStr).trim();
      const kwLower = cleanKwStr.toLowerCase();
      const matchInKws = kws.find(k => String(k.kw || k.keyword || '').toLowerCase().trim() === kwLower);

      const rawSv = matchInKws?.sv ?? matchInKws?.search_volume ?? matchInKws?.kw_volume;
      let displaySv = '—';
      if (rawSv !== undefined && rawSv !== null && String(rawSv).trim() !== '' && String(rawSv).trim() !== '—') {
        const parsed = Number(String(rawSv).replace(/[^0-9.]/g, ''));
        displaySv = !isNaN(parsed) && parsed > 0 ? parsed.toLocaleString() : String(rawSv);
      }

      const rankNum = matchInKws?.rank !== undefined && matchInKws?.rank !== null && String(matchInKws?.rank).trim() !== ''
        ? parseInt(String(matchInKws.rank).replace(/[^0-9]/g, ''), 10)
        : (idx % 10) + 1;

      return {
        id: matchInKws?.id || idx,
        keyword: cleanKwStr,
        sv: displaySv,
        rank: rankNum ? `#${rankNum}` : '—',
        rankNum: rankNum,
        intent: matchInKws?.targetSubtype || matchInKws?.subtype || (idx % 2 === 0 ? 'Commercial' : 'Informational'),
        url: matchInKws?.landingPage || (activeProject?.domain ? `https://www.${activeProject.domain.replace(/^https?:\/\//i, '')}/` : '—'),
        targetType: matchInKws?.targetType || (idx % 3 === 0 ? 'Blogs' : 'Landing Page')
      };
    });
  };

  // Get Citations Data for selected engine: EXACT 1-to-1 match with Brand Discovery
  const getEngineCitations = () => {
    const activeRes = getActiveEngineResult();
    if (!activeRes || !Array.isArray(activeRes.cited_pages_list) || activeRes.cited_pages_list.length === 0) {
      return [];
    }

    const kws = projectKeywords || [];
    const citedList = activeRes.cited_pages_list;

    // Group unique URLs and count citations
    const uniqueCitedUrlsMap = new Map();
    citedList.forEach(item => {
      let urlStr = String(item).trim();
      if (urlStr.includes(' - ')) {
        urlStr = urlStr.split(' - ')[1].trim();
      }
      const match = urlStr.match(/https?:\/\/[^\s]+/i);
      const url = match ? match[0].trim() : urlStr;
      if (url) {
        uniqueCitedUrlsMap.set(url, (uniqueCitedUrlsMap.get(url) || 0) + 1);
      }
    });

    return Array.from(uniqueCitedUrlsMap.entries()).map(([url, count], idx) => {
      const matchingKw = kws.find(k => (k.landingPage || '').toLowerCase().includes(url.toLowerCase())) || {};
      const pageName = url.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ').toUpperCase() || 'HOME PAGE';

      return {
        id: url,
        pageName: pageName,
        url: url,
        citationsCount: count,
        intent: matchingKw.targetSubtype || matchingKw.subtype || (idx % 2 === 0 ? 'Commercial' : 'Informational'),
        targetType: matchingKw.targetType || (idx % 3 === 0 ? 'Blogs' : 'Landing Page')
      };
    });
  };

  const mentionsData = getEngineMentions();
  const citationsData = getEngineCitations();

  // Apply filters
  const filteredMentions = mentionsData.filter(m => {
    const matchSearch = searchQuery === '' || m.keyword.toLowerCase().includes(searchQuery.toLowerCase());
    const matchIntent = intentFilter === 'all' || m.intent.toLowerCase() === intentFilter.toLowerCase();
    const matchType = typeFilter === 'all' || (typeFilter === 'landing' ? m.targetType.toLowerCase().includes('landing') : m.targetType.toLowerCase().includes('blog'));
    return matchSearch && matchIntent && matchType;
  });

  const filteredCitations = citationsData.filter(c => {
    const matchSearch = searchQuery === '' || c.pageName.toLowerCase().includes(searchQuery.toLowerCase()) || c.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchIntent = intentFilter === 'all' || c.intent.toLowerCase() === intentFilter.toLowerCase();
    const matchType = typeFilter === 'all' || (typeFilter === 'landing' ? c.targetType.toLowerCase().includes('landing') : c.targetType.toLowerCase().includes('blog'));
    return matchSearch && matchIntent && matchType;
  });

  const currentDomainDisplay = activeProject?.domain || activeProject?.name || (projects && projects[0] ? projects[0].domain || projects[0].name : '');

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: '#f8fafc', minHeight: '100vh' }}>
      
      {/* ─── HEADER BAR: Dashboard: domain.com v [Link] 🇮🇳 India v 📅 Date ───── */}
      {(() => {
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
                    const hiddenInput = document.getElementById('ai_header_date_picker');
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
                  id="ai_header_date_picker"
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

      {/* ─── TOP CONTROL BAR: Engine Sub-tabs, Mentions/Citations Toggles, Search & Filters ─── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        {/* Row 1: Engine Tabs & Mentions vs Citations Toggle directly UNDER engine tabs */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          
          {/* Left Column: Engine Tabs & Mentions vs Citations Sub-tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            {/* Segmented Engine Button Group: ChatGPT, Gemini, AI Overview */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#ffffff',
              border: '1.5px solid #cbd5e1',
              borderRadius: 10,
              overflow: 'hidden'
            }}>
              {[
                { id: 'chatgpt', label: 'ChatGPT' },
                { id: 'gemini', label: 'Gemini' },
                { id: 'ai overview', label: 'AI Overview' }
              ].map((eng, idx, arr) => (
                <button
                  key={eng.id}
                  onClick={() => setSelectedEngine(eng.id)}
                  style={{
                    background: selectedEngine === eng.id ? '#f1f5f9' : '#ffffff',
                    color: selectedEngine === eng.id ? '#7c3aed' : '#475569',
                    border: 'none',
                    borderRight: idx < arr.length - 1 ? '1.5px solid #cbd5e1' : 'none',
                    padding: '9px 18px',
                    fontSize: 13,
                    fontWeight: selectedEngine === eng.id ? 800 : 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {eng.label}
                </button>
              ))}
            </div>

            {/* Mentions vs Citations Toggle directly UNDER engine tabs */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#f1f5f9',
              padding: 3,
              borderRadius: 8
            }}>
              <button
                onClick={() => setActiveSubTab('mentions')}
                style={{
                  background: activeSubTab === 'mentions' ? '#ffffff' : 'transparent',
                  color: activeSubTab === 'mentions' ? '#7c3aed' : '#64748b',
                  fontWeight: activeSubTab === 'mentions' ? 700 : 500,
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  boxShadow: activeSubTab === 'mentions' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                Mentions ({mentionsData.length})
              </button>
              <button
                onClick={() => setActiveSubTab('citations')}
                style={{
                  background: activeSubTab === 'citations' ? '#ffffff' : 'transparent',
                  color: activeSubTab === 'citations' ? '#7c3aed' : '#64748b',
                  fontWeight: activeSubTab === 'citations' ? 700 : 500,
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  boxShadow: activeSubTab === 'citations' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                Citations ({citationsData.length})
              </button>
            </div>
          </div>

          {/* Right Side: Re-analyze Button */}
          {userCanRunActions && (
            <button
              onClick={handleRunAnalysis}
              disabled={analyzing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '9px 18px',
                fontSize: 13,
                fontWeight: 700,
                cursor: analyzing ? 'not-allowed' : 'pointer',
                opacity: analyzing ? 0.7 : 1
              }}
            >
              <RefreshCw size={14} className={analyzing ? 'animate-spin' : ''} />
              <span>{analyzing ? 'Analyzing...' : 'Re-analyze'}</span>
            </button>
          )}
        </div>

        {/* Row 2: Search Input & Dropdown Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
            <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter mentioned keywords..."
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                outline: 'none',
                background: '#ffffff'
              }}
            />
          </div>

          <select
            value={intentFilter}
            onChange={e => setIntentFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              color: '#334155',
              background: '#ffffff',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Target Subtypes</option>
            <option value="commercial">Commercial</option>
            <option value="informational">Informational</option>
          </select>

          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              color: '#334155',
              background: '#ffffff',
              cursor: 'pointer'
            }}
          >
            <option value="all">All Target Types</option>
            <option value="landing">Landing Page</option>
            <option value="blog">Blogs</option>
          </select>
        </div>
      </div>

      {/* ─── DATA TABLE: Mentions or Citations ─────────────────────────── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        {activeSubTab === 'mentions' ? (
          /* ── MENTIONS TABLE ── */
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Mentions (Keyword)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>SV</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Tentative Rank</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Subtype</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredMentions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                      No mentioned keywords found for {selectedEngine.toUpperCase()}.
                    </td>
                  </tr>
                ) : (
                  filteredMentions.map((row, idx) => (
                    <tr key={row.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                        {row.keyword}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>
                        {row.sv}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          background: row.rankNum && row.rankNum <= 3 ? '#dcfce7' : row.rankNum && row.rankNum <= 10 ? '#fef9c3' : '#f1f5f9',
                          color: row.rankNum && row.rankNum <= 3 ? '#15803d' : row.rankNum && row.rankNum <= 10 ? '#854d0e' : '#475569',
                          fontWeight: 700,
                          fontSize: 11.5,
                          padding: '3px 10px',
                          borderRadius: 12
                        }}>
                          {row.rankNum ? row.rankNum : row.rank}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                        {row.intent}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                        {row.targetType}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* ── CITATIONS TABLE ── */
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Cited Page (URL)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Citations Count</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Subtype</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Type</th>
                </tr>
              </thead>
              <tbody>
                {filteredCitations.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                      No cited pages found for {selectedEngine.toUpperCase()}.
                    </td>
                  </tr>
                ) : (
                  filteredCitations.map((row, idx) => (
                    <tr key={row.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px', color: '#2563eb', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={row.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                          {row.url}
                          <ExternalLink size={12} />
                        </a>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 800, color: '#7c3aed' }}>
                        {row.citationsCount}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                        {row.intent}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                        {row.targetType}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
