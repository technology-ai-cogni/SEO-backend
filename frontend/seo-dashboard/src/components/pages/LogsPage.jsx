import { useState, useEffect } from 'react';
import { FileText, Search, RefreshCw, Trash2, Shield, AlertTriangle, Filter, CheckCircle, Info, AlertCircle } from 'lucide-react';
import { hasPermission, PERMISSIONS } from '../../lib/permissions';
import { fetchAuditLogsApi } from '../../lib/projectsApi';
import BrandInfinityLoader from '../common/BrandInfinityLoader';

export default function LogsPage({ user, onNavigate }) {
  const [logs, setLogs] = useState([]);
  const [logSearch, setLogSearch] = useState('');
  const [logFilterSeverity, setLogFilterSeverity] = useState('All');
  const [logFilterModule, setLogFilterModule] = useState('All');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const canViewLogs = hasPermission(user, PERMISSIONS.VIEW_LOGS);

  const loadAuditLogs = async () => {
    if (!canViewLogs) return;
    setLoadingLogs(true);
    try {
      const data = await fetchAuditLogsApi(logSearch, logFilterSeverity);
      setLogs(data || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      setMsg({ type: 'error', text: 'Failed to load audit logs.' });
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (canViewLogs) {
      loadAuditLogs();
    }
  }, [user, logSearch, logFilterSeverity]);

  if (!canViewLogs) {
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
            You do not have permission to view system activity audit logs. Only administrators can access audit logs.
          </p>
          <button
            onClick={() => onNavigate?.('home')}
            style={{
              padding: '8px 18px',
              fontSize: 13.5,
              fontWeight: 600,
              color: '#ffffff',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  const getDisplayName = (l) => {
    if (l.user_name) return l.user_name;
    if (!l.user || l.user === 'system') return 'System';
    if (user && user.email === l.user && user.name) return user.name;
    if (l.user.includes('@')) {
      const usernamePart = l.user.split('@')[0];
      return usernamePart.charAt(0).toUpperCase() + usernamePart.slice(1);
    }
    return l.user;
  };

  const getProjectName = (l) => {
    const action = l.action || '';
    const actionLower = action.toLowerCase();
    const moduleLower = (l.module || '').toLowerCase();

    // Auth and general user account actions are not related to any project
    if (
      moduleLower === 'auth' ||
      actionLower.includes('login') ||
      actionLower.includes('register') ||
      actionLower.includes('password') ||
      actionLower.includes('profile updated')
    ) {
      return '';
    }

    // 1. Direct project_name field from log object if present and valid
    if (l.project_name && l.project_name !== '-' && l.project_name.trim() !== '' && l.project_name !== 'Global System') {
      return l.project_name;
    }

    // 2. Colon separator pattern (e.g. "Pages Added to Project (3 pages): goodday")
    if (action.includes(': ')) {
      const parts = action.split(': ');
      const candidate = parts[parts.length - 1].trim();
      if (candidate && !['Success', 'Warning', 'Failed', 'Error', 'Info'].includes(candidate)) {
        return candidate;
      }
    }

    // 3. Explicit Project action patterns
    if (action.includes('Project Created: ')) return action.split('Project Created: ')[1].trim();
    if (action.includes('Project Deleted: ')) return action.split('Project Deleted: ')[1].trim();
    if (action.includes('Project Permanently Deleted: ')) return action.split('Project Permanently Deleted: ')[1].trim();
    if (action.includes('Project Restored: ')) return action.split('Project Restored: ')[1].trim();

    // 4. Regex for (Project: <name>), for Project: <name>, to Project: <name>
    const matchProjTag = action.match(/(?:Project|for Project|to Project|in Project|for)\s*\(?[\d\w\s]*\)?:\s*([^\s,()]+)/i);
    if (matchProjTag && matchProjTag[1]) {
      return matchProjTag[1].trim();
    }

    const matchParen = action.match(/\(Project:\s*([^)]+)\)/i);
    if (matchParen && matchParen[1]) {
      return matchParen[1].trim();
    }

    // 5. Match " pages to <name>" or "Added to <name>"
    if (actionLower.includes(' to ')) {
      const afterTo = action.split(/ to /i)[1];
      if (afterTo) {
        const cleanName = afterTo.split(' ')[0].trim();
        if (cleanName && cleanName !== 'Project') return cleanName;
      }
    }

    // Default for any non-project action is an empty space
    return '';
  };

  const getModule = (l) => {
    if (l.module && l.module !== '-') return l.module;
    const action = l.action || '';
    if (action.toLowerCase().includes('project')) return 'project';
    if (action.toLowerCase().includes('page')) return 'pages';
    if (action.toLowerCase().includes('keyword') || action.toLowerCase().includes('clustering')) return 'intent';
    if (action.toLowerCase().includes('competitor')) return 'competitors';
    if (action.toLowerCase().includes('login')) return 'auth';
    return '-';
  };

  const filteredLogs = logs.filter(l => {
    if (!l.user || l.user.toLowerCase() === 'system') return false;
    const query = logSearch.toLowerCase();
    const displayName = getDisplayName(l).toLowerCase();
    const userEmail = (l.user || '').toLowerCase();
    const projName = getProjectName(l).toLowerCase();
    const moduleName = getModule(l).toLowerCase();
    const actionText = (l.action || '').toLowerCase();

    const matchesSearch = 
      displayName.includes(query) ||
      userEmail.includes(query) ||
      projName.includes(query) ||
      moduleName.includes(query) ||
      actionText.includes(query);

    const matchesSeverity = logFilterSeverity === 'All' || l.status === logFilterSeverity;
    const matchesModule = logFilterModule === 'All' || moduleName === logFilterModule.toLowerCase();
    
    return matchesSearch && matchesSeverity && matchesModule;
  });

  return (
    <div style={{ padding: 28, maxWidth: 1280, margin: '0 auto' }}>
      {/* Alert Notification */}
      {msg.text && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderRadius: 8,
          marginBottom: 20,
          background: msg.type === 'success' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${msg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          color: msg.type === 'success' ? '#166534' : '#991b1b',
          fontSize: 13.5
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {msg.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{msg.text}</span>
          </div>
          <button
            onClick={() => setMsg({ type: '', text: '' })}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Audit Logs Card */}
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
              <FileText size={22} color="var(--accent)" />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                System Activity Audit Logs
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--surface-2)',
                  color: 'var(--text-secondary)',
                  padding: '2px 9px',
                  borderRadius: 12,
                  border: '1px solid var(--border)'
                }}>
                  {filteredLogs.length} entries
                </span>
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
                Monitor system activity, administrative changes, and user actions across modules.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={loadAuditLogs}
              disabled={loadingLogs}
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
                cursor: loadingLogs ? 'not-allowed' : 'pointer'
              }}
              title="Refresh audit logs"
            >
              <RefreshCw size={14} className={loadingLogs ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
            <Search size={15} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search by Username, Email, Project, Module, or Action..."
              value={logSearch}
              onChange={e => setLogSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 14px 9px 36px',
                fontSize: 13.5,
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <select
            value={logFilterModule}
            onChange={e => setLogFilterModule(e.target.value)}
            style={{
              width: 150,
              padding: '9px 14px',
              fontSize: 13.5,
              background: 'var(--surface)',
              border: '1.5px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="All">All Modules</option>
            <option value="project">Project</option>
            <option value="pages">Pages</option>
            <option value="intent">Intent / KW</option>
            <option value="competitors">Competitors</option>
            <option value="auth">Auth</option>
          </select>

          <select
            value={logFilterSeverity}
            onChange={e => setLogFilterSeverity(e.target.value)}
            style={{
              width: 150,
              padding: '9px 14px',
              fontSize: 13.5,
              background: 'var(--surface)',
              border: '1.5px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="All">All Severity</option>
            <option value="Success">Success</option>
            <option value="Warning">Warning</option>
          </select>
        </div>

        {/* Logs Table */}
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 540 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 150 }}>Time</th>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 140 }}>Username</th>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 190 }}>User Email</th>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 140 }}>Project Name</th>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 110 }}>Module</th>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Action Log</th>
                  <th style={{ padding: '11px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 90 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingLogs ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center' }}>
                      <BrandInfinityLoader label="Loading audit logs…" size="md" minHeight="180px" />
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5 }}>
                      No audit log entries match your filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map(log => {
                    const displayName = getDisplayName(log);
                    const userEmail = log.user || 'system';
                    const projName = getProjectName(log);
                    const moduleName = getModule(log);

                    const statusColors = {
                      Success: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
                      Warning: { bg: '#fef3c7', text: '#d97706', border: '#fde68a' },
                      Info: { bg: 'var(--surface-2)', text: 'var(--text-muted)', border: 'var(--border)' },
                    };
                    const colors = statusColors[log.status] || { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' };

                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{log.timestamp}</td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{displayName}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--text-secondary)' }}>{userEmail}</td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{projName}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                          {moduleName !== '-' ? (
                            <span style={{
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border)',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: 11,
                              textTransform: 'capitalize'
                            }}>
                              {moduleName}
                            </span>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>{log.action}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12.5 }}>
                          <span style={{
                            background: colors.bg,
                            color: colors.text,
                            border: `1px solid ${colors.border}`,
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontWeight: 700,
                            fontSize: 11
                          }}>
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
