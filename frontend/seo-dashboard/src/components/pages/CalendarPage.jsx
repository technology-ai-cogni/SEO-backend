import React, { useState, useEffect, useMemo } from 'react';
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
  Download
} from 'lucide-react';
import {
  fetchDomainRows,
  listOffPageActivitiesApi,
  createOffPageActivityApi,
  updateOffPageActivityApi,
  deleteOffPageActivityApi
} from '../../lib/projectsApi';

export default function CalendarPage({ user }) {
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
  const [schedulingType, setSchedulingType] = useState('ai'); // 'ai' | 'manual'
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

  // Load Projects and Off-Page Activities from Supabase
  const loadData = async () => {
    setLoading(true);
    try {
      const [projs, offPageList] = await Promise.all([
        fetchDomainRows().catch(() => []),
        listOffPageActivitiesApi().catch(() => [])
      ]);

      setProjects(projs || []);
      if (projs && projs.length > 0) {
        const savedSlug = localStorage.getItem('bd_selected_project');
        const matched = projs.find(p => p.slug === savedSlug) || projs[0];
        setActiveProject(matched);
      }

      setActivities(offPageList || []);
    } catch (err) {
      console.error('[CalendarPage] Error loading data:', err);
    } finally {
      setLoading(false);
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
    setSchedulingType('ai');
    setFormData({
      activity_name: 'Guest Post',
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
    setFormData({
      activity_name: item.activity_name || '',
      project_name: item.project_name || '',
      main_poc: item.main_poc || '',
      content_poc: item.content_poc || '',
      quantity: item.quantity || 1,
      budget: item.budget || '',
      user: item.user || user?.name || user?.email || '',
      period: item.period || new Date().toISOString().split('T')[0],
      scheduler: item.scheduler || '',
      auditor: item.auditor || '',
      status: getNormalizedStatus(item.status)
    });
    setIsModalOpen(true);
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await updateOffPageActivityApi(editingItem.id, formData);
        setActivities(prev => prev.map(a => a.id === editingItem.id ? { ...a, ...formData } : a));
      } else {
        const created = await createOffPageActivityApi(formData);
        setActivities(prev => [created, ...prev]);
      }
      setIsModalOpen(false);
    } catch (err) {
      alert(`Error saving activity: ${err.message}`);
    }
  };

  const handleMoveStatus = async (item, newStatus) => {
    try {
      await updateOffPageActivityApi(item.id, { status: newStatus });
      setActivities(prev => prev.map(a => a.id === item.id ? { ...a, status: newStatus } : a));
    } catch (err) {
      console.error('[CalendarPage] Error moving status:', err);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.activity_name}"?`)) return;
    try {
      await deleteOffPageActivityApi(item.id);
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
    <div style={{ padding: '24px 32px', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>
              Calendar
            </h1>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>          </p>
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
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
              transition: 'all 0.15s ease'
            }}
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
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
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
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#1e293b',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
            >
              <FolderOpen size={16} color="#6366f1" />
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
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
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
                      background: activeProject?.slug === p.slug ? '#f1f5f9' : 'transparent',
                      fontSize: 13,
                      fontWeight: activeProject?.slug === p.slug ? 700 : 500,
                      color: activeProject?.slug === p.slug ? '#4f46e5' : '#334155',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.domain}</span>
                    {activeProject?.slug === p.slug && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4f46e5' }} />}
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
        border: '1px solid #e2e8f0',
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          {/* Sub-Tabs: Saved | Scheduled | Approved */}
          <div style={{ display: 'flex', gap: 8, background: '#f1f5f9', padding: 4, borderRadius: 10 }}>
            {/* 1. Saved Tab */}
            <button
              onClick={() => setActiveSubTab('saved')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 8,
                border: 'none',
                background: activeSubTab === 'saved' ? '#ffffff' : 'transparent',
                color: activeSubTab === 'saved' ? '#0f172a' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'saved' ? 700 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'saved' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Bookmark size={15} color={activeSubTab === 'saved' ? '#6366f1' : '#64748b'} />
              <span>Saved</span>
              <span style={{
                background: activeSubTab === 'saved' ? '#e0e7ff' : '#e2e8f0',
                color: activeSubTab === 'saved' ? '#4338ca' : '#475569',
                fontSize: 11,
                fontWeight: 700,
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
                border: 'none',
                background: activeSubTab === 'scheduled' ? '#ffffff' : 'transparent',
                color: activeSubTab === 'scheduled' ? '#0f172a' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'scheduled' ? 700 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'scheduled' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <Clock size={15} color={activeSubTab === 'scheduled' ? '#f59e0b' : '#64748b'} />
              <span>Scheduled</span>
              <span style={{
                background: activeSubTab === 'scheduled' ? '#fef3c7' : '#e2e8f0',
                color: activeSubTab === 'scheduled' ? '#b45309' : '#475569',
                fontSize: 11,
                fontWeight: 700,
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
                border: 'none',
                background: activeSubTab === 'approved' ? '#ffffff' : 'transparent',
                color: activeSubTab === 'approved' ? '#0f172a' : '#64748b',
                fontSize: 13,
                fontWeight: activeSubTab === 'approved' ? 700 : 600,
                cursor: 'pointer',
                boxShadow: activeSubTab === 'approved' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <CheckCircle2 size={15} color={activeSubTab === 'approved' ? '#10b981' : '#64748b'} />
              <span>Approved</span>
              <span style={{
                background: activeSubTab === 'approved' ? '#d1fae5' : '#e2e8f0',
                color: activeSubTab === 'approved' ? '#047857' : '#475569',
                fontSize: 11,
                fontWeight: 700,
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
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  outline: 'none',
                  width: 240,
                  background: '#f8fafc'
                }}
              />
            </div>

            <button
              onClick={() => handleOpenAddModal(activeSubTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#6366f1',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(99, 102, 241, 0.2)'
              }}
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
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
      }}>
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Sparkles size={32} className="animate-spin" color="#6366f1" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Fetching off_page_activities from database...</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 1000 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
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
                      <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                        {item.scheduler || '—'}
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
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
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
          background: 'rgba(15, 23, 42, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 580,
            padding: 24,
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                {editingItem ? 'Edit Activity' : 'Add New Off-Page Activity'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                <X size={20} />
              </button>
            </div>

            {/* 2-Tab Toggles: AI Scheduling | Manual Scheduling */}
            {!editingItem && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                background: '#f1f5f9',
                padding: 4,
                borderRadius: 12,
                marginBottom: 20
              }}>
                <button
                  type="button"
                  onClick={() => setSchedulingType('ai')}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 9,
                    border: 'none',
                    background: schedulingType === 'ai' ? '#ffffff' : 'transparent',
                    color: schedulingType === 'ai' ? '#4f46e5' : '#64748b',
                    fontSize: 13.5,
                    fontWeight: schedulingType === 'ai' ? 700 : 600,
                    cursor: 'pointer',
                    boxShadow: schedulingType === 'ai' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8
                  }}
                >
                  <Sparkles size={16} color={schedulingType === 'ai' ? '#6366f1' : '#64748b'} />
                  <span>AI Scheduling</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSchedulingType('manual')}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 9,
                    border: 'none',
                    background: schedulingType === 'manual' ? '#ffffff' : 'transparent',
                    color: schedulingType === 'manual' ? '#4f46e5' : '#64748b',
                    fontSize: 13.5,
                    fontWeight: schedulingType === 'manual' ? 700 : 600,
                    cursor: 'pointer',
                    boxShadow: schedulingType === 'manual' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8
                  }}
                >
                  <Edit3 size={15} color={schedulingType === 'manual' ? '#6366f1' : '#64748b'} />
                  <span>Manual Scheduling</span>
                </button>
              </div>
            )}

            <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* TAB 1: AI SCHEDULING */}
              {schedulingType === 'ai' && !editingItem ? (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Project Name *
                    </label>
                    <select
                      required
                      value={formData.project_name}
                      onChange={e => setFormData({ ...formData, project_name: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                    >
                      <option value="">Select Project...</option>
                      {projects.map(p => (
                        <option key={p.slug} value={p.name || p.domain}>
                          {p.name || p.domain}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                      Activity Name *
                    </label>
                    <select
                      required
                      value={formData.activity_name}
                      onChange={e => setFormData({ ...formData, activity_name: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                    >
                      <option value="">Select Activity...</option>
                      <option value="Guest Post">Guest Post</option>
                      <option value="Press Release">Press Release</option>
                      <option value="Niche Edit">Niche Edit</option>
                      <option value="Directory Submission">Directory Submission</option>
                      <option value="Social Bookmarking">Social Bookmarking</option>
                      <option value="Web 2.0 Backlink">Web 2.0 Backlink</option>
                      <option value="Forum Discussion">Forum Discussion</option>
                      <option value="PBN Placement">PBN Placement</option>
                      <option value="Quora Answer">Quora Answer</option>
                      <option value="Reddit Promotion">Reddit Promotion</option>
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                </>
              ) : (
                /* TAB 2: MANUAL SCHEDULING */
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Activity Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.activity_name}
                      onChange={e => setFormData({ ...formData, activity_name: e.target.value })}
                      style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Project Name *</label>
                      <select
                        required
                        value={formData.project_name}
                        onChange={e => setFormData({ ...formData, project_name: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff', color: '#0f172a', fontWeight: 600 }}
                      >
                        <option value="">Select Project...</option>
                        {projects.map(p => (
                          <option key={p.slug} value={p.name || p.domain}>
                            {p.name || p.domain}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Status *</label>
                      <select
                        value={formData.status}
                        onChange={e => setFormData({ ...formData, status: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#ffffff' }}
                      >
                        <option value="saved">Saved</option>
                        <option value="scheduled">Scheduled</option>
                        <option value="approved">Approved</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Main POC</label>
                      <input
                        type="text"
                        value={formData.main_poc}
                        onChange={e => setFormData({ ...formData, main_poc: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Content POC</label>
                      <input
                        type="text"
                        value={formData.content_poc}
                        onChange={e => setFormData({ ...formData, content_poc: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.quantity}
                        onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value, 10) || 1 })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Budget</label>
                      <input
                        type="text"
                        value={formData.budget}
                        onChange={e => setFormData({ ...formData, budget: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>User</label>
                      <input
                        type="text"
                        value={formData.user}
                        onChange={e => setFormData({ ...formData, user: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Period / Date</label>
                      <input
                        type="text"
                        value={formData.period}
                        onChange={e => setFormData({ ...formData, period: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Scheduler</label>
                      <input
                        type="text"
                        value={formData.scheduler}
                        onChange={e => setFormData({ ...formData, scheduler: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Auditor</label>
                      <input
                        type="text"
                        value={formData.auditor}
                        onChange={e => setFormData({ ...formData, auditor: e.target.value })}
                        style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }}
                      />
                    </div>
                  </div>
                </>
              )
              }

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: '#64748b', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700, color: '#ffffff', background: '#6366f1', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                >
                  {editingItem ? 'Update Activity' : 'Create Activity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
