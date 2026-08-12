import { useState, useEffect } from 'react';
import { Search, ChevronDown, ExternalLink, FileText } from 'lucide-react';
import { fetchDomainRows, fetchPageRows, fetchKeywordRows } from '../../lib/projectsApi';

export default function TopPagesPage() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [pagesData, setPagesData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState('all'); // 'all' | 'informational' | 'commercial'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'landing' | 'blog'

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
          totalKws: kwList.length
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

  // Calculate Average Position across tracked page keywords
  const allRanks = pagesData.flatMap(p => p.ranks || []).filter(r => typeof r === 'number' && r > 0);
  const avgPosition = allRanks.length > 0 
    ? (allRanks.reduce((acc, r) => acc + r, 0) / allRanks.length).toFixed(1) 
    : 0;

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: '#f8fafc', minHeight: '100vh' }}>
      
      {/* ─── HEADER BAR: Title & Domain Selector ─────────────────────────────── */}
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
            <FileText size={20} color="#7c3aed" />
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>Top Pages</h1>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0 0' }}>
            Pages tracked under Project Setup for {activeProject?.domain || activeProject?.name || 'Selected Domain'}
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

      {/* ─── SUMMARY CARDS ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        
        {/* CARD 1: Avg. Traffic */}
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
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Avg. Traffic</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>0</div>
        </div>

        {/* CARD 2: Top Pages in Top 1, Top 3, Top 10 (Column / Row-wise Layout) */}
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
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 1</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>0</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 3</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>0</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e2e8f0', paddingLeft: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Top 10</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>0</span>
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
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Page Name</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>URL</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Traffic</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Category</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Cluster</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Type</th>
                <th style={{ padding: '12px 16px', fontWeight: 700 }}>Target Subtype</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    Loading pages for {activeProject?.domain || activeProject?.name}...
                  </td>
                </tr>
              ) : filteredPages.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
                    No pages found under Project Setup for {activeProject?.domain || activeProject?.name}.
                  </td>
                </tr>
              ) : (
                filteredPages.map(row => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    
                    {/* PAGE NAME */}
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: '#0f172a', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.pageName}
                    </td>

                    {/* URL */}
                    <td style={{ padding: '12px 16px', color: '#2563eb', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={row.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {row.url}
                        <ExternalLink size={11} />
                      </a>
                    </td>

                    {/* TRAFFIC */}
                    <td style={{ padding: '12px 16px', color: '#64748b', fontWeight: 600 }}>
                      Null
                    </td>

                    {/* CATEGORY */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                      <span style={{ background: '#f1f5f9', color: '#334155', fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 6 }}>
                        {row.category}
                      </span>
                    </td>

                    {/* CLUSTER */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                      <span style={{ background: '#f5f3ff', color: '#7c3aed', fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 6 }}>
                        {row.cluster}
                      </span>
                    </td>

                    {/* TARGET TYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                      {row.targetCategory}
                    </td>

                    {/* TARGET SUBTYPE */}
                    <td style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 600 }}>
                      {row.targetType}
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
