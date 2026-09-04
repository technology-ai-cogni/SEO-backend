import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bookmark,
  Clock,
  CheckCircle2,
  Search,
  FolderOpen,
  ChevronDown,
  Plus,
  FileSpreadsheet,
  Edit3,
  Trash2,
  X,
  Sparkles,
  Download,
  Check
} from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  fetchDomainRows,
  listCalendarActivitiesApi,
  createCalendarActivityApi,
  updateCalendarActivityApi,
  deleteCalendarActivityApi,
  fetchCalendarPotentialKeywordsApi,
  analyzeCalendarAiPushPotentialApi
} from '../../lib/projectsApi';
import BrandInfinityLoader from '../common/BrandInfinityLoader';

// Custom single-select whose option list always opens BELOW the control
// (native <select> on macOS pops over elements above it).
function PlainSelect({ value, onChange, options, placeholder = 'Select...', required }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const norm = (options || []).map(o => (o && typeof o === 'object') ? o : { value: o, label: o });
  const current = norm.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1',
          borderRadius: 8, outline: 'none', background: '#ffffff',
          color: current ? '#0f172a' : '#94a3b8', fontWeight: 600, textAlign: 'left',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown size={15} color="#64748b" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 8,
          boxShadow: '0 10px 24px rgba(0,0,0,0.14)', zIndex: 1100, maxHeight: 220, overflowY: 'auto', padding: 4
        }}>
          {norm.map(o => {
            const sel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 12.5,
                  border: 'none', background: sel ? '#f5f3ff' : 'transparent',
                  color: sel ? '#7c3aed' : '#0f172a', fontWeight: sel ? 700 : 500,
                  borderRadius: 6, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {required && (
        <input tabIndex={-1} aria-hidden required value={value || ''} onChange={() => {}}
          style={{ position: 'absolute', bottom: 0, left: 12, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      )}
    </div>
  );
}

// ─── PUSH-POTENTIAL BATCHING ───
// Batch 1 (high): Live rank extremely improved vs keywords_categories + Top 3 SERP are Landing Pages
// Batch 2 (medium): Live rank extremely dropped vs keywords_categories + Top 3 SERP are Landing Pages (Recovery target)
// Batch 3 (low): Rank didn't even move OR Top 3 SERP shifted away from Landing Pages
const PUSH_BATCH_META = {
  high: {
    key: 'high',
    order: 1,
    label: 'Batch 1 · Extremely Improved',
    tint: '#16a34a',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    Icon: TrendingUp,
    hint: 'Live rank surged vs previous keywords_categories rank & Top 3 Google SERP are Landing Pages'
  },
  medium: {
    key: 'medium',
    order: 2,
    label: 'Batch 2 · Extremely Dropped',
    tint: '#d97706',
    bg: '#fffbeb',
    border: '#fde68a',
    Icon: TrendingDown,
    hint: 'Live rank dropped vs keywords_categories & Top 3 Google SERP are Landing Pages (Prime recovery targets)'
  },
  low: {
    key: 'low',
    order: 3,
    label: 'Batch 3 · Didn’t Move / Stagnant',
    tint: '#64748b',
    bg: '#f8fafc',
    border: '#cbd5e1',
    Icon: Minus,
    hint: 'Rank didn’t even move or Top 3 Google SERP shifted away from Landing Pages'
  },
};

function CalendarPage({ user }) {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  // 3 Sub-tabs: 'saved' | 'scheduled' | 'approved'
  const [activeSubTab, setActiveSubTab] = useState('saved');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Live Supabase / Backend off_page_activities data
  const [activities, setActivities] = useState([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [aiSchedulingEnabled, setAiSchedulingEnabled] = useState(true);
  const [modalStep, setModalStep] = useState('form'); // 'form' | 'keywords_prompt'
  const [createdActivity, setCreatedActivity] = useState(null);
  const [savingActivity, setSavingActivity] = useState(false);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [modalKeywords, setModalKeywords] = useState([]);
  const [potentialKws, setPotentialKws] = useState([]);
  const [pushBatches, setPushBatches] = useState({ high: [], medium: [], low: [] });
  const [analyzingPotential, setAnalyzingPotential] = useState(false);
  const [selectedKwIds, setSelectedKwIds] = useState(new Set());
  const [topicLinks, setTopicLinks] = useState({});
  const [formData, setFormData] = useState({
    activity_name: '',
    project_name: '',
    main_poc: '',
    content_poc: '',
    quantity: 1,
    budget: '',
    user: user?.name || user?.email || '',
    period: new Date().toISOString().split('T')[0],
    scheduler: '',
    auditor: '',
    status: 'saved'
  });

  // Load Off-Page Activities + Projects from Supabase.
  // The activities table is the actual page content, so unblock the UI as soon
  // as that returns. The project list only feeds the selector dropdown / filter,
  // and fetchDomainRows() runs a slow full-table keyword-count scan, so it's
  // loaded in the background instead of holding up the whole page.
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await listCalendarActivitiesApi().catch(() => ({ activities: [] }));
      setActivities(res.activities || []);
    } catch (err) {
      console.error('[CalendarPage] Error loading activities:', err);
    } finally {
      setLoading(false);
    }

    try {
      const projs = await fetchDomainRows().catch(() => []);
      setProjects(projs || []);
      if (projs && projs.length > 0) {
        const savedSlug = localStorage.getItem('bd_selected_project');
        const matched = projs.find(p => p.slug === savedSlug) || projs[0];
        setActiveProject(matched);
      }
    } catch (err) {
      console.error('[CalendarPage] Error loading projects:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectProject = (proj) => {
    setActiveProject(proj);
    localStorage.setItem('bd_selected_project', proj.slug);
    setProjectMenuOpen(false);
  };

  // Normalize status helper: 'saved' | 'scheduled' | 'approved'
  const getNormalizedStatus = (itemStatus) => {
    if (!itemStatus) return 'saved';
    const s = String(itemStatus).toLowerCase().trim();
    if (s.includes('sched') || s.includes('pending')) return 'scheduled';
    if (s.includes('appr') || s.includes('comp') || s.includes('done')) return 'approved';
    return 'saved';
  };

  // Filter activities by active project, active sub-tab, and search query
  const filteredActivities = useMemo(() => {
    return activities.filter(item => {
      // 1. Sub-tab status match
      const normStatus = getNormalizedStatus(item.status);
      if (normStatus !== activeSubTab) return false;

      // 2. Project match (if activeProject selected and item has project_name)
      if (activeProject && item.project_name && item.project_name !== 'General') {
        const itemProj = String(item.project_name).toLowerCase().trim();
        const curProjName = String(activeProject.name || activeProject.domain || '').toLowerCase().trim();
        const curProjSlug = String(activeProject.slug || '').toLowerCase().trim();
        if (itemProj && !curProjName.includes(itemProj) && !curProjSlug.includes(itemProj) && !itemProj.includes(curProjName)) {
          // Keep item if it matches search or general
        }
      }

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = String(item.activity_name || '').toLowerCase().includes(q);
        const matchesProj = String(item.project_name || '').toLowerCase().includes(q);
        const matchesPoc = String(item.main_poc || '').toLowerCase().includes(q) || String(item.content_poc || '').toLowerCase().includes(q);
        const matchesUser = String(item.user || '').toLowerCase().includes(q);
        if (!matchesName && !matchesProj && !matchesPoc && !matchesUser) return false;
      }

      return true;
    });
  }, [activities, activeSubTab, activeProject, searchQuery]);

  // Counts by tab
  const counts = useMemo(() => {
    return {
      saved: activities.filter(a => getNormalizedStatus(a.status) === 'saved').length,
      scheduled: activities.filter(a => getNormalizedStatus(a.status) === 'scheduled').length,
      approved: activities.filter(a => getNormalizedStatus(a.status) === 'approved').length
    };
  }, [activities]);

  // Form Handlers
  const handleOpenAddModal = (defaultStatus = activeSubTab) => {
    setEditingItem(null);
    setModalStep('form');
    setAiSchedulingEnabled(true);
    setSavingActivity(false);
    setLoadingKeywords(false);
    setAnalyzingPotential(false);
    setPushBatches({ high: [], medium: [], low: [] });
    setPotentialKws([]);
    setSelectedKwIds(new Set());
    setTopicLinks({});
    setCreatedActivity(null);
    setFormData({
      activity_name: 'Paid Guest Post',
      project_name: activeProject?.name || activeProject?.domain || (projects[0]?.name || projects[0]?.domain || ''),
      main_poc: '',
      content_poc: '',
      quantity: 1,
      budget: '$250',
      user: user?.name || user?.email || 'Admin User',
      period: new Date().toISOString().split('T')[0],
      scheduler: 'AI Auto-Scheduler',
      auditor: 'SEO Audit Team',
      status: defaultStatus
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item) => {
    setEditingItem(item);
    setModalStep('form');
    const isAi = String(item.scheduler || '').toLowerCase().includes('ai');
    setAiSchedulingEnabled(isAi);
    setSavingActivity(false);
    setCreatedActivity(null);
    setFormData({
      activity_name: item.activity_name || '',
      project_name: item.project_name || '',
      main_poc: item.main_poc || '',
      content_poc: item.content_poc || '',
      quantity: item.quantity || 1,
      budget: item.budget || '',
      user: item.user || user?.name || user?.email || '',
      period: item.period || new Date().toISOString().split('T')[0],
      scheduler: item.scheduler || (isAi ? 'AI Auto-Scheduler' : 'Manual'),
      auditor: item.auditor || '',
      status: getNormalizedStatus(item.status)
    });
    setIsModalOpen(true);
  };

  const handleToggleAiScheduling = () => {
    setAiSchedulingEnabled(prev => {
      const next = !prev;
      setFormData(fd => ({
        ...fd,
        scheduler: next ? 'AI Auto-Scheduler' : 'Manual'
      }));
      return next;
    });
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    if (!formData.project_name || !formData.activity_name) {
      alert('Please fill in required fields: Project Name and Activity Name');
      return;
    }

    setSavingActivity(true);
    try {
      const payload = {
        ...formData,
        quantity: parseInt(formData.quantity, 10) || 1
      };

      if (editingItem) {
        await updateCalendarActivityApi(editingItem.id, payload);
        setActivities(prev => prev.map(a => a.id === editingItem.id ? { ...a, ...payload } : a));
        setIsModalOpen(false);
        setSavingActivity(false);
        return;
      }

      // Create new activity
      const created = await createCalendarActivityApi(payload);
      setActivities(prev => [created, ...prev]);

      if (!aiSchedulingEnabled) {
        // Toggle is off -> close immediately
        setIsModalOpen(false);
        setSavingActivity(false);
        return;
      }

      // Toggle is ON -> switch to Step 2: "These are the keywords we got, do you want to add?"
      setCreatedActivity(created);
      setModalStep('keywords_prompt');
      setSavingActivity(false);
      setLoadingKeywords(true);

      const matchedProj = projects.find(p => (p.name || p.domain) === formData.project_name);
      const slug = matchedProj?.slug || formData.project_name.toLowerCase().replace(/\s+/g, '');
      const domain = matchedProj?.domain || '';

      try {
        const res = await fetchCalendarPotentialKeywordsApi(slug, domain, false);
        const kws = res.potential_keywords || [];
        const batches = res.batches || { high: [], medium: [], low: [] };
        setPotentialKws(kws);
        setPushBatches(batches);

        // Pre-fill topic links from candidate landing_page_url or topicLink
        const initialTopicLinks = {};
        kws.forEach(k => {
          if (k.topicLink || k.landing_page_url) {
            initialTopicLinks[k.id] = k.topicLink || k.landing_page_url;
          }
        });
        setTopicLinks(initialTopicLinks);

        // Auto-select batch 1 and batch 2 initially
        const initialSelected = new Set([
          ...(batches.high || []).map(k => k.id),
          ...(batches.medium || []).map(k => k.id)
        ]);
        setSelectedKwIds(initialSelected);
        setLoadingKeywords(false);

        if (kws.length > 0) {
          setAnalyzingPotential(true);
          analyzeCalendarAiPushPotentialApi(slug, domain, kws, 'India')
            .then(aiRes => {
              if (aiRes?.batches) {
                setPushBatches(aiRes.batches);
                if (aiRes.evaluated_keywords && aiRes.evaluated_keywords.length > 0) {
                  setPotentialKws(aiRes.evaluated_keywords);
                  setTopicLinks(prev => {
                    const next = { ...prev };
                    aiRes.evaluated_keywords.forEach(ek => {
                      if (!next[ek.id] && (ek.topicLink || ek.landing_page_url)) {
                        next[ek.id] = ek.topicLink || ek.landing_page_url;
                      }
                    });
                    return next;
                  });
                }
                // Consider and auto-select Batch 1 & Batch 2 keywords
                const b1and2 = [
                  ...(aiRes.batches.high || []).map(k => k.id),
                  ...(aiRes.batches.medium || []).map(k => k.id)
                ];
                setSelectedKwIds(new Set(b1and2));
              }
            })
            .catch(err => console.warn('[CalendarPage] Live rank check notice:', err))
            .finally(() => setAnalyzingPotential(false));
        }
      } catch (err) {
        console.error('[CalendarPage] Error loading potential keywords:', err);
        setLoadingKeywords(false);
      }
    } catch (err) {
      alert(`Error saving activity: ${err.message}`);
      setSavingActivity(false);
    }
  };

  const handleConfirmAddKeywords = async () => {
    if (!createdActivity) {
      setIsModalOpen(false);
      return;
    }
    setSavingActivity(true);
    try {
      const isPaidGuestPost = String(createdActivity?.activity_name || formData.activity_name || '').toLowerCase().includes('guest');
      const batchById = new Map();
      ['high', 'medium', 'low'].forEach(b => (pushBatches[b] || []).forEach(r => batchById.set(r.id, r)));
      const selectedPotential = potentialKws.filter(k => selectedKwIds.has(k.id)).map(k => {
        const info = batchById.get(k.id) || {};
        return {
          keyword: k.keyword,
          category: k.category,
          cluster: k.cluster,
          rank: k.new_rank || k.rank,
          prev_rank: k.prev_rank || k.rank,
          new_rank: k.new_rank || k.rank,
          delta: k.delta || 0,
          sv: k.sv,
          kd: k.kd,
          target_type: k.target_type || 'Landing Page',
          top3_is_landing: k.top3_is_landing ?? info.top3_is_landing ?? true,
          push_batch: info.batch || null,
          push_confidence: info.confidence ?? null,
          push_reason: info.reason || '',
          topic_link: isPaidGuestPost ? '' : (topicLinks[k.id] || k.topicLink || k.landing_page_url || '')
        };
      });

      const updatePayload = {
        potential_keywords: selectedPotential
      };
      if (selectedPotential.length > 0) {
        updatePayload.keyword_name = selectedPotential.map(k => k.keyword).join(', ');
        updatePayload.category = selectedPotential[0].category;
        updatePayload.cluster = selectedPotential[0].cluster;
        if (!isPaidGuestPost) {
          updatePayload.topic_link = selectedPotential.map(k => k.topic_link).filter(Boolean).join(' | ');
        } else {
          updatePayload.topic_link = '';
        }
      }

      await updateCalendarActivityApi(createdActivity.id, updatePayload);
      setActivities(prev => prev.map(a => a.id === createdActivity.id ? { ...a, ...updatePayload } : a));
      setIsModalOpen(false);
    } catch (err) {
      alert(`Error adding keywords: ${err.message}`);
    } finally {
      setSavingActivity(false);
    }
  };

  const handleMoveStatus = async (item, newStatus) => {
    try {
      await updateCalendarActivityApi(item.id, { status: newStatus });
      setActivities(prev => prev.map(a => a.id === item.id ? { ...a, status: newStatus } : a));
    } catch (err) {
      console.error('[CalendarPage] Error moving status:', err);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.activity_name}"?`)) return;
    try {
      await deleteCalendarActivityApi(item.id);
      setActivities(prev => prev.filter(a => a.id !== item.id));
    } catch (err) {
      alert(`Error deleting item: ${err.message}`);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (filteredActivities.length === 0) {
      alert('No data available to export.');
      return;
    }
    const headers = ['Activity Name', 'Project Name', 'Main POC', 'Content POC', 'Quantity', 'Budget', 'User', 'Period', 'Scheduler', 'Auditor', 'Status'];
    const rows = filteredActivities.map(a => [
      `"${(a.activity_name || '').replace(/"/g, '""')}"`,
      `"${(a.project_name || '').replace(/"/g, '""')}"`,
      `"${(a.main_poc || '').replace(/"/g, '""')}"`,
      `"${(a.content_poc || '').replace(/"/g, '""')}"`,
      a.quantity || 1,
      `"${String(a.budget || '').replace(/"/g, '""')}"`,
      `"${(a.user || '').replace(/"/g, '""')}"`,
      `"${a.period || ''}"`,
      `"${(a.scheduler || '').replace(/"/g, '""')}"`,
      `"${(a.auditor || '').replace(/"/g, '""')}"`,
      `"${getNormalizedStatus(a.status).toUpperCase()}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Off_Page_Activities_${activeSubTab}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '24px 32px', minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1A1A1A', margin: 0, letterSpacing: '-0.5px' }}>
              Calendar
            </h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>          </p>
        </div>

        {/* Right Header Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => handleOpenAddModal(activeSubTab)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 700,
              color: '#ffffff',
              background: '#2D2D44',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1F1F30'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2D2D44'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <Sparkles size={16} />
            <span>Choose Project</span>
          </button>

          <button
            onClick={handleExportCSV}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#334155',
              background: '#ffffff',
              border: '1px solid #E4DFEE',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(74, 26, 140, 0.04)'
            }}
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>

          {/* Project Selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#ffffff',
                border: '1px solid #E4DFEE',
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#1A1A1A',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(74, 26, 140, 0.04)'
              }}
            >
              <FolderOpen size={16} color="var(--accent)" />
              <span>{activeProject?.name || activeProject?.domain || 'All Projects'}</span>
              <ChevronDown size={14} color="#64748b" />
            </button>

            {projectMenuOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 6,
                width: 220,
                background: '#ffffff',
                border: '1px solid #E4DFEE',
                borderRadius: 10,
                boxShadow: '0 10px 25px -5px rgba(74, 26, 140, 0.12)',
                zIndex: 50,
                overflow: 'hidden'
              }}>
                {projects.map(p => (
                  <button
                    key={p.slug}
                    onClick={() => handleSelectProject(p)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none',
                      background: activeProject?.slug === p.slug ? '#F6EEFD' : 'transparent',
                      fontSize: 13,
                      fontWeight: activeProject?.slug === p.slug ? 700 : 500,
                      color: activeProject?.slug === p.slug ? '#7B2FBE' : '#334155',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.domain}</span>
                    {activeProject?.slug === p.slug && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7B2FBE' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Sub-Tab Bar Container */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #E4DFEE',
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          {/* Sub-Tabs: Saved | Scheduled | Approved */}
          <div style={{ display: 'flex', gap: 8, background: '#F4F1FA', padding: 4, borderRadius: 10 }}>
            {/* 1. Saved Tab */}
            <button
              onClick={() => setActiveSubTab('saved')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'saved' ? '1px solid #E5CCF7' : '1px solid transparent',
                background: activeSubTab === 'saved' ? 'linear-gradient(135deg, #F6EEFD 0%, #FDEBF4 100%)' : 'transparent',
                color: activeSubTab === 'saved' ? '#7B2FBE' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'saved' ? 800 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'saved' ? '0 1px 3px rgba(74, 26, 140, 0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Bookmark size={15} color={activeSubTab === 'saved' ? '#7B2FBE' : '#64748b'} />
              <span>Saved</span>
              <span style={{
                background: activeSubTab === 'saved' ? '#E5CCF7' : '#E2DBEC',
                color: activeSubTab === 'saved' ? '#4A1A8C' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.saved}
              </span>
            </button>

            {/* 2. Scheduled Tab */}
            <button
              onClick={() => setActiveSubTab('scheduled')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'scheduled' ? '1px solid #FED7AA' : '1px solid transparent',
                background: activeSubTab === 'scheduled' ? 'linear-gradient(135deg, #FFF7ED 0%, #FEF3C7 100%)' : 'transparent',
                color: activeSubTab === 'scheduled' ? '#D97706' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'scheduled' ? 800 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'scheduled' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Clock size={15} color={activeSubTab === 'scheduled' ? '#d97706' : '#64748b'} />
              <span>Scheduled</span>
              <span style={{
                background: activeSubTab === 'scheduled' ? '#fef3c7' : '#E2DBEC',
                color: activeSubTab === 'scheduled' ? '#b45309' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.scheduled}
              </span>
            </button>

            {/* 3. Approved Tab */}
            <button
              onClick={() => setActiveSubTab('approved')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: activeSubTab === 'approved' ? '1px solid #A7F3D0' : '1px solid transparent',
                background: activeSubTab === 'approved' ? 'linear-gradient(135deg, #ECFDF5 0%, #E6FAF6 100%)' : 'transparent',
                color: activeSubTab === 'approved' ? '#008F7A' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'approved' ? 800 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'approved' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <CheckCircle2 size={15} color={activeSubTab === 'approved' ? '#008F7A' : '#64748b'} />
              <span>Approved</span>
              <span style={{
                background: activeSubTab === 'approved' ? '#d1fae5' : '#E2DBEC',
                color: activeSubTab === 'approved' ? '#047857' : '#475569',
                fontSize: 11,
                fontWeight: 800,
                padding: '1px 7px',
                borderRadius: 10
              }}>
                {counts.approved}
              </span>
            </button>
          </div>

          {/* Search & Utility Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder={`Search ${activeSubTab} activities...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  paddingLeft: 34,
                  paddingRight: 14,
                  paddingTop: 8,
                  paddingBottom: 8,
                  fontSize: 13,
                  border: '1px solid #E4DFEE',
                  borderRadius: 8,
                  outline: 'none',
                  width: 240,
                  background: '#ffffff'
                }}
              />
            </div>

            <button
              onClick={() => handleOpenAddModal(activeSubTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#2D2D44',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(45, 45, 68, 0.25)',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1F1F30'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#2D2D44'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <Plus size={15} />
              <span>New Entry</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content Table Container - ALWAYS RENDERS TABLE HEADERS REGARDLESS OF EMPTY OR NOT */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #E4DFEE',
        overflow: 'hidden',
        boxShadow: '0 4px 20px -2px rgba(74, 26, 140, 0.06), 0 2px 6px -1px rgba(45, 45, 68, 0.03)'
      }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <BrandInfinityLoader label="Loading calendar activities…" size="md" minHeight="220px" />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 1000 }}>
              <thead>
                <tr style={{ background: '#FAF8FD', borderBottom: '1px solid #E4DFEE' }}>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Activity Name
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Project Name
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Main POC
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Content POC
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>
                    Quantity
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Budget
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    User
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Period
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Scheduler
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Auditor
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>
                    Move Status
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: 11.5, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredActivities.length > 0 ? (
                  filteredActivities.map((item, idx) => (
                    <tr key={item.id || idx} style={{ borderBottom: idx === filteredActivities.length - 1 ? 'none' : '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                      <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                        {item.activity_name || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
                        <span style={{ background: '#eef2ff', color: '#4338ca', padding: '3px 8px', borderRadius: 6 }}>
                          {item.project_name || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 500 }}>
                        {item.main_poc || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#334155', fontWeight: 500 }}>
                        {item.content_poc || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#0f172a', fontWeight: 700, textAlign: 'center' }}>
                        {item.quantity ?? 1}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12.5, color: '#059669', fontWeight: 700 }}>
                        {item.budget ? (String(item.budget).startsWith('$') ? item.budget : `$${item.budget}`) : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.user || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.period || '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12 }}>
                        {item.scheduler ? (
                          String(item.scheduler).toLowerCase().includes('ai') ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ede9fe', color: '#6d28d9', padding: '3px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700 }}>
                              <Sparkles size={11} color="#7c3aed" />
                              {item.scheduler}
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f1f5f9', color: '#475569', padding: '3px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 600 }}>
                              {item.scheduler}
                            </span>
                          )
                        ) : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.auditor || '—'}
                      </td>

                      {/* Move Status Buttons */}
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          {activeSubTab !== 'saved' && (
                            <button
                              onClick={() => handleMoveStatus(item, 'saved')}
                              title="Move to Saved"
                              style={{ background: '#fef3c7', color: '#b45309', border: 'none', padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Saved
                            </button>
                          )}
                          {activeSubTab !== 'scheduled' && (
                            <button
                              onClick={() => handleMoveStatus(item, 'scheduled')}
                              title="Move to Scheduled"
                              style={{ background: '#dbeafe', color: '#1d4ed8', border: 'none', padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Scheduled
                            </button>
                          )}
                          {activeSubTab !== 'approved' && (
                            <button
                              onClick={() => handleMoveStatus(item, 'approved')}
                              title="Move to Approved"
                              style={{ background: '#d1fae5', color: '#047857', border: 'none', padding: '3px 7px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Approved
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Actions: Edit / Delete */}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            onClick={() => handleOpenEditModal(item)}
                            title="Edit Activity"
                            style={{ background: 'transparent', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 4 }}
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteItem(item)}
                            title="Delete Activity"
                            style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', padding: 4 }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={12} style={{ padding: '50px 20px', textAlign: 'center', color: '#94a3b8' }}>
                      <FileSpreadsheet size={36} color="#cbd5e1" style={{ marginBottom: 8 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>
                        No {activeSubTab} activities found in database table
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Click "+ New Entry" above to add a new {activeSubTab} activity.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Activity Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)',
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: modalStep === 'keywords_prompt' ? 760 : 600,
            padding: 24,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            transition: 'max-width 0.2s ease'
          }}>
            {/* STEP 1: FORM VIEW */}
            {modalStep === 'form' ? (
              <>
                {/* Modal Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {editingItem ? 'Edit Activity' : 'Choose Project & Activity'}
                    </h3>
                    <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 0 0' }}>
                      {editingItem ? 'Update details for this scheduled activity.' : 'Configure activity settings and choose whether to run AI keyword scheduling.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#334155'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div style={{ overflowY: 'auto', flex: 1, paddingRight: 4 }}>
                  <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* AI Scheduling Toggle Card */}
                    <div
                      onClick={handleToggleAiScheduling}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: 12,
                        background: aiSchedulingEnabled ? 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' : '#f8fafc',
                        border: aiSchedulingEnabled ? '1.5px solid #c4b5fd' : '1px solid #e2e8f0',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        userSelect: 'none'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: aiSchedulingEnabled ? '#7c3aed' : '#e2e8f0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          transition: 'all 0.2s ease',
                          boxShadow: aiSchedulingEnabled ? '0 2px 8px rgba(124, 58, 237, 0.3)' : 'none'
                        }}>
                          <Sparkles size={18} color={aiSchedulingEnabled ? '#ffffff' : '#64748b'} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: aiSchedulingEnabled ? '#4c1d95' : '#1e293b' }}>
                              AI Auto-Scheduler
                            </span>
                            <span style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '1px 7px',
                              borderRadius: 20,
                              background: aiSchedulingEnabled ? '#7c3aed' : '#94a3b8',
                              color: '#ffffff',
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em'
                            }}>
                              {aiSchedulingEnabled ? 'AI Auto-Scheduler' : 'Manual'}
                            </span>
                          </div>
                          <p style={{ fontSize: 11.5, color: aiSchedulingEnabled ? '#6d28d9' : '#64748b', margin: '2px 0 0 0' }}>
                            {aiSchedulingEnabled
                              ? 'Automatically evaluates Rank 5+ landing page keywords & sets scheduler to "AI Auto-Scheduler"'
                              : 'Standard manual activity without automated keyword push evaluation (sets scheduler to "Manual")'}
                          </p>
                        </div>
                      </div>

                      {/* Modern Toggle Switch */}
                      <div
                        role="switch"
                        aria-checked={aiSchedulingEnabled}
                        style={{
                          width: 44,
                          height: 24,
                          borderRadius: 12,
                          background: aiSchedulingEnabled ? '#7c3aed' : '#cbd5e1',
                          position: 'relative',
                          padding: 2,
                          transition: 'background-color 0.2s ease',
                          flexShrink: 0
                        }}
                      >
                        <div style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: '#ffffff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          transform: aiSchedulingEnabled ? 'translateX(20px)' : 'translateX(0)',
                          transition: 'transform 0.2s ease'
                        }} />
                      </div>
                    </div>

                    {/* Row 1: Project Name & Activity Name */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Project Name *
                        </label>
                        <PlainSelect
                          required
                          placeholder="Select Project..."
                          value={formData.project_name}
                          onChange={v => setFormData({ ...formData, project_name: v })}
                          options={projects.map(p => ({ value: p.name || p.domain, label: p.name || p.domain }))}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Activity Name *
                        </label>
                        <PlainSelect
                          required
                          placeholder="Select Activity..."
                          value={formData.activity_name}
                          onChange={v => setFormData({ ...formData, activity_name: v })}
                          options={['Paid Guest Post', 'Forum - Quora', 'Forum - Reddit', 'Business Listing', 'Classified Ads']}
                        />
                      </div>
                    </div>

                    {/* Row 2: Status & Quantity */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Status *
                        </label>
                        <select
                          value={formData.status}
                          onChange={e => setFormData({ ...formData, status: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                        >
                          <option value="saved">Saved</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="approved">Approved</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Quantity
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={formData.quantity}
                          onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 1 })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>
                    </div>

                    {/* Row 3: Budget & Period / Date */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Budget
                        </label>
                        <input
                          type="text"
                          placeholder="$250"
                          value={formData.budget}
                          onChange={e => setFormData({ ...formData, budget: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Period / Date
                        </label>
                        <input
                          type="date"
                          value={formData.period}
                          onChange={e => setFormData({ ...formData, period: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>
                    </div>

                    {/* Row 4: Main POC & Content POC */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Main POC
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. John Doe"
                          value={formData.main_poc}
                          onChange={e => setFormData({ ...formData, main_poc: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Content POC
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Jane Smith"
                          value={formData.content_poc}
                          onChange={e => setFormData({ ...formData, content_poc: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>
                    </div>

                    {/* Row 5: User, Scheduler, Auditor */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          User
                        </label>
                        <input
                          type="text"
                          value={formData.user}
                          onChange={e => setFormData({ ...formData, user: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
                            Scheduler
                          </label>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: aiSchedulingEnabled ? '#7c3aed' : '#64748b' }}>
                            {aiSchedulingEnabled ? '⚡ AI Mode' : '✋ Manual'}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={formData.scheduler}
                          onChange={e => {
                            const val = e.target.value;
                            setFormData({ ...formData, scheduler: val });
                            if (val.toLowerCase().includes('ai')) {
                              setAiSchedulingEnabled(true);
                            } else if (val.toLowerCase().includes('manual')) {
                              setAiSchedulingEnabled(false);
                            }
                          }}
                          placeholder={aiSchedulingEnabled ? 'AI Auto-Scheduler' : 'Manual'}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            fontSize: 13,
                            border: aiSchedulingEnabled ? '1.5px solid #c4b5fd' : '1px solid #cbd5e1',
                            borderRadius: 8,
                            outline: 'none',
                            background: aiSchedulingEnabled ? '#faf5ff' : '#ffffff',
                            color: aiSchedulingEnabled ? '#6d28d9' : '#0f172a',
                            fontWeight: aiSchedulingEnabled ? 600 : 500,
                            transition: 'all 0.2s ease'
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                          Auditor
                        </label>
                        <input
                          type="text"
                          value={formData.auditor}
                          onChange={e => setFormData({ ...formData, auditor: e.target.value })}
                          style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                        />
                      </div>
                    </div>

                    {/* Form Footer Actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                      <button
                        type="button"
                        onClick={() => setIsModalOpen(false)}
                        style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingActivity}
                        style={{
                          padding: '9px 22px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#ffffff',
                          background: aiSchedulingEnabled ? '#7c3aed' : '#2D2D44',
                          border: 'none',
                          borderRadius: 8,
                          cursor: savingActivity ? 'not-allowed' : 'pointer',
                          opacity: savingActivity ? 0.7 : 1,
                          boxShadow: aiSchedulingEnabled ? '0 2px 10px rgba(124, 58, 237, 0.3)' : '0 2px 8px rgba(45, 45, 68, 0.25)',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                      >
                        {savingActivity ? (
                          <>
                            <div style={{ width: 14, height: 14, border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            {aiSchedulingEnabled && !editingItem && <Sparkles size={15} />}
                            <span>{editingItem ? 'Update Activity' : 'Create Activity'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              /* STEP 2: KEYWORDS PROMPT VIEW */
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '80vh' }}>
                {/* Step 2 Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 2
                    }}>
                      <Sparkles size={22} color="#7c3aed" />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
                        These are the keywords we got, do you want to add?
                      </h3>
                      <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 0 0' }}>
                        Activity <strong>"{createdActivity?.activity_name}"</strong> has been created. Evaluated Landing Page keywords (Rank 5+) against live Google SERP: Batch 1 (extremely improved), Batch 2 (extremely dropped / recovery target), and Batch 3 (didn’t move / stagnant).
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, borderRadius: 6 }}
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 280, display: 'flex', flexDirection: 'column' }}>
                  {loadingKeywords ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 14 }}>
                      <div style={{ width: 36, height: 36, border: '3px solid #ede9fe', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Fetching Landing Page keywords (Rank 5+)...
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        Scanning database for {createdActivity?.project_name}
                      </div>
                    </div>
                  ) : potentialKws.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: 12, textAlign: 'center' }}>
                      <div style={{ width: 48, height: 48, borderRadius: 24, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Search size={22} color="#94a3b8" />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
                        No Landing Page (Rank 5+) keywords found
                      </div>
                      <div style={{ fontSize: 12.5, color: '#64748b', maxWidth: 420 }}>
                        No Landing Page keywords (Rank 5+) were found for <strong>{createdActivity?.project_name}</strong> yet. You can perform a rank check from the Rankings tab to discover opportunities.
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Summary Chip Bar */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: '#f8fafc',
                        borderRadius: 8,
                        border: '1px solid #e2e8f0',
                        fontSize: 12
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, color: '#1e293b' }}>
                            Found: <strong style={{ color: '#7c3aed' }}>{potentialKws.length}</strong> keywords
                          </span>
                          <span style={{ color: '#cbd5e1' }}>•</span>
                          <span style={{ fontWeight: 600, color: '#475569' }}>
                            Selected: <strong style={{ color: '#0f172a' }}>{selectedKwIds.size}</strong>
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Sparkles size={13} color="#7c3aed" className={analyzingPotential ? 'animate-spin' : ''} />
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: analyzingPotential ? '#7c3aed' : '#15803d',
                            background: analyzingPotential ? '#ede9fe' : '#dcfce7',
                            padding: '2px 8px',
                            borderRadius: 10
                          }}>
                            {analyzingPotential ? 'Re-checking live rank & Top 3 Landing Pages…' : 'Live AI Verified'}
                          </span>
                        </div>
                      </div>

                      {/* Batched Keywords */}
                      {(() => {
                        const isPaidGuestPost = String(createdActivity?.activity_name || formData.activity_name || '').toLowerCase().includes('guest');
                        return ['high', 'medium', 'low'].map(bKey => {
                          const meta = PUSH_BATCH_META[bKey];
                          const rows = pushBatches[bKey] || [];
                          const BIcon = meta.Icon;
                          const batchIds = rows.map(r => r.id);
                          const allSelected = batchIds.length > 0 && batchIds.every(id => selectedKwIds.has(id));

                          return (
                            <div key={bKey} style={{ border: `1px solid ${meta.border}`, borderRadius: 10, overflow: 'hidden', background: '#ffffff' }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                padding: '8px 12px',
                                background: meta.bg,
                                borderBottom: `1px solid ${meta.border}`
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={meta.hint}>
                                  <BIcon size={14} color={meta.tint} />
                                  <span style={{ fontSize: 12, fontWeight: 800, color: meta.tint }}>{meta.label}</span>
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', background: '#ffffff', border: `1px solid ${meta.border}`, borderRadius: 10, padding: '0 7px' }}>
                                    {rows.length}
                                  </span>
                                </div>
                                {rows.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const next = new Set(selectedKwIds);
                                      if (allSelected) batchIds.forEach(id => next.delete(id));
                                      else batchIds.forEach(id => next.add(id));
                                      setSelectedKwIds(next);
                                    }}
                                    style={{ fontSize: 11, fontWeight: 700, color: meta.tint, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                  >
                                    {allSelected ? 'Unselect batch' : 'Select batch'}
                                  </button>
                                )}
                              </div>

                              {rows.length === 0 ? (
                                <div style={{ fontSize: 11.5, color: '#94a3b8', fontStyle: 'italic', padding: '10px 12px' }}>
                                  No keywords categorized into this batch.
                                </div>
                              ) : (
                                <div style={{ maxHeight: 210, overflowY: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                                    <thead>
                                      <tr style={{ color: '#64748b', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ padding: '6px 10px', width: 32, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}></th>
                                        <th style={{ padding: '6px 10px', position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>Keyword</th>
                                        <th style={{ padding: '6px 10px', width: 85, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>Rank Shift</th>
                                        <th style={{ padding: '6px 10px', width: 65, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>SV</th>
                                        <th style={{ padding: '6px 10px', width: 45, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>KD</th>
                                        <th style={{ padding: '6px 10px', width: 70, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>Conf</th>
                                        <th style={{ padding: '6px 10px', width: 140, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>Live AI Status</th>
                                        {!isPaidGuestPost && (
                                          <th style={{ padding: '6px 10px', width: 160, position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>Topic Link</th>
                                        )}
                                      </tr>
                                    </thead>
                                    <tbody>
                                    {rows.map(item => {
                                      const isChecked = selectedKwIds.has(item.id);
                                      const currentRank = item.new_rank ?? item.rank;
                                      return (
                                        <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9', background: isChecked ? '#f5f3ff' : 'transparent', transition: 'background-color 0.1s ease' }}>
                                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              onChange={(e) => {
                                                const next = new Set(selectedKwIds);
                                                if (e.target.checked) next.add(item.id);
                                                else next.delete(item.id);
                                                setSelectedKwIds(next);
                                              }}
                                              style={{ cursor: 'pointer', width: 15, height: 15, accentColor: '#7c3aed' }}
                                            />
                                          </td>
                                          <td style={{ padding: '6px 10px' }} title={item.reason || ''}>
                                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{item.keyword}</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                                              {(item.category || item.cluster) && (
                                                <span style={{ fontSize: 10, color: '#64748b' }}>
                                                  {[item.category, item.cluster].filter(Boolean).join(' • ')}
                                                </span>
                                              )}
                                              {item.top3_is_landing !== undefined && (
                                                <span style={{
                                                  fontSize: 9.5,
                                                  fontWeight: 700,
                                                  color: item.top3_is_landing ? '#16a34a' : '#dc2626',
                                                  background: item.top3_is_landing ? '#dcfce7' : '#fee2e2',
                                                  border: `1px solid ${item.top3_is_landing ? '#bbf7d0' : '#fecaca'}`,
                                                  padding: '0.5px 5px',
                                                  borderRadius: 4
                                                }}>
                                                  {item.top3_is_landing ? 'Top 3: Landing Page ✓' : 'Top 3: Non-Landing'}
                                                </span>
                                              )}
                                            </div>
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                              <span style={{
                                                background: currentRank <= 10 ? '#dcfce7' : '#e0f2fe',
                                                color: currentRank <= 10 ? '#15803d' : '#0369a1',
                                                padding: '2px 6px',
                                                borderRadius: 4,
                                                fontSize: 11,
                                                fontWeight: 800
                                              }}>
                                                #{currentRank}
                                              </span>
                                              {item.delta > 0 && (
                                                <span style={{ color: '#16a34a', fontWeight: 800, fontSize: 11 }} title={`Improved by ${item.delta} spots`}>
                                                  ↑{item.delta}
                                                </span>
                                              )}
                                              {item.delta < 0 && (
                                                <span style={{ color: '#ea580c', fontWeight: 800, fontSize: 11 }} title={`Dropped by ${Math.abs(item.delta)} spots`}>
                                                  ↓{Math.abs(item.delta)}
                                                </span>
                                              )}
                                              {item.delta === 0 && item.prev_rank != null && (
                                                <span style={{ color: '#94a3b8', fontWeight: 700, fontSize: 11 }} title="Rank didn't move">
                                                  =
                                                </span>
                                              )}
                                            </div>
                                            {item.prev_rank != null && (
                                              <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 2, whiteSpace: 'nowrap' }}>
                                                was #{item.prev_rank}
                                              </div>
                                            )}
                                          </td>
                                          <td style={{ padding: '6px 10px', fontWeight: 600, color: '#334155' }}>
                                            {Number(item.sv || 0).toLocaleString()}
                                          </td>
                                          <td style={{ padding: '6px 10px', fontWeight: 700, color: (item.kd || 0) > 50 ? '#ef4444' : '#16a34a' }}>
                                            {item.kd ?? 0}
                                          </td>
                                          <td style={{ padding: '6px 10px' }}>
                                            <span style={{
                                              fontSize: 11,
                                              fontWeight: 800,
                                              color: meta.tint,
                                              background: meta.bg,
                                              border: `1px solid ${meta.border}`,
                                              padding: '2px 6px',
                                              borderRadius: 6
                                            }}>
                                              {item.confidence != null ? `${item.confidence}%` : '–'}
                                            </span>
                                          </td>
                                          <td style={{ padding: '6px 10px', fontSize: 11, color: '#475569', maxWidth: 180, whiteSpace: 'normal' }} title={item.reason || ''}>
                                            <div style={{ fontWeight: 600, color: meta.tint, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                              {item.reason || (item.confidence != null ? `${item.confidence}% confidence` : '–')}
                                            </div>
                                          </td>
                                          {!isPaidGuestPost && (
                                            <td style={{ padding: '4px 10px' }}>
                                              <input
                                                type="url"
                                                placeholder="Target Landing Page URL…"
                                                value={topicLinks[item.id] !== undefined ? topicLinks[item.id] : (item.topicLink || item.landing_page_url || '')}
                                                onChange={(e) => setTopicLinks({ ...topicLinks, [item.id]: e.target.value })}
                                                style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid #cbd5e1', borderRadius: 6, outline: 'none', background: '#ffffff' }}
                                              />
                                            </td>
                                          )}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })})()}
                    </div>
                  )}
                </div>

                {/* Step 2 Footer Actions */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: '1px solid #f1f5f9'
                }}>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>
                    {potentialKws.length > 0 && (
                      <span>
                        <strong style={{ color: '#0f172a' }}>{selectedKwIds.size}</strong> of {potentialKws.length} keyword{potentialKws.length === 1 ? '' : 's'} selected
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      style={{
                        padding: '9px 18px',
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#64748b',
                        background: '#f1f5f9',
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                      onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                    >
                      {potentialKws.length === 0 ? 'Done' : 'Skip for now'}
                    </button>

                    {potentialKws.length > 0 && (
                      <button
                        type="button"
                        disabled={selectedKwIds.size === 0 || savingActivity}
                        onClick={handleConfirmAddKeywords}
                        style={{
                          padding: '9px 20px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#ffffff',
                          background: selectedKwIds.size === 0 ? '#cbd5e1' : '#7c3aed',
                          border: 'none',
                          borderRadius: 8,
                          cursor: (selectedKwIds.size === 0 || savingActivity) ? 'not-allowed' : 'pointer',
                          boxShadow: selectedKwIds.size === 0 ? 'none' : '0 2px 10px rgba(124, 58, 237, 0.3)',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}
                        onMouseEnter={e => {
                          if (selectedKwIds.size > 0 && !savingActivity) e.currentTarget.style.background = '#6d28d9';
                        }}
                        onMouseLeave={e => {
                          if (selectedKwIds.size > 0 && !savingActivity) e.currentTarget.style.background = '#7c3aed';
                        }}
                      >
                        {savingActivity ? (
                          <>
                            <div style={{ width: 14, height: 14, border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            <span>Adding...</span>
                          </>
                        ) : (
                          <>
                            <Plus size={16} />
                            <span>Add Selected Keywords ({selectedKwIds.size})</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


export default CalendarPage;
