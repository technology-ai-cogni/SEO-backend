import { useState, useEffect } from 'react';
import { Search, ChevronDown, ExternalLink, Sparkles } from 'lucide-react';
import { fetchDomainRows, fetchKeywordRows } from '../../lib/projectsApi';

export default function AiAnalysisPage() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectKeywords, setProjectKeywords] = useState([]);

  // Sub-view & Filters
  const [selectedEngine, setSelectedEngine] = useState('chatgpt'); // 'chatgpt' | 'gemini' | 'ai overview'
  const [activeSubTab, setActiveSubTab] = useState('mentions'); // 'mentions' | 'citations'
  const [searchQuery, setSearchQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState('all'); // 'all' | 'informational' | 'commercial'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'landing' | 'blog'

  // Load project list
  useEffect(() => {
    let isMounted = true;
    async function loadProjects() {
      try {
        const domains = await fetchDomainRows();
        if (isMounted && domains && domains.length > 0) {
          setProjects(domains);
          const savedSlug = localStorage.getItem('bd_selected_project');
          const target = (savedSlug && domains.find(p => p.slug === savedSlug)) || domains[0];
          setActiveProject(target);

          // Fetch keyword rows for project
          const kws = await fetchKeywordRows(target.slug);
          if (isMounted) {
            setProjectKeywords(kws || []);
          }
        }
      } catch (err) {
        console.error('[AiAnalysisPage] Error loading projects:', err);
      }
    }
    loadProjects();
    return () => { isMounted = false; };
  }, []);

  // Handle project switch
  const handleSelectProject = async (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
    try {
      const kws = await fetchKeywordRows(proj.slug);
      setProjectKeywords(kws || []);
    } catch (e) {
      console.error('Error switching project:', e);
    }
  };

  // Get Mentions Data for selected engine: ONLY keywords mentioned in Brand Discovery AI results
  const getEngineMentions = () => {
    if (!activeProject?.slug) return [];
    const kws = projectKeywords || [];

    const mentionedKwSet = new Set();
    const engKey = selectedEngine.toLowerCase();
    const candidateKeys = [
      `ai_results_${activeProject.slug}_${engKey}`,
      `ai_results_${activeProject.slug}_${selectedEngine}`,
      (engKey === 'google' || engKey === 'ai mode') ? `ai_results_${activeProject.slug}_gemini` : null,
      (engKey === 'google' || engKey === 'ai mode') ? `ai_results_${activeProject.slug}_ai overview` : null,
      `ai_results_${activeProject.slug}_overview`
    ].filter(Boolean);

    for (const key of candidateKeys) {
      try {
        const item = localStorage.getItem(key);
        if (!item) continue;
        const parsed = JSON.parse(item);
        const resObj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!resObj) continue;

        if (Array.isArray(resObj.mentioned_keywords) && resObj.mentioned_keywords.length > 0) {
          resObj.mentioned_keywords.forEach(kw => {
            if (kw) mentionedKwSet.add(String(kw).toLowerCase().trim());
          });
          break;
        }

        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleanDomain = (activeProject?.domain || activeProject?.name || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
          let foundAny = false;
          parsed.forEach(res => {
            if (res.keyword && res.results && Array.isArray(res.results)) {
              const hasMatch = res.results.some(u => cleanDomain && u.url?.toLowerCase().includes(cleanDomain));
              if (hasMatch) {
                mentionedKwSet.add(String(res.keyword).toLowerCase().trim());
                foundAny = true;
              }
            }
          });
          if (foundAny) break;
        }
      } catch (e) {
        // ignore
      }
    }

    // Filter projectKeywords to ONLY keywords that are mentioned for this engine
    let filteredKws = kws.filter(k => {
      const kwLower = String(k.kw || '').toLowerCase().trim();
      return mentionedKwSet.has(kwLower);
    });

    // Fallback: If filteredKws is empty but mentionedKwSet has items, map mentionedKwSet strings
    if (filteredKws.length === 0 && mentionedKwSet.size > 0) {
      filteredKws = Array.from(mentionedKwSet).map(kwStr => {
        const matchInKws = kws.find(k => String(k.kw || '').toLowerCase().trim() === kwStr);
        return matchInKws || { kw: kwStr };
      });
    }

    // STRICT DEDUPLICATION: Ensure no duplicate keyword rows exist
    const seenKwSet = new Set();
    const uniqueFilteredKws = [];
    filteredKws.forEach(k => {
      const kwLower = String(k.kw || '').toLowerCase().trim();
      if (kwLower && !seenKwSet.has(kwLower)) {
        seenKwSet.add(kwLower);
        uniqueFilteredKws.push(k);
      }
    });
    filteredKws = uniqueFilteredKws;

    return filteredKws.map(k => {
      const kwLower = String(k.kw || '').toLowerCase().trim();

      // Real SV from intent database row
      const rawSv = k.sv ?? k.search_volume ?? k.kw_volume ?? k.volume ?? k['search volume'] ?? k['KW Volume'];
      let displaySv = '—';
      if (rawSv !== undefined && rawSv !== null && String(rawSv).trim() !== '' && String(rawSv).trim() !== '—') {
        const parsed = Number(String(rawSv).replace(/[^0-9.]/g, ''));
        displaySv = !isNaN(parsed) && parsed > 0 ? parsed.toLocaleString() : String(rawSv);
      }

      // Real rank from intent
      const rankNum = k.rank !== undefined && k.rank !== null && String(k.rank).trim() !== '' ? parseInt(String(k.rank).replace(/[^0-9]/g, ''), 10) : null;
      const displayRank = rankNum !== null && !isNaN(rankNum) ? `${rankNum}` : (k.rank ? String(k.rank).replace(/^#/, '') : '—');

      const subtype = k.targetSubtype || k.subtype || 'Informational';
      const targetType = k.targetType || 'Landing Page';
      const landingUrl = k.landingPage || (activeProject?.domain ? `https://www.${activeProject.domain.replace(/^https?:\/\//i, '')}/` : '—');

      return {
        id: k.id || kwLower,
        keyword: k.kw || 'Keyword',
        sv: displaySv,
        rank: displayRank,
        rankNum: rankNum,
        intent: subtype,
        url: landingUrl,
        targetType: targetType,
      };
    });
  };

  // Get Citations Data for selected engine: ONLY pages cited in Brand Discovery AI results
  const getEngineCitations = () => {
    if (!activeProject?.slug) return [];
    const kws = projectKeywords || [];

    const citedPageSet = new Set();
    const engKey = selectedEngine.toLowerCase();
    const candidateKeys = [
      `ai_results_${activeProject.slug}_${engKey}`,
      `ai_results_${activeProject.slug}_${selectedEngine}`,
      (engKey === 'google' || engKey === 'ai mode') ? `ai_results_${activeProject.slug}_gemini` : null,
      (engKey === 'google' || engKey === 'ai mode') ? `ai_results_${activeProject.slug}_ai overview` : null,
      `ai_results_${activeProject.slug}_overview`
    ].filter(Boolean);

    for (const key of candidateKeys) {
      try {
        const item = localStorage.getItem(key);
        if (!item) continue;
        const parsed = JSON.parse(item);
        const resObj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!resObj) continue;

        if (Array.isArray(resObj.cited_pages_list) && resObj.cited_pages_list.length > 0) {
          resObj.cited_pages_list.forEach(c => {
            if (c) {
              const parts = String(c).split(' - ');
              const urlStr = parts.length > 1 ? parts[1].trim() : String(c).trim();
              citedPageSet.add(urlStr);
            }
          });
          break;
        }

        if (Array.isArray(parsed) && parsed.length > 0) {
          const cleanDomain = (activeProject?.domain || activeProject?.name || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
          let foundAny = false;
          parsed.forEach(res => {
            if (res.results && Array.isArray(res.results)) {
              res.results.forEach(u => {
                if (cleanDomain && u.url?.toLowerCase().includes(cleanDomain)) {
                  citedPageSet.add(u.url.trim());
                  foundAny = true;
                }
              });
            }
          });
          if (foundAny) break;
        }
      } catch (e) {
        // ignore
      }
    }

    const citationsList = [];
    citedPageSet.forEach(url => {
      const cleanTargetSlug = url.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '').toLowerCase();

      // Match against intent keyword rows
      const matchingKws = kws.filter(k => {
        const kUrl = String(k.landingPage || k.url || k.page_url || k.landing_page || k.page || k.landing || '').toLowerCase();
        if (!kUrl) return false;
        if (kUrl.includes(url.toLowerCase()) || url.toLowerCase().includes(kUrl)) return true;
        const kSlug = kUrl.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '').toLowerCase();
        return cleanTargetSlug && kSlug && (cleanTargetSlug.includes(kSlug) || kSlug.includes(cleanTargetSlug));
      });

      const matchKw = matchingKws[0] || kws.find(k => (k.landingPage || k.url || k.page_url || '').toLowerCase().includes(url.toLowerCase())) || {};
      const pageName = url.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ').toUpperCase() || 'Cited Page';

      // Extract distinct category and cluster from intent DB rows
      const categoryVal = matchingKws.map(k => 
        k.category || k.Category || k.category_name || k.cat || k['category.cluster']?.split('/')[0]
      ).find(Boolean) || matchKw.category || 'General';

      const clusterVal = matchingKws.map(k => 
        k.cluster || k.Cluster || k.cluster_name || k.group || k['category.cluster']?.split('/')[1]
      ).find(Boolean) || matchKw.cluster || 'General';

      const subtype = matchKw.targetSubtype || matchKw.subtype || matchKw.intent || 'Informational';
      const targetType = matchKw.targetType || matchKw.page_type || 'Landing Page';

      const totalKws = matchingKws.length || 1;

      citationsList.push({
        id: url,
        pageName: pageName,
        url: url,
        totalKws: totalKws,
        category: categoryVal,
        cluster: clusterVal,
        intent: subtype,
        targetType: targetType
      });
    });

    // STRICT DEDUPLICATION: Ensure no duplicate URL rows exist
    const seenUrlSet = new Set();
    const uniqueCitationsList = [];
    citationsList.forEach(c => {
      const cleanUrl = String(c.url || '').toLowerCase().trim().replace(/\/$/, '');
      if (cleanUrl && !seenUrlSet.has(cleanUrl)) {
        seenUrlSet.add(cleanUrl);
        uniqueCitationsList.push(c);
      }
    });

    // Sort in decreasing order of Total KWs by default
    uniqueCitationsList.sort((a, b) => b.totalKws - a.totalKws);

    return uniqueCitationsList;
  };

  const mentionsData = getEngineMentions();
  const citationsData = getEngineCitations();

  // Apply search and dropdown filters
  const filteredMentions = mentionsData.filter(m => {
    const matchSearch = searchQuery === '' || m.keyword.toLowerCase().includes(searchQuery.toLowerCase()) || m.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchIntent = intentFilter === 'all' || m.intent.toLowerCase() === intentFilter.toLowerCase();
    const matchType = typeFilter === 'all' || (typeFilter === 'landing' ? m.targetType.toLowerCase().includes('landing') : m.targetType.toLowerCase().includes('blog'));
    return matchSearch && matchIntent && matchType;
  });

  const filteredCitations = citationsData.filter(c => {
    const matchSearch = searchQuery === '' || c.pageName.toLowerCase().includes(searchQuery.toLowerCase()) || c.url.toLowerCase().includes(searchQuery.toLowerCase()) || c.category.toLowerCase().includes(searchQuery.toLowerCase()) || c.cluster.toLowerCase().includes(searchQuery.toLowerCase());
    const matchIntent = intentFilter === 'all' || c.intent.toLowerCase() === intentFilter.toLowerCase();
    const matchType = typeFilter === 'all' || (typeFilter === 'landing' ? c.targetType.toLowerCase().includes('landing') : c.targetType.toLowerCase().includes('blog'));
    return matchSearch && matchIntent && matchType;
  });

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: '#f8fafc', minHeight: '100vh' }}>
      
      {/* ─── HEADER BAR: Title & Project Switcher ─────────────────────────────── */}
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
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={20} color="#7c3aed" />
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>AI Analysis</h1>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0 0' }}>
            Mentions & Citation analytics across AI Search Engines for {activeProject?.domain || activeProject?.name || 'Selected Domain'}
          </p>
        </div>

        {/* Project Selector Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setProjectMenuOpen(!projectMenuOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 700,
              color: '#0f172a',
              cursor: 'pointer'
            }}
          >
            <span>Domain: <strong>{activeProject?.domain || activeProject?.name || 'Select Domain'}</strong></span>
            <ChevronDown size={14} />
          </button>

          {projectMenuOpen && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: '110%',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
              zIndex: 100,
              minWidth: 200,
              overflow: 'hidden'
            }}>
              {projects.map(p => (
                <div
                  key={p.slug}
                  onClick={() => handleSelectProject(p)}
                  style={{
                    padding: '10px 14px',
                    fontSize: 13,
                    fontWeight: activeProject?.slug === p.slug ? 700 : 500,
                    color: activeProject?.slug === p.slug ? '#7c3aed' : '#334155',
                    background: activeProject?.slug === p.slug ? '#f5f3ff' : 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  {p.domain || p.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── TOP CONTROL BAR: Engine Tabs, Sub-tab Switcher & Filter Controls ─── */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16
      }}>
        {/* Engine Tabs: ChatGPT, Gemini, AI Overview (NO All Engines) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* Segmented Engine Button Group matching user design */}
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
                  color: selectedEngine === eng.id ? '#0f172a' : '#475569',
                  border: 'none',
                  borderRight: idx < arr.length - 1 ? '1.5px solid #cbd5e1' : 'none',
                  padding: '9px 18px',
                  fontSize: 13,
                  fontWeight: selectedEngine === eng.id ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                {eng.label}
              </button>
            ))}
          </div>

          {/* Sub-view Switcher: Mentions vs Citations */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: 3, borderRadius: 8, gap: 2 }}>
            <button
              onClick={() => setActiveSubTab('mentions')}
              style={{
                background: activeSubTab === 'mentions' ? '#ffffff' : 'transparent',
                color: activeSubTab === 'mentions' ? '#7c3aed' : '#64748b',
                boxShadow: activeSubTab === 'mentions' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                border: 'none',
                borderRadius: 6,
                padding: '6px 18px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Mentions ({mentionsData.length})
            </button>
            <button
              onClick={() => setActiveSubTab('citations')}
              style={{
                background: activeSubTab === 'citations' ? '#ffffff' : 'transparent',
                color: activeSubTab === 'citations' ? '#7c3aed' : '#64748b',
                boxShadow: activeSubTab === 'citations' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                border: 'none',
                borderRadius: 6,
                padding: '6px 18px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Citations ({citationsData.length})
            </button>
          </div>
        </div>

        {/* Filter Controls: Search & Intent & Type */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Search Box */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
            <input
              type="text"
              placeholder={activeSubTab === 'mentions' ? "Filter mentioned keywords..." : "Filter cited pages or URLs..."}
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

          {/* Intent Filter */}
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
            <option value="all">All Intent (Info / Comm)</option>
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
            <option value="all">All Types (Landing / Blog)</option>
            <option value="landing">Landing Page</option>
            <option value="blog">Blog Page</option>
          </select>
        </div>

      </div>

      {/* ─── DATA TABLE: Mentions or Citations ───────────────────────────────── */}
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
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Position (Rank)</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Info / Comm</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Page URL</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Landing / Blog</th>
                </tr>
              </thead>
              <tbody>
                {filteredMentions.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                      No mentioned keywords found for {selectedEngine.toUpperCase()}.
                    </td>
                  </tr>
                ) : (
                  filteredMentions.map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
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
                          padding: '2px 8px',
                          borderRadius: 12
                        }}>
                          {row.rank}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                        {row.intent}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#2563eb', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={row.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {row.url}
                          <ExternalLink size={11} />
                        </a>
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
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Page Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>URL</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Total KWs</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Category</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Cluster</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Info / Comm</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Landing / Blog</th>
                </tr>
              </thead>
              <tbody>
                {filteredCitations.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                      No cited pages found for {selectedEngine.toUpperCase()}.
                    </td>
                  </tr>
                ) : (
                  filteredCitations.map(row => (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.pageName}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#2563eb', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={row.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {row.url}
                          <ExternalLink size={11} />
                        </a>
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a' }}>
                        {row.totalKws}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>
                        {row.category}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>
                        {row.cluster}
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
