import { useState, useEffect, useMemo } from 'react';
import { Trash2, RotateCcw, Shield, AlertTriangle, CheckCircle, AlertCircle, RefreshCw, X, Folder, FileText, ChevronDown, ChevronUp, Layers, Users, FileCode, Tag } from 'lucide-react';
import { hasPermission, PERMISSIONS } from '../../lib/permissions';
import { fetchRecycleBinItemsApi, restoreRecycleBinItemApi, hardDeleteRecycleBinItemApi } from '../../lib/projectsApi';

export default function RecycleBinPage({ user, onNavigate }) {
  const [recycleBinItems, setRecycleBinItems] = useState([]);
  const [recycleBinTab, setRecycleBinTab] = useState('all');
  const [loadingRecycleBin, setLoadingRecycleBin] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState({ type: '', text: '' });
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});

  const canRestore = hasPermission(user, PERMISSIONS.RESTORE_PROJECT);

  const loadRecycleBin = async (type = 'all') => {
    if (!canRestore) return;
    setLoadingRecycleBin(true);
    try {
      const data = await fetchRecycleBinItemsApi('all'); // fetch all items to build project groups
      setRecycleBinItems(data || []);
    } catch (err) {
      console.error('Failed to load recycle bin items:', err);
      setRestoreMsg({ type: 'error', text: 'Failed to load recycle bin items.' });
    } finally {
      setLoadingRecycleBin(false);
    }
  };

  useEffect(() => {
    if (canRestore) {
      loadRecycleBin('all');
    }
  }, [user]);

  // --- Group Items by Project ---
  const projectGroups = useMemo(() => {
    const map = {};

    recycleBinItems.forEach(item => {
      const slug = item.project_slug || item.project_name || 'general';
      const projName = item.project_name || item.project_slug || 'General';

      if (!map[slug]) {
        map[slug] = {
          slug,
          name: projName,
          latestDeletedAt: item.deleted_at,
          hasProjectRecord: false,
          counts: { project: 0, competitor: 0, page: 0, keyword: 0 },
          items: []
        };
      }

      map[slug].items.push(item);

      // Track newest deletion date
      if (item.deleted_at && new Date(item.deleted_at) > new Date(map[slug].latestDeletedAt || 0)) {
        map[slug].latestDeletedAt = item.deleted_at;
      }

      const type = (item.item_type || '').toLowerCase();
      if (type === 'project') {
        map[slug].hasProjectRecord = true;
        map[slug].counts.project += 1;
      } else if (type.includes('competitor')) {
        map[slug].counts.competitor += 1;
      } else if (type.includes('page')) {
        map[slug].counts.page += 1;
      } else if (type.includes('keyword')) {
        map[slug].counts.keyword += 1;
      }
    });

    let groupsList = Object.values(map);

    // Apply Tab Filtering
    if (recycleBinTab !== 'all') {
      groupsList = groupsList.filter(g => {
        if (recycleBinTab === 'project') return g.hasProjectRecord || g.counts.project > 0;
        if (recycleBinTab === 'competitor') return g.counts.competitor > 0;
        if (recycleBinTab === 'page') return g.counts.page > 0;
        if (recycleBinTab === 'keyword') return g.counts.keyword > 0;
        return true;
      });
    }

    return groupsList;
  }, [recycleBinItems, recycleBinTab]);

  const toggleGroupExpand = (slug) => {
    setExpandedGroups(prev => ({ ...prev, [slug]: !prev[slug] }));
  };

  const handleRestoreGroup = async (group) => {
    setRestoring(true);
    setRestoreMsg({ type: '', text: '' });
    try {
      const currentUserEmail = user?.email || 'system';
      
      // Restore by project slug (or loop over individual item IDs if multiple entries exist)
      await restoreRecycleBinItemApi(group.slug, currentUserEmail);
      
      // If there are other remaining loose item entries for this project, restore them as well
      const itemRestores = group.items
        .filter(item => item.item_type !== 'project')
        .map(item => restoreRecycleBinItemApi(item.id, currentUserEmail).catch(() => {}));
      
      await Promise.all(itemRestores);

      setRestoreMsg({
        type: 'success',
        text: `Successfully restored project "${group.name}" and all associated data.`
      });
      loadRecycleBin('all');
    } catch (err) {
      setRestoreMsg({ type: 'error', text: err.message || 'Failed to restore project group.' });
    } finally {
      setRestoring(false);
    }
  };

  const handleRestoreSingleItem = async (item) => {
    setRestoring(true);
    setRestoreMsg({ type: '', text: '' });
    try {
      const currentUserEmail = user?.email || 'system';
      const targetId = item.id || item.item_id || item.project_slug;
      await restoreRecycleBinItemApi(targetId, currentUserEmail);
      setRestoreMsg({ type: 'success', text: `Successfully restored ${item.item_type}: "${item.item_name}"` });
      await loadRecycleBin('all');
    } catch (err) {
      setRestoreMsg({ type: 'error', text: err.message || 'Failed to restore item.' });
    } finally {
      setRestoring(false);
    }
  };

  const handlePermanentlyDeleteSingleItem = async (item) => {
    setRestoring(true);
    setRestoreMsg({ type: '', text: '' });
    try {
      const currentUserEmail = user?.email || 'system';
      const targetId = item.id || item.item_id || item.project_slug;
      await hardDeleteRecycleBinItemApi(targetId, currentUserEmail);
      setRestoreMsg({ type: 'success', text: `Permanently deleted "${item.item_name}" from database.` });
      await loadRecycleBin('all');
    } catch (err) {
      setRestoreMsg({ type: 'error', text: err.message || 'Failed to delete item.' });
    } finally {
      setRestoring(false);
    }
  };

  const handlePermanentlyDeleteGroup = (group) => {
    setSelectedGroup(group);
    setShowConfirmDeleteModal(true);
  };

  const confirmPermanentlyDeleteGroup = async () => {
    if (!selectedGroup) return;
    setRestoring(true);
    setRestoreMsg({ type: '', text: '' });
    try {
      const currentUserEmail = user?.email || 'system';

      // Purge all entries under this project slug in one request
      await hardDeleteRecycleBinItemApi(selectedGroup.slug, currentUserEmail);

      // If project_name differs from slug, ensure cleanup by name as well
      if (selectedGroup.name && selectedGroup.name !== selectedGroup.slug) {
        await hardDeleteRecycleBinItemApi(selectedGroup.name, currentUserEmail).catch(() => {});
      }

      setRestoreMsg({
        type: 'success',
        text: `Permanently deleted project "${selectedGroup.name}" and all associated data from database.`
      });
      setShowConfirmDeleteModal(false);
      setSelectedGroup(null);
      await loadRecycleBin('all');
    } catch (err) {
      console.error('Failed to permanently delete project group:', err);
      setRestoreMsg({ type: 'error', text: err.message || 'Failed to permanently delete project group.' });
    } finally {
      setRestoring(false);
    }
  };

  if (!canRestore) {
    return (
      <div style={{ padding: 32, maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 40,
          textAlign: 'center',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: '#fef2f2',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <Shield size={28} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            Access Restricted
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto 20px', lineHeight: 1.5 }}>
            You do not have permission to access the System Recycle Bin. Only authorized administrators can restore deleted items.
          </p>
          <button
            onClick={() => onNavigate?.('home')}
            style={{
              padding: '8px 18px',
              fontSize: 13.5,
              fontWeight: 700,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)',
              border: '1.5px solid #09060E',
              borderRadius: 8,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(123, 47, 190, 0.35)'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'linear-gradient(135deg, #581F9E 0%, #8A33D4 45%, #D6237A 80%, #E50C88 100%)'}
            onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)'}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 28, maxWidth: 1280, margin: '0 auto' }}>
      {/* Alert Notification */}
      {restoreMsg.text && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderRadius: 8,
          marginBottom: 20,
          background: restoreMsg.type === 'success' ? 'var(--green-bg)' : '#fef2f2',
          border: `1px solid ${restoreMsg.type === 'success' ? 'var(--green)' : '#f87171'}`,
          color: restoreMsg.type === 'success' ? 'var(--green)' : '#dc2626',
          fontSize: 13.5,
          fontWeight: 500
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {restoreMsg.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{restoreMsg.text}</span>
          </div>
          <button
            onClick={() => setRestoreMsg({ type: '', text: '' })}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Recycle Bin Card */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        padding: 28
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'var(--accent-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <RotateCcw size={22} color="var(--accent)" />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                System Recycle Bin
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                  padding: '2px 9px',
                  borderRadius: 12,
                  border: '1px solid var(--border)'
                }}>
                  {projectGroups.length} Project {projectGroups.length === 1 ? 'Group' : 'Groups'}
                </span>
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
                Grouped by project. Restoring a project recovers all of its associated competitors, pages, and keywords.
              </p>
            </div>
          </div>

          <button
            onClick={() => loadRecycleBin('all')}
            disabled={loadingRecycleBin}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: loadingRecycleBin ? 'not-allowed' : 'pointer'
            }}
            title="Refresh recycle bin"
          >
            <RefreshCw size={14} className={loadingRecycleBin ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 14, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All Project Groups' },
            { id: 'project', label: 'Deleted Projects' },
            { id: 'competitor', label: 'Competitor Data' },
            { id: 'page', label: 'Page Data' },
            { id: 'keyword', label: 'Keyword Data' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setRecycleBinTab(t.id)}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 20,
                background: recycleBinTab === t.id ? 'var(--accent-gradient, linear-gradient(135deg, #7928ca 0%, #db2777 100%))' : 'var(--surface-2)',
                color: recycleBinTab === t.id ? '#ffffff' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: recycleBinTab === t.id ? '0 2px 8px rgba(121, 40, 202, 0.2)' : 'none'
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Grouped Projects List */}
        {loadingRecycleBin ? (
          <div style={{ padding: '36px 0', textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>
            Loading recycle bin items...
          </div>
        ) : projectGroups.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1.5px dashed var(--border)', borderRadius: 12 }}>
            No deleted project data found in this category.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {projectGroups.map((group) => {
              const isExpanded = !!expandedGroups[group.slug];
              const totalItems = group.items.length;

              return (
                <div
                  key={group.slug}
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid var(--border)',
                    borderRadius: 14,
                    overflow: 'hidden',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.03)'
                  }}
                >
                  {/* Card Main Bar */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    background: '#ffffff',
                    gap: 16,
                    flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: 'var(--accent-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent)'
                      }}>
                        <Folder size={22} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                            Project: {group.name}
                          </h3>

                          {/* Badges Summary */}
                          {group.hasProjectRecord && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: '#fef3c7',
                              color: '#d97706',
                              border: '1px solid #fde68a'
                            }}>
                              Deleted Project
                            </span>
                          )}

                          {group.counts.competitor > 0 && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: '#eff6ff',
                              color: '#2563eb',
                              border: '1px solid #bfdbfe'
                            }}>
                              {group.counts.competitor} Competitors
                            </span>
                          )}

                          {group.counts.page > 0 && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: '#f0fdf4',
                              color: '#166534',
                              border: '1px solid #bbf7d0'
                            }}>
                              {group.counts.page} Pages
                            </span>
                          )}

                          {group.counts.keyword > 0 && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '3px 9px',
                              borderRadius: 6,
                              background: '#f5f3ff',
                              color: '#7c3aed',
                              border: '1px solid #ddd6fe'
                            }}>
                              {group.counts.keyword} Keywords
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span>Deleted on: {group.latestDeletedAt ? new Date(group.latestDeletedAt).toLocaleDateString() : 'Recently'}</span>
                          <span>•</span>
                          <span>Total Items: <strong>{totalItems}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {totalItems > 0 && (
                        <button
                          onClick={() => toggleGroupExpand(group.slug)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'var(--surface-2)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '7px 12px',
                            fontSize: 12.5,
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          <span>{isExpanded ? 'Hide Data' : 'View Data'}</span>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}

                      <button
                        onClick={() => handleRestoreGroup(group)}
                        disabled={restoring}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: 'var(--green-bg)',
                          color: 'var(--green)',
                          border: '1px solid var(--green)',
                          borderRadius: 8,
                          padding: '7px 14px',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: restoring ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <RotateCcw size={14} />
                        <span>Restore All</span>
                      </button>

                      <button
                        onClick={() => handlePermanentlyDeleteGroup(group)}
                        disabled={restoring}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: '#fef2f2',
                          color: '#dc2626',
                          border: '1px solid #fca5a5',
                          borderRadius: 8,
                          padding: '7px 14px',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: restoring ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <Trash2 size={14} />
                        <span>Delete All</span>
                      </button>
                    </div>
                  </div>

                  {/* Expanded Nested Details */}
                  {isExpanded && (
                    <div style={{
                      padding: '16px 20px',
                      background: '#f8fafc',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Archived Items Inside {group.name}:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {group.items.map((item, idx) => (
                          <div
                            key={item.id || idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              background: '#ffffff',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              fontSize: 13
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                padding: '2px 7px',
                                borderRadius: 4,
                                background: item.item_type === 'project' ? '#fef3c7' : '#f1f5f9',
                                color: item.item_type === 'project' ? '#b45309' : '#475569'
                              }}>
                                {item.item_type}
                              </span>
                              <strong style={{ color: 'var(--text-primary)' }}>{item.item_name}</strong>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {item.deleted_at ? new Date(item.deleted_at).toLocaleDateString() : ''}
                              </span>

                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  onClick={() => handleRestoreSingleItem(item)}
                                  disabled={restoring}
                                  title="Restore single item"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    background: 'var(--green-bg)',
                                    color: 'var(--green)',
                                    border: '1px solid var(--green)',
                                    borderRadius: 6,
                                    padding: '4px 8px',
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: restoring ? 'not-allowed' : 'pointer'
                                  }}
                                >
                                  <RotateCcw size={11} />
                                  <span>Restore</span>
                                </button>

                                <button
                                  onClick={() => handlePermanentlyDeleteSingleItem(item)}
                                  disabled={restoring}
                                  title="Delete single item permanently"
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    background: '#fef2f2',
                                    color: '#dc2626',
                                    border: '1px solid #fca5a5',
                                    borderRadius: 6,
                                    padding: '4px 8px',
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    cursor: restoring ? 'not-allowed' : 'pointer'
                                  }}
                                >
                                  <Trash2 size={11} />
                                  <span>Delete</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal Popup for Group Deletion */}
      {showConfirmDeleteModal && selectedGroup && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            maxWidth: 460,
            width: '100%',
            padding: 28,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2), 0 10px 10px -5px rgba(0,0,0,0.04)',
            position: 'relative',
            border: '1px solid var(--border)'
          }}>
            <button
              type="button"
              onClick={() => { setShowConfirmDeleteModal(false); setSelectedGroup(null); }}
              style={{
                position: 'absolute',
                top: 18,
                right: 18,
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 6
              }}
            >
              <X size={18} />
            </button>

            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16
            }}>
              <AlertTriangle size={26} color="#dc2626" />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px 0' }}>
              Permanently Delete Project "{selectedGroup.name}"?
            </h3>
            <p style={{ fontSize: 13.5, color: '#475569', lineHeight: '1.5', margin: '0 0 24px 0' }}>
              Are you sure you want to permanently delete project <strong style={{ color: '#0f172a' }}>"{selectedGroup.name}"</strong> and all its <strong>{selectedGroup.items.length} associated item records</strong>?
              <br /><br />
              This will purge all competitors, pages, and keywords for this project from the database forever. <span style={{ color: '#dc2626', fontWeight: 600 }}>This action cannot be undone.</span>
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowConfirmDeleteModal(false); setSelectedGroup(null); }}
                disabled={restoring}
                style={{
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#475569',
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmPermanentlyDeleteGroup}
                disabled={restoring}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#ffffff',
                  background: '#dc2626',
                  border: 'none',
                  borderRadius: 8,
                  cursor: restoring ? 'not-allowed' : 'pointer',
                  opacity: restoring ? 0.7 : 1
                }}
              >
                <Trash2 size={15} />
                <span>{restoring ? 'Deleting All...' : 'Yes, Delete All Permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
