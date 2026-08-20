import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, Minus, X, ChevronDown, ChevronLeft, ChevronRight, Edit2, HelpCircle, Upload, Check, Monitor, Globe, ArrowLeft, Trash2, RefreshCw, Filter, Download, Folder, FolderTree, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Badge } from '../ui/Card';
import {
  fetchDomainRows, createProject, updateDomainRow, deleteDomainRow, deleteKwProject,
  fetchKwProjects, fetchKeywordRows, insertKeywordRows, updateKeywordRow, bulkDeleteKeywordRows, deleteKwClusterData,
  fetchPageRows, insertPageRows, updatePageRow, deletePageRow, bulkDeletePageRows, deletePagesData, fetchPagesCounts,
  fetchCompetitorPageRows, insertCompetitorPageRows, updateCompetitorPageRow, deleteCompetitorPageRow,
  fetchCompetitors, insertCompetitor, updateCompetitor, deleteCompetitor, deleteCompetitorProjectData,
  findCompetitors, fetchCompetitorSnapshots, classifyCompetitorUrls,
  fetchOutreachSitesApi, addOutreachSiteApi, deleteOutreachSiteApi,
  updateOutreachSiteApi, bulkDeleteOutreachSitesApi, bulkUpdateOutreachSitesApi,
  createAuditLogApi, getActiveUserEmail,
  getApiBaseUrl
} from '../../lib/projectsApi';
import { isReadOnlyUser, canEdit, canDelete, canDownload, canUpdate } from '../../lib/permissions';

// ─── shared tiny components ────────────────────────────────────────────────

function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const sample = rows[0];
  const keys = Object.keys(sample).filter(k => {
    const v = sample[k];
    return typeof v !== 'function' && typeof v !== 'symbol' && (!v || typeof v !== 'object' || Array.isArray(v));
  });

  if (!keys.length) return;

  const headerRow = keys.map(k => {
    let name = k.replace(/([A-Z])/g, ' $1').trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return `"${name.replace(/"/g, '""')}"`;
  }).join(',');

  const bodyRows = rows.map(row =>
    keys.map(k => {
      let val = row[k];
      if (Array.isArray(val)) val = val.join('; ');
      else if (val === null || val === undefined) val = '';
      else val = String(val);
      val = val.replace(/"/g, '""');
      return `"${val}"`;
    }).join(',')
  );

  const csvString = [headerRow, ...bodyRows].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(filename || 'export').replace(/[^a-z0-9_-]/gi, '_')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function Input({ label, hint, placeholder, required, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
          {hint && <HelpCircle size={13} color="var(--text-muted)" />}
        </div>
      )}
      
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8,
          padding: '10px 14px', fontSize: 14, outline: 'none',
          fontFamily: 'var(--font-body)', color: 'var(--text-primary)',
          background: '#fff', transition: 'border-color 0.15s',
        }}
        onFocus={e => e.target.style.borderColor = '#5c4af2'}
        onBlur={e => e.target.style.borderColor = '#d1d5db'}
      />
    </div>
  );
}

function Select({ label, options, value, onChange, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>}
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={e => onChange?.(e.target.value)}
          style={{
            width: '100%', appearance: 'none', border: '1.5px solid #d1d5db',
            borderRadius: 8, padding: '10px 36px 10px 14px', fontSize: 13,
            fontFamily: 'var(--font-body)', color: value ? 'var(--text-primary)' : 'var(--text-muted)',
            background: '#fff', cursor: 'pointer', outline: 'none',
          }}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
        </select>
        <ChevronDown size={14} color="var(--text-muted)" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica',
  'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt',
  'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon',
  'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel',
  'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos',
  'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi',
  'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova',
  'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau',
  'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal',
  'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela',
  'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

function CountryTagInput({ label, tags, onAdd, onRemove, placeholder }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const filtered = input.trim()
    ? COUNTRIES.filter(c => c.toLowerCase().includes(input.toLowerCase()) && !tags.includes(c))
    : COUNTRIES.filter(c => !tags.includes(c));

  const select = (country) => {
    onAdd(country);
    setInput('');
    setHighlightIdx(0);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlightIdx]) select(filtered[highlightIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
      {label && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>}
      <div
        style={{ border: '1.5px solid #d1d5db', borderRadius: 8, padding: '8px 10px', minHeight: 42, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', background: '#fff' }}
        onClick={() => setOpen(true)}
      >
        {tags.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 99, padding: '2px 10px', fontSize: 12, fontWeight: 500 }}>
            {t}
            <button onClick={(e) => { e.stopPropagation(); onRemove(t); }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); setHighlightIdx(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : 'Type to search...'}
          style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: 'var(--font-body)', minWidth: 100, flex: 1, background: 'transparent' }}
        />
        <ChevronDown
          size={14}
          color="var(--text-muted)"
          style={{ flexShrink: 0, cursor: 'pointer' }}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        />
      </div>
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 50,
          background: '#fff', border: '1.5px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.map((c, i) => (
            <div
              key={c}
              onMouseDown={(e) => { e.preventDefault(); select(c); }}
              onMouseEnter={() => setHighlightIdx(i)}
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                background: i === highlightIdx ? 'var(--accent-light)' : 'transparent',
                color: i === highlightIdx ? 'var(--accent)' : 'var(--text-primary)',
                fontWeight: i === highlightIdx ? 600 : 400,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MultiSelect({ label, options, selected, onToggle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => {
          const active = selected.includes(o.value);
          return (
            <button
              key={o.value}
              onClick={() => onToggle(o.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 500,
                border: active ? '1.5px solid var(--accent)' : '1.5px solid #d1d5db',
                background: active ? 'var(--accent-light)' : '#fff',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all 0.15s',
              }}
            >
              {active && <Check size={11} />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 18, height: 18, borderRadius: 4, border: checked ? '2px solid var(--accent)' : '2px solid #d1d5db',
          background: checked ? 'var(--accent)' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s', cursor: 'pointer',
        }}
      >
        {checked && <Check size={11} color="#fff" strokeWidth={3} />}
      </div>
      <span style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{label}</span>
    </label>
  );
}

// ─── Filter Sub-Dropdown for each field ─────────────────────────────────────
function FilterFieldDropdown({ label, options, selectedValues, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedCount = selectedValues.length;
  const buttonText = selectedCount === 0
    ? `All ${label}s`
    : selectedCount === 1
      ? selectedValues[0]
      : `${selectedCount} selected`;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          border: selectedCount > 0 ? '1.5px solid #7c3aed' : '1.5px solid #d1d5db',
          borderRadius: 8, padding: '7px 12px', fontSize: 13,
          fontFamily: 'var(--font-body)',
          background: selectedCount > 0 ? '#f5f3ff' : '#fff',
          color: selectedCount > 0 ? '#7c3aed' : 'var(--text-primary)',
          cursor: 'pointer', outline: 'none', transition: 'all 0.15s',
          fontWeight: selectedCount > 0 ? 600 : 400,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {buttonText}
        </span>
        <ChevronDown size={14} color={selectedCount > 0 ? '#7c3aed' : 'var(--text-muted)'} style={{ flexShrink: 0, marginLeft: 6 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
            marginTop: 4, background: '#fff',
            border: '1.5px solid #d1d5db', borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            maxHeight: 180, overflowY: 'auto', padding: '4px 0',
          }}
        >
          {options.map(val => {
            const selected = selectedValues.includes(val);
            return (
              <div
                key={val}
                onClick={() => onToggle(val)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
                  background: selected ? '#f5f3ff' : 'transparent',
                  color: 'var(--text-primary)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = selected ? '#ede9fe' : '#f9fafb'}
                onMouseLeave={e => e.currentTarget.style.background = selected ? '#f5f3ff' : 'transparent'}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: selected ? '2px solid #7c3aed' : '1.5px solid #d1d5db',
                  background: selected ? '#7c3aed' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected && <Check size={9} color="#fff" strokeWidth={3} />}
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
              </div>
            );
          })}
          {options.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 12px' }}>No options available</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shared Table Filter Dropdown ──────────────────────────────────────────
function TableFilterDropdown({ filters, rows, activeFilters, onFiltersChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const updatePos = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
  };

  const toggleOpen = () => {
    if (!open) updatePos();
    setOpen(p => !p);
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    document.addEventListener('mousedown', handler);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('mousedown', handler);
    };
  }, [open]);

  const activeCount = filters.reduce((acc, f) => {
    const val = activeFilters[f.key];
    if (f.type === 'select' && val && val.length > 0) return acc + 1;
    if (f.type === 'range' && val && (val.min !== '' || val.max !== '')) return acc + 1;
    return acc;
  }, 0);

  const clearAll = () => {
    const cleared = {};
    filters.forEach(f => {
      cleared[f.key] = f.type === 'range' ? { min: '', max: '' } : [];
    });
    onFiltersChange(cleared);
  };

  const toggleSelectValue = (key, val) => {
    const current = activeFilters[key] || [];
    const updated = current.includes(val) ? current.filter(v => v !== val) : [...current, val];
    onFiltersChange({ ...activeFilters, [key]: updated });
  };

  const updateRange = (key, field, value) => {
    const current = activeFilters[key] || { min: '', max: '' };
    onFiltersChange({ ...activeFilters, [key]: { ...current, [field]: value } });
  };

  const uniqueVals = {};
  filters.forEach(f => {
    if (f.type === 'select') {
      if (f.options) {
        uniqueVals[f.key] = f.options;
      } else {
        const set = new Set();
        (rows || []).forEach(r => {
          const v = r[f.key];
          if (v != null && v !== '') {
            String(v).split(',').forEach(item => {
              const trimmed = item.trim();
              if (trimmed) set.add(trimmed);
            });
          }
        });
        uniqueVals[f.key] = [...set].sort();
      }
    }
  });

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        title="Filter"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
          background: activeCount > 0 ? '#f5f3ff' : 'none',
          border: activeCount > 0 ? '1.5px solid #7c3aed' : '1.5px solid var(--border)',
          borderRadius: 8, padding: 8,
          cursor: 'pointer', color: activeCount > 0 ? '#7c3aed' : 'var(--text-muted)',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = activeCount > 0 ? '#7c3aed' : 'var(--border-hover)'; e.currentTarget.style.color = activeCount > 0 ? '#7c3aed' : 'var(--text-primary)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = activeCount > 0 ? '#7c3aed' : 'var(--border)'; e.currentTarget.style.color = activeCount > 0 ? '#7c3aed' : 'var(--text-muted)'; }}
      >
        <Filter size={14} />
        {activeCount > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            background: '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 700,
            width: 16, height: 16, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{activeCount}</span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999,
            width: 310,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            maxHeight: 460, overflowY: 'auto',
          }}
        >
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#fff', position: 'sticky', top: 0, zIndex: 2,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Filters</span>
            {activeCount > 0 && (
              <button
                onClick={clearAll}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, color: '#7c3aed',
                  fontFamily: 'var(--font-body)',
                }}
              >Clear all</button>
            )}
          </div>

          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filters.map(f => {
              const isActive = f.type === 'select'
                ? (activeFilters[f.key] || []).length > 0
                : activeFilters[f.key] && (activeFilters[f.key].min !== '' || activeFilters[f.key].max !== '');

              return (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: isActive ? '#7c3aed' : 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span>{f.label}</span>
                  </div>

                  {f.type === 'select' && (
                    <FilterFieldDropdown
                      label={f.label}
                      options={uniqueVals[f.key] || []}
                      selectedValues={activeFilters[f.key] || []}
                      onToggle={val => toggleSelectValue(f.key, val)}
                    />
                  )}

                  {f.type === 'range' && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        placeholder="Min"
                        value={activeFilters[f.key]?.min || ''}
                        onChange={e => updateRange(f.key, 'min', e.target.value)}
                        style={{
                          flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6,
                          border: '1px solid var(--border)', outline: 'none',
                          fontFamily: 'var(--font-body)',
                        }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={activeFilters[f.key]?.max || ''}
                        onChange={e => updateRange(f.key, 'max', e.target.value)}
                        style={{
                          padding: '7px 10px', fontSize: 12.5, fontFamily: 'var(--font-body)',
                          outline: 'none', width: '100%', background: '#fff',
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function RobotClusterIcon({ busy, size = 26 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      <svg
        className={`robot-cluster-icon${busy ? ' is-busy' : ''}`}
        width={size} height={size} viewBox="0 0 32 32" fill="none"
        style={{ position: 'relative' }}
      >
        <ellipse cx="16" cy="27" rx="8" ry="4" fill="#c9ced9" />
        <circle cx="6" cy="17" r="2.6" fill="#dbe0e8" />
        <circle cx="26" cy="17" r="2.6" fill="#dbe0e8" />
        <rect x="3" y="9" width="26" height="18" rx="9" fill="#eef1f5" />
        <rect x="7" y="13" width="18" height="12" rx="5" fill="#111827" />
        <circle className="robot-eye" cx="12.5" cy="19" r="1.9" fill="#5eead4" />
        <circle className="robot-eye" cx="19.5" cy="19" r="1.9" fill="#5eead4" />
        <path d="M13.5 22.2 Q16 24 18.5 22.2" stroke="#5eead4" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <rect x="14" y="4" width="4" height="5" rx="2" fill="#c3c9d4" />
        <circle cx="16" cy="4" r="1.6" fill="#5eead4" />
      </svg>
    </span>
  );
}

// ─── Modal wrapper ──────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children, footer, maxWidth = 520, style = {} }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', position: 'relative', ...style }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 14px', borderBottom: '1px solid var(--border, #e5e7eb)', flexShrink: 0 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '20px 28px 20px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '14px 28px 20px', display: 'flex', gap: 12, borderTop: '1px solid var(--border, #e5e7eb)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Btn({ children, variant = 'primary', onClick, style = {} }) {
  const styles = {
    primary: { background: '#0f1523', color: '#fff', border: 'none' },
    outline: { background: '#fff', color: '#0f1523', border: '1.5px solid #d1d5db' },
    accent: { background: 'var(--accent)', color: '#fff', border: 'none' },
  };
  return (
    <button onClick={onClick} style={{
      ...styles[variant], borderRadius: 10, padding: '10px 22px',
      fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
      flex: variant === 'primary' || variant === 'accent' ? 1 : 'none',
      transition: 'opacity 0.15s', ...style,
    }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
      {children}
    </button>
  );
}

// ─── Create Project Modal ────────────────────────────────────────────────────

function CreateProjectModal({ open, onClose, onCreateProject }) {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [share, setShare] = useState(false);
  const [regions, setRegions] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [da, setDa] = useState('');
  const [napBusinessCentre, setNapBusinessCentre] = useState('');
  const [napPhone, setNapPhone] = useState('');
  const [napWebsite, setNapWebsite] = useState('');
  const [napAddress, setNapAddress] = useState('');
  const [napEmail, setNapEmail] = useState('');
  const [brandedTerms, setBrandedTerms] = useState('');
  const [userType, setUserType] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [users, setUsers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [btnActive, setBtnActive] = useState(false);

  const platformOptions = [
    { value: 'ai_mode', label: 'AI Mode' },
    { value: 'ai_overview', label: 'AI Overview' },
    { value: 'google', label: 'Google' },
    { value: 'chatgpt', label: 'ChatGPT' },
    { value: 'gemini', label: 'Gemini' },
  ];

  const userTypeLabels = { agency: 'Agency', cxo: 'CXO', project_head: 'Project Head', team_member: 'Team Member' };

  const togglePlatform = (v) => setPlatforms(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const addUser = () => {
    if (userType && userEmail.trim()) {
      setUsers(prev => [...prev, { type: userType, email: userEmail.trim() }]);
      setUserType('');
      setUserEmail('');
    }
  };

  const removeUser = (index) => setUsers(prev => prev.filter((_, i) => i !== index));

  const resetForm = () => {
    setDomain(''); setName(''); setShare(false); setRegions([]);
    setPlatforms([]); setDa('');
    setNapBusinessCentre(''); setNapPhone(''); setNapWebsite(''); setNapAddress(''); setNapEmail('');
    setBrandedTerms('');
    setUserType(''); setUserEmail(''); setUsers([]);
    setSubmitting(false); setApiError('');
  };

  const handleCreate = async () => {
    if (!domain.trim()) return;
    setSubmitting(true);
    setApiError('');
    try {
      await onCreateProject({
        domain: domain.trim(),
        name: name.trim() || domain.trim(),
        regions,
        platforms,
        da: da || null,
        nap_business_centre: napBusinessCentre.trim(),
        nap_phone: napPhone.trim(),
        nap_website: napWebsite.trim(),
        nap_address: napAddress.trim(),
        nap_email: napEmail.trim(),
        branded_terms: brandedTerms.trim(),
        users,
        share,
      });
      resetForm();
      onClose();
    } catch (err) {
      setSubmitting(false);
      setApiError(err.message || 'Failed to create project.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create project" maxWidth={920}
      footer={<>
        <Btn
          variant="primary"
          onClick={handleCreate}
          style={{
            background: (submitting || btnActive) ? '#0f1523' : '#6b7280',
            color: '#ffffff',
            transition: 'background-color 0.15s ease, opacity 0.15s ease',
            ...(submitting ? { opacity: 0.6, pointerEvents: 'none' } : {})
          }}
          onMouseDown={() => setBtnActive(true)}
          onMouseUp={() => setBtnActive(false)}
          onMouseLeave={() => setBtnActive(false)}
        >
          {submitting ? 'Creating…' : 'Create SEO project'}
        </Btn>
        <Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
      </>}
    >
      {apiError && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{apiError}</span>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }}>
        {/* Left Side: Basic Info & Team */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent, #5c4af2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Basic Information
          </div>
          <Input label="Domain *" placeholder="domain.com" value={domain} onChange={setDomain} />
          <Input label="Project Name" placeholder="Auto-generated if left blank" value={name} onChange={setName} />
          <CountryTagInput
            label="Target Regions"
            tags={regions}
            onAdd={r => setRegions(p => [...p, r])}
            onRemove={r => setRegions(p => p.filter(x => x !== r))}
            placeholder="e.g. India, Singapore, USA"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Domain Authority" placeholder="e.g. 42" value={da} onChange={setDa} type="number" />
            <MultiSelect
              label="Platforms"
              options={platformOptions}
              selected={platforms}
              onToggle={togglePlatform}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Add Users</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Select
                placeholder="Type"
                value={userType}
                onChange={setUserType}
                options={[
                  { value: 'agency', label: 'Agency' },
                  { value: 'cxo', label: 'CXO' },
                  { value: 'project_head', label: 'Project Head' },
                  { value: 'team_member', label: 'Team Member' },
                ]}
              />
              <Input placeholder="User (Email ID)" value={userEmail} onChange={setUserEmail} type="email" />
            </div>
            <button onClick={addUser} style={{ alignSelf: 'flex-start', fontSize: 12.5, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 600, padding: '2px 0' }}>
              + Add another user
            </button>

            {users.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 100, overflowY: 'auto' }}>
                {users.map((u, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--surface-2)', borderRadius: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-light)', borderRadius: 99, padding: '2px 6px' }}>
                      {userTypeLabels[u.type] || u.type}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{u.email}</span>
                    <button onClick={() => removeUser(idx)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: NAP & Branding Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent, #5c4af2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            NAP & Branding
          </div>
          <Input label="Business Centre" placeholder="Business centre" value={napBusinessCentre} onChange={setNapBusinessCentre} />
          <Input label="Phone" placeholder="e.g. +1 234 567 8900" value={napPhone} onChange={setNapPhone} />
          <Input label="Website" placeholder="e.g. https://domain.com" value={napWebsite} onChange={setNapWebsite} />
          <Input label="Address" placeholder="Full business address" value={napAddress} onChange={setNapAddress} />
          <Input label="Email ID" placeholder="contact@domain.com" value={napEmail} onChange={setNapEmail} type="email" />
          <Input label="Branded Terms" placeholder="e.g. Brand1, Brand2" value={brandedTerms} onChange={setBrandedTerms} />
        </div>
      </div>

    </Modal>
  );
}

// ─── Add Pages Modal ─────────────────────────────────────────────────────────

function AddPagesModal({ open, onClose, projects, onImportPages, lockedProject, onCheckPrerequisites }) {
  const [project, setProject] = useState('');
  const [share, setShare] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleSelectProject = (slug) => {
    const proj = (projects || []).find(p => p.slug === slug);
    if (proj && onCheckPrerequisites && !onCheckPrerequisites(proj, 'Pages')) {
      onClose();
      return;
    }
    setProject(slug);
  };

  const projectOptions = projects
    .filter(p => p.name)
    .map(p => ({ value: p.slug, label: p.name }));

  const parseDelimited = (text, delimiter) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
      return { pageName: cols[0] || '', url: cols[1] || '', cluster: cols[2] || '', category: cols[3] || '' };
    }).filter(r => r.pageName || r.url);
  };

  const parseExcel = (buffer) => {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return rows.slice(1).map(cols => ({
      pageName: String(cols[0] ?? '').trim(),
      url: String(cols[1] ?? '').trim(),
      cluster: String(cols[2] ?? '').trim(),
      category: String(cols[3] ?? '').trim(),
    })).filter(r => r.pageName || r.url);
  };

  const handleFileUpload = (file) => {
    if (!file) return;
    setFileName(file.name);
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rows = parseExcel(e.target.result);
        setCsvRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const delimiter = ext === 'tsv' ? '\t' : ',';
        const rows = parseDelimited(e.target.result, delimiter);
        setCsvRows(rows);
      };
      reader.readAsText(file);
    }
  };

  const resetForm = () => {
    setProject('');
    setShare(false); setCsvRows([]); setFileName(''); setApiError('');
  };

  const downloadSampleTemplate = async () => {
    const headers = ['Page Name', 'URL', 'Cluster', 'Category'];
    const sampleRows = [
      ['ICSE Board Schools', 'https://example.com/icse-board-schools', 'ICSE Board', 'Icse vs cbse'],
      ['Best Schools in Bangalore', 'https://example.com/best-schools-bangalore', 'High School', 'Fees Structure'],
      ['Best Schools in Hyderabad', 'https://example.com/best-schools-hyderabad', 'CBSE School', 'Best/Top Schools'],
    ];

    const thinGrayBorder = { style: 'thin', color: { argb: 'FF999999' } };
    const cellBorder = { top: thinGrayBorder, left: thinGrayBorder, bottom: thinGrayBorder, right: thinGrayBorder };

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pages');
    sheet.columns = headers.map(h => ({ header: h, width: Math.max(14, h.length + 4) }));

    sheet.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C000' } };
      cell.font = { bold: true, color: { argb: 'FF000000' } };
      cell.border = cellBorder;
    });

    sampleRows.forEach(rowValues => {
      const row = sheet.addRow(rowValues);
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8C8C8' } };
        cell.border = cellBorder;
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pages-template.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const slug = lockedProject ? lockedProject.slug : project;
    if (!slug || csvRows.length === 0) return;

    setApiError('');
    setSubmitting(true);
    try {
      const matchedProject = lockedProject ? null : projects.find(p => p.slug === project);
      await onImportPages({
        slug,
        domain: lockedProject ? lockedProject.domain : matchedProject?.domain,
        name: lockedProject ? lockedProject.name : (matchedProject?.name || project),
        targetIndex: lockedProject ? lockedProject.index : undefined,
        pages: csvRows,
        share,
      });
      resetForm();
      onClose();
    } catch (err) {
      setApiError(err.message || 'Failed to import pages.');
    } finally {
      setSubmitting(false);
    }
  };

  const canImport = (lockedProject?.slug || project) && csvRows.length > 0 && !submitting;

  return (
    <Modal open={open} onClose={onClose} title="Add Pages"
      footer={<><Btn variant="primary" onClick={handleImport} style={canImport ? {} : { opacity: 0.5, pointerEvents: 'none' }}>{submitting ? 'Importing…' : 'Import Pages'}</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      {lockedProject ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Adding pages to <strong style={{ color: 'var(--text-primary)' }}>{lockedProject.name}</strong>
        </div>
      ) : (
        <Select
          label="Choose Project"
          placeholder="Select a project"
          value={project}
          onChange={handleSelectProject}
          options={projectOptions}
        />
      )}

      {apiError && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)', display: 'block', marginBottom: 12 }}>{apiError}</span>
      )}

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Import Pages section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Import Pages</span>
          <button
            type="button"
            onClick={downloadSampleTemplate}
            style={{ border: 'none', background: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: 0 }}
          >
            Download sample template
          </button>
        </div>
        <input
          type="file"
          accept=".csv,.tsv,.xls,.xlsx"
          id="csv-upload"
          style={{ display: 'none' }}
          onChange={e => { handleFileUpload(e.target.files[0]); e.target.value = ''; }}
        />
        <div
          style={{ border: `2px dashed ${fileName ? 'var(--accent)' : '#d1d5db'}`, borderRadius: 10, padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: fileName ? 'var(--accent-light)' : 'var(--surface-2)', cursor: 'pointer' }}
          onClick={() => document.getElementById('csv-upload').click()}
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = fileName ? 'var(--accent)' : '#d1d5db'; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; handleFileUpload(e.dataTransfer.files[0]); }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
          onMouseLeave={e => { if (!fileName) e.currentTarget.style.borderColor = '#d1d5db'; }}
        >
          {fileName ? (
            <>
              <Check size={20} color="var(--accent)" />
              <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{fileName}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{csvRows.length} page{csvRows.length !== 1 ? 's' : ''} found</span>
            </>
          ) : (
            <>
              <Upload size={20} color="var(--text-muted)" />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Click to upload or drag a file</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CSV, TSV, Excel · Columns: Page Name, URL, Cluster, Category</span>
            </>
          )}
        </div>
      </div>

    </Modal>
  );
}

// ─── Add Keywords Modal ──────────────────────────────────────────────────────

const CATEGORY_API_BASE = getApiBaseUrl();
function AddKeywordsModal({ open, onClose, projects, onImportKeywords, lockedProject }) {
  const [project, setProject] = useState('');
  const [share, setShare] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  const projectOptions = projects
    .filter(p => p.name)
    .map(p => ({ value: p.slug, label: p.name }));

  const toRow = (cols) => ({
    kw: String(cols[0] ?? '').trim(),
    sv: cols[1] !== undefined && cols[1] !== '' ? Number(cols[1]) || 0 : '',
    kwDiff: cols[2] !== undefined && cols[2] !== '' ? Number(cols[2]) || 0 : '',
    type: String(cols[3] ?? '').trim(),
    cluster: String(cols[4] ?? '').trim(),
    category: String(cols[5] ?? '').trim(),
    targetType: String(cols[6] ?? '').trim(),
    targetSubtype: String(cols[7] ?? '').trim(),
    targetGeo: String(cols[8] ?? '').trim(),
    priority: String(cols[9] ?? '').trim(),
    landingPage: String(cols[10] ?? '').trim(),
  });

  const parseDelimited = (text, delimiter) => {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    return lines.slice(1)
      .map(line => toRow(line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''))))
      .filter(r => r.kw);
  };

  const parseExcel = (buffer) => {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return rows.slice(1).map(toRow).filter(r => r.kw);
  };

  const handleFileUpload = (file) => {
    if (!file) return;
    setFileName(file.name);
    setApiError('');
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => setCsvRows(parseExcel(e.target.result));
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const delimiter = ext === 'tsv' ? '\t' : ',';
        setCsvRows(parseDelimited(e.target.result, delimiter));
      };
      reader.readAsText(file);
    }
  };

  const downloadSampleTemplate = async () => {
    const headers = ['KW', 'SV', 'KW Diff', 'Type', 'Cluster', 'Category', 'Target Type', 'Target Subtype', 'Target Geo', 'Priority', 'he'];
    const sampleRows = [
      ['school admission form', 14800, 20, 'Organic', 'ICSE Board', 'Icse vs cbse', 'Landing Page', 'Informational', 'India', 'P1', 'URL'],
      ['best schools in bangalore', 12100, 28, 'SERP', 'High School', 'Fees Structure', 'Landing Page', 'Commercial', 'India', 'P2', 'URL'],
      ['best schools in hyderabad', 12100, 24, 'Local', 'CBSE School', 'Best/Top Schools', 'Landing Page', 'Commercial', 'India', 'P3', 'URL'],
      ['schools in hyderabad', 12100, 33, 'Organic', 'ICSE Board', 'Icse vs cbse', 'Blog Page', 'Informational', 'India', 'P4', 'URL'],
    ];

    const thinGrayBorder = { style: 'thin', color: { argb: 'FF999999' } };
    const cellBorder = { top: thinGrayBorder, left: thinGrayBorder, bottom: thinGrayBorder, right: thinGrayBorder };

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Keywords');
    sheet.columns = headers.map(h => ({ header: h, width: Math.max(14, h.length + 4) }));

    sheet.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C000' } };
      cell.font = { bold: true, color: { argb: 'FF000000' } };
      cell.border = cellBorder;
    });

    sampleRows.forEach(rowValues => {
      const row = sheet.addRow(rowValues);
      row.eachCell((cell, colNumber) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colNumber === 1 ? 'FFD9B8B8' : 'FFC8C8C8' } };
        cell.border = cellBorder;
      });
      row.getCell(2).numFmt = '#,##0';
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'keywords-template.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    setProject(''); setShare(false); setCsvRows([]); setFileName(''); setApiError('');
  };

  const handleImport = async () => {
    const slug = lockedProject ? lockedProject.slug : project;
    if (!slug || csvRows.length === 0) return;

    setApiError('');
    setSubmitting(true);
    try {
      const matchedProject = lockedProject ? null : projects.find(p => p.slug === project);
      await onImportKeywords({
        slug,
        domain: lockedProject ? lockedProject.domain : matchedProject?.domain,
        name: lockedProject ? lockedProject.name : (matchedProject?.name || project),
        targetIndex: lockedProject ? lockedProject.index : undefined,
        keywords: csvRows,
        share,
      });
      resetForm();
      onClose();
    } catch (err) {
      setApiError(err.message || 'Failed to import keywords.');
    } finally {
      setSubmitting(false);
    }
  };

  const canImport = (lockedProject?.slug || project) && csvRows.length > 0 && !submitting;

  return (
    <Modal open={open} onClose={onClose} title="Add Keywords"
      footer={<><Btn variant="primary" onClick={handleImport} style={canImport ? {} : { opacity: 0.5, pointerEvents: 'none' }}>{submitting ? 'Importing…' : 'Import Keywords'}</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      {lockedProject ? (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Adding keywords to <strong style={{ color: 'var(--text-primary)' }}>{lockedProject.name}</strong>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <Select
            label="Choose Project"
            placeholder="Select a project"
            value={project}
            onChange={setProject}
            options={projectOptions}
          />
        </div>
      )}

      {apiError && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)', display: 'block', marginBottom: 12 }}>{apiError}</span>
      )}

      <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />

      {/* Import Keywords section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Import Keywords</span>
          <button
            type="button"
            onClick={downloadSampleTemplate}
            style={{ border: 'none', background: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: 0 }}
          >
            Download sample template
          </button>
        </div>
        <input
          type="file"
          accept=".csv,.tsv,.xls,.xlsx"
          id="kw-upload"
          style={{ display: 'none' }}
          onChange={e => { handleFileUpload(e.target.files[0]); e.target.value = ''; }}
        />
        <div
          style={{ border: `2px dashed ${fileName ? 'var(--accent)' : '#d1d5db'}`, borderRadius: 10, padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: fileName ? 'var(--accent-light)' : 'var(--surface-2)', cursor: 'pointer' }}
          onClick={() => document.getElementById('kw-upload').click()}
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = fileName ? 'var(--accent)' : '#d1d5db'; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; handleFileUpload(e.dataTransfer.files[0]); }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
          onMouseLeave={e => { if (!fileName) e.currentTarget.style.borderColor = '#d1d5db'; }}
        >
          {fileName ? (
            <>
              <Check size={20} color="var(--accent)" />
              <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{fileName}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{csvRows.length} keyword{csvRows.length !== 1 ? 's' : ''} found</span>
            </>
          ) : (
            <>
              <Upload size={20} color="var(--text-muted)" />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Click to upload or drag a file</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CSV, TSV, Excel · Columns: KW, SV, KW Diff, Type, Cluster, Category, Target Type, Target Subtype, Target Geo, Priority, Landing Page</span>
            </>
          )}
        </div>
      </div>

    </Modal>
  );
}

// ─── Add Competitors Modal ───────────────────────────────────────────────────

function ChooseProjectModal({ open, onClose, onApply, projects, mode = 'findCompetitors', onCheckPrerequisites }) {
  const [projectSlug, setProjectSlug] = useState('');
  const [treeData, setTreeData] = useState([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [selectedCategories, setSelectedCategories] = useState(new Set());

  const showTree = mode === 'findCompetitors';

  const handleSelectProjectSlug = (slug) => {
    const proj = (projects || []).find(p => p.slug === slug);
    if (proj && onCheckPrerequisites && !onCheckPrerequisites(proj, 'Competitors')) {
      handleClose();
      return;
    }
    setProjectSlug(slug);
  };

  useEffect(() => {
    if (!projectSlug || !showTree) {
      setTreeData([]);
      setSelectedCategories(new Set());
      setExpandedClusters(new Set());
      return;
    }

    let cancelled = false;
    setLoadingTree(true);
    fetchKeywordRows(projectSlug)
      .then(rows => {
        if (cancelled) return;
        const clusterMap = {};
        (rows || []).forEach(r => {
          const cluster = r.cluster || 'General';
          const cat = r.category || 'General';
          if (!clusterMap[cluster]) clusterMap[cluster] = new Set();
          if (cat) clusterMap[cluster].add(cat);
        });

        const formatted = Object.keys(clusterMap).map(cluster => ({
          cluster,
          categories: Array.from(clusterMap[cluster])
        }));

        setTreeData(formatted);
        setExpandedClusters(new Set());
        setSelectedCategories(new Set());
      })
      .catch(() => {
        if (!cancelled) setTreeData([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false);
      });

    return () => { cancelled = true; };
  }, [projectSlug, showTree]);

  const handleClose = () => {
    setProjectSlug('');
    setTreeData([]);
    setSelectedCategories(new Set());
    onClose();
  };

  const toggleClusterExpand = (clusterName) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterName)) next.delete(clusterName);
      else next.add(clusterName);
      return next;
    });
  };

  const toggleCategorySelect = (clusterName, catName) => {
    const key = `${clusterName}::${catName}`;
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleClusterSelect = (clusterObj) => {
    const clusterKeys = clusterObj.categories.map(c => `${clusterObj.cluster}::${c}`);
    const allSelected = clusterKeys.every(k => selectedCategories.has(k));

    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (allSelected) {
        clusterKeys.forEach(k => next.delete(k));
      } else {
        clusterKeys.forEach(k => next.add(k));
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedClusters(new Set(treeData.map(t => t.cluster)));
  };

  const handleCollapseAll = () => {
    setExpandedClusters(new Set());
  };

  const handleSelectAll = () => {
    const allKeys = new Set();
    treeData.forEach(t => t.categories.forEach(c => allKeys.add(`${t.cluster}::${c}`)));
    setSelectedCategories(allKeys);
  };

  const handleClearAll = () => {
    setSelectedCategories(new Set());
  };

  const handleApply = () => {
    const project = projects.find(p => p.slug === projectSlug);
    if (!project) return;

    if (onCheckPrerequisites && !onCheckPrerequisites(project, 'Competitors')) {
      handleClose();
      return;
    }

    if (showTree) {
      const chosenCategories = Array.from(selectedCategories).map(k => k.split('::')[1]);
      const chosenClusters = treeData
        .filter(t => t.categories.some(c => selectedCategories.has(`${t.cluster}::${c}`)))
        .map(t => t.cluster);
      onApply({ project, chosenClusters, chosenCategories });
    } else {
      onApply({ project });
    }
    handleClose();
  };

  const isApplyDisabled = !projectSlug || (showTree && selectedCategories.size === 0);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={showTree ? "Find Competitors" : "Choose Project"}
      footer={
        <>
          <Btn
            variant="primary"
            onClick={handleApply}
            style={isApplyDisabled ? { opacity: 0.5, pointerEvents: 'none' } : {}}
          >
            {showTree ? 'Apply Selection' : 'Apply'}
          </Btn>
          <Btn variant="outline" onClick={handleClose} style={{ flex: 'none', padding: '10px 28px' }}>
            Cancel
          </Btn>
        </>
      }
    >
      <Select
        label="Choose Project"
        placeholder={projects?.length ? 'Select a project' : 'No projects yet — add one in the Domain tab'}
        value={projectSlug}
        onChange={handleSelectProjectSlug}
        options={(projects || []).map(p => ({ value: p.slug, label: p.name || p.domain }))}
      />

      {showTree && projectSlug && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Select Clusters & Categories
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={expandedClusters.size === treeData.length ? handleCollapseAll : handleExpandAll}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                {expandedClusters.size === treeData.length ? 'Collapse All' : 'Expand All'}
              </button>
              <button
                type="button"
                onClick={selectedCategories.size > 0 ? handleClearAll : handleSelectAll}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                {selectedCategories.size > 0 ? 'Clear All' : 'Select All'}
              </button>
            </div>
          </div>

          {loadingTree ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Loading…
            </div>
          ) : treeData.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
              No clusters or categories found for this project.
            </div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', background: '#fafbfc' }}>
              {treeData.map(item => {
                const isExpanded = expandedClusters.has(item.cluster);
                const clusterKeys = item.categories.map(c => `${item.cluster}::${c}`);
                const selectedCount = clusterKeys.filter(k => selectedCategories.has(k)).length;
                const isAllSelected = selectedCount === item.categories.length && item.categories.length > 0;
                const isSomeSelected = selectedCount > 0 && !isAllSelected;

                return (
                  <div key={item.cluster} style={{ marginBottom: 6 }}>
                    {/* Cluster Parent Node */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <button
                        type="button"
                        onClick={() => toggleClusterExpand(item.cluster)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
                      >
                        <ChevronRight
                          size={14}
                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
                        />
                      </button>
                      <div
                        onClick={() => toggleClusterSelect(item)}
                        style={{
                          width: 16, height: 16, borderRadius: 3,
                          border: isAllSelected || isSomeSelected ? '1.5px solid var(--accent)' : '1.5px solid #d1d5db',
                          background: isAllSelected ? 'var(--accent)' : isSomeSelected ? 'var(--accent)' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', flexShrink: 0
                        }}
                      >
                        {isAllSelected && <Check size={10} color="#fff" strokeWidth={3} />}
                        {isSomeSelected && <span style={{ width: 6, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />}
                      </div>
                      <span
                        onClick={() => toggleClusterExpand(item.cluster)}
                        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}
                      >
                        {item.cluster} ({item.categories.length})
                      </span>
                    </div>

                    {/* Category Child Nodes */}
                    {isExpanded && (
                      <div style={{ marginLeft: 28, borderLeft: '1px dashed #e2e8f0', paddingLeft: 10, marginTop: 2 }}>
                        {item.categories.map(cat => {
                          const key = `${item.cluster}::${cat}`;
                          const isCatSelected = selectedCategories.has(key);

                          return (
                            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                              <div
                                onClick={() => toggleCategorySelect(item.cluster, cat)}
                                style={{
                                  width: 14, height: 14, borderRadius: 3,
                                  border: isCatSelected ? '1.5px solid var(--accent)' : '1.5px solid #d1d5db',
                                  background: isCatSelected ? 'var(--accent)' : '#fff',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  cursor: 'pointer', flexShrink: 0
                                }}
                              >
                                {isCatSelected && <Check size={9} color="#fff" strokeWidth={3} />}
                              </div>
                              <span
                                onClick={() => toggleCategorySelect(item.cluster, cat)}
                                style={{ fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer' }}
                              >
                                {cat}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Table rows data ─────────────────────────────────────────────────────────

const ALL_PLATFORMS = ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'];

const PLATFORM_BADGE_STYLES = {
  'AI Mode': { bg: '#ede9fe', color: '#7c3aed' },
  'AI Overview': { bg: '#dbeafe', color: '#1d4ed8' },
  'Google': { bg: '#fef9c3', color: '#854d0e' },
  'ChatGPT': { bg: '#dcfce7', color: '#166534' },
  'Gemini': { bg: '#fce7f3', color: '#9d174d' },
};

const DeviceIcon = ({ type }) => {
  if (type === 'desktop') return <Monitor size={14} color="#5a6478" />;
  if (type === 'ai') return <span style={{ fontSize: 13 }}>✦</span>;
  if (type === 'google') return <span style={{ fontSize: 13, color: '#4285F4', fontWeight: 700 }}>G</span>;
  return <Globe size={14} color="#5a6478" />;
};

// ─── Tab configurations ───────────────────────────────────────────────────────

const TABS = ['Domain', 'Intent', 'Pages', 'Competitors', 'Outreach', 'Connectors'];

const platformOptionsList = [
  { value: 'AI Mode', label: 'AI Mode' },
  { value: 'AI Overview', label: 'AI Overview' },
  { value: 'Google', label: 'Google' },
  { value: 'ChatGPT', label: 'ChatGPT' },
  { value: 'Gemini', label: 'Gemini' },
];

function EditDomainModal({ open, onClose, project, onSave, onDelete }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [platforms, setPlatforms] = useState([]);
  const [da, setDa] = useState('');
  const [traffic, setTraffic] = useState('');
  const [status, setStatus] = useState('Active');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setLocation(project.location || '');
      setPlatforms(project.targetPlatforms || ALL_PLATFORMS);
      setDa(project.da ?? '');
      setTraffic(project.traffic ?? '');
      setStatus(project.status || (project.isActive ? 'Active' : 'Inactive'));
      setConfirmDelete(false);
      setSubmitting(false);
      setApiError('');
    }
  }, [project]);

  if (!open) return null;

  const togglePlatform = (v) => setPlatforms(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const handleClose = () => { setConfirmDelete(false); onClose(); };

  const handleSave = async () => {
    setSubmitting(true);
    setApiError('');
    try {
      await onSave({
        name: name.trim() || project?.name,
        location,
        targetPlatforms: platforms,
        da: da !== '' ? Number(da) : null,
        traffic: traffic !== '' ? Number(traffic) : 0,
        status,
        isActive: status === 'Active',
      });
      handleClose();
    } catch (err) {
      setSubmitting(false);
      setApiError(err.message || 'Failed to save project.');
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    setApiError('');
    try {
      await onDelete?.();
      handleClose();
    } catch (err) {
      setSubmitting(false);
      setApiError(err.message || 'Failed to delete project.');
    }
  };

  if (confirmDelete) {
    return (
      <Modal open={open} onClose={handleClose} title="Delete Project"
        footer={<>
          <Btn variant="primary" onClick={handleDelete} style={submitting ? { background: 'var(--red)', opacity: 0.6, pointerEvents: 'none' } : { background: 'var(--red)' }}>{submitting ? 'Deleting…' : 'Delete'}</Btn>
          <Btn variant="outline" onClick={() => setConfirmDelete(false)} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
        </>}
      >
        {apiError && (
          <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{apiError}</span>
        )}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Are you sure you want to delete <strong>{project?.name || project?.domain}</strong>? This action cannot be undone.
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Edit Project"
      footer={<>
        <Btn variant="primary" onClick={handleSave} style={submitting ? { opacity: 0.6, pointerEvents: 'none' } : {}}>{submitting ? 'Saving…' : 'Save'}</Btn>
        <Btn variant="outline" onClick={handleClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
        <Btn variant="outline" onClick={() => setConfirmDelete(true)} style={{ flex: 'none', padding: '10px 16px', border: '1.5px solid var(--red)', color: 'var(--red)' }}>Delete</Btn>
      </>}
    >
      {apiError && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{apiError}</span>
      )}
      <Input label="Project Name" placeholder="e.g. OWIS Singapore" value={name} onChange={setName} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Domain</span>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, border: '1.5px solid var(--border)' }}>
          {project?.domain}
        </div>
      </div>

      <Select
        label="Location"
        placeholder="Select a location"
        value={location}
        onChange={setLocation}
        options={COUNTRIES}
      />

      <MultiSelect
        label="Target Platforms"
        options={platformOptionsList}
        selected={platforms}
        onToggle={togglePlatform}
      />

      <Input label="Domain Authority" placeholder="e.g. 42" value={da} onChange={setDa} type="number" />
      <Input label="Traffic" placeholder="e.g. 44.29" value={traffic} onChange={setTraffic} type="number" />

      <Select
        label="Status"
        placeholder="Select status"
        value={status}
        onChange={setStatus}
        options={['Active', 'Inactive']}
      />
    </Modal>
  );
}

function DomainTab({ projects, filter, domainFilters, onUpdateProject, onDeleteProject, loading, error, search, user }) {
  const userCanEdit = canEdit(user);
  const userCanDelete = canDelete(user);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [editingProject, setEditingProject] = useState(null);

  const toggleRow = (i) => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const visibleProjects = projects.filter(p => {
    if (!p.domain || !String(p.domain).trim()) return false;

    // Platform filter (from filter pills or dropdown)
    const activePlat = filter || domainFilters?.platform;
    if (activePlat) {
      const projPlats = (p.targetPlatforms || p.platforms || ALL_PLATFORMS).map(x => String(x).toLowerCase());
      if (!projPlats.includes(String(activePlat).toLowerCase())) return false;
    }

    // Location filter
    if (domainFilters?.location) {
      const locTarget = String(domainFilters.location).toLowerCase();
      const projLoc = String(p.location || '').toLowerCase();
      const projRegs = (p.regions || p.target_regions || []).map(x => String(x).toLowerCase());
      if (projLoc !== locTarget && !projRegs.includes(locTarget)) return false;
    }

    // DA range filter
    const projDa = p.da !== null && p.da !== undefined && p.da !== '' ? Number(p.da) : NaN;
    if (domainFilters?.daMin !== '' && domainFilters?.daMin != null) {
      if (isNaN(projDa) || projDa < Number(domainFilters.daMin)) return false;
    }
    if (domainFilters?.daMax !== '' && domainFilters?.daMax != null) {
      if (isNaN(projDa) || projDa > Number(domainFilters.daMax)) return false;
    }

    // Traffic range filter
    const projTraffic = p.traffic !== null && p.traffic !== undefined && p.traffic !== '' ? Number(p.traffic) : NaN;
    if (domainFilters?.trafficMin !== '' && domainFilters?.trafficMin != null) {
      if (isNaN(projTraffic) || projTraffic < Number(domainFilters.trafficMin)) return false;
    }
    if (domainFilters?.trafficMax !== '' && domainFilters?.trafficMax != null) {
      if (isNaN(projTraffic) || projTraffic > Number(domainFilters.trafficMax)) return false;
    }

    // Keywords range filter
    const projKw = p.keywords !== null && p.keywords !== undefined && p.keywords !== '' ? Number(p.keywords) : NaN;
    if (domainFilters?.keywordsMin !== '' && domainFilters?.keywordsMin != null) {
      if (isNaN(projKw) || projKw < Number(domainFilters.keywordsMin)) return false;
    }
    if (domainFilters?.keywordsMax !== '' && domainFilters?.keywordsMax != null) {
      if (isNaN(projKw) || projKw > Number(domainFilters.keywordsMax)) return false;
    }

    // Target Pages range filter
    const projTarget = p.targetPages !== null && p.targetPages !== undefined && p.targetPages !== '' ? Number(p.targetPages) : NaN;
    if (domainFilters?.targetPagesMin !== '' && domainFilters?.targetPagesMin != null) {
      if (isNaN(projTarget) || projTarget < Number(domainFilters.targetPagesMin)) return false;
    }
    if (domainFilters?.targetPagesMax !== '' && domainFilters?.targetPagesMax != null) {
      if (isNaN(projTarget) || projTarget > Number(domainFilters.targetPagesMax)) return false;
    }

    // Blog Pages range filter
    const projBlog = p.blogPages !== null && p.blogPages !== undefined && p.blogPages !== '' ? Number(p.blogPages) : NaN;
    if (domainFilters?.blogPagesMin !== '' && domainFilters?.blogPagesMin != null) {
      if (isNaN(projBlog) || projBlog < Number(domainFilters.blogPagesMin)) return false;
    }
    if (domainFilters?.blogPagesMax !== '' && domainFilters?.blogPagesMax != null) {
      if (isNaN(projBlog) || projBlog > Number(domainFilters.blogPagesMax)) return false;
    }

    // Search query
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      const n = (p.name || '').toLowerCase();
      const d = (p.domain || '').toLowerCase();
      if (!n.includes(q) && !d.includes(q)) return false;
    }
    return true;
  });

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
              {['Project', 'Location', 'Target Platforms', 'DA', 'Traffic', 'Keywords', 'Target Pages', 'Blog Pages', 'Status', 'Updated', ''].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: i <= 2 ? 'left' : 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>
                  {h === 'Project' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Project <span style={{ fontSize: 10 }}>⇅</span></div>
                  ) : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading projects…</td></tr>
            ) : error ? (
              <tr><td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
            ) : visibleProjects.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No projects yet. Click <strong>+ Create project</strong> to get started.</td></tr>
            ) : visibleProjects.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '14px 16px' }}>
                  {p.name && <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)', marginBottom: 2 }}>{p.name}</div>}
                  {p.domain && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.domain}</div>}
                  {p.name && <div style={{ marginTop: 4 }}><span style={{ fontSize: 18, color: 'var(--border)' }}></span></div>}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}>
                    <DeviceIcon type={p.locationIcon} />
                    {p.location}
                  </div>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {(() => {
                      const platforms = p.targetPlatforms || ALL_PLATFORMS;
                      const isExpanded = expandedRows.has(i);
                      const visible = isExpanded ? platforms : platforms.slice(0, 1);
                      const hiddenCount = platforms.length - 1;
                      return (
                        <>
                          {visible.map(platform => {
                            const s = PLATFORM_BADGE_STYLES[platform] || { bg: '#f3f4f6', color: '#374151' };
                            return (
                              <span key={platform} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
                                {platform}
                              </span>
                            );
                          })}
                          {hiddenCount > 0 && (
                            <button
                              onClick={() => toggleRow(i)}
                              style={{
                                fontSize: 11, fontWeight: 600,
                                color: 'var(--text-muted)',
                                background: '#f3f4f6',
                                border: '1px solid var(--border)',
                                borderRadius: 12,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.15s',
                              }}
                            >
                              {isExpanded ? '×' : `+${hiddenCount}`}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>—</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>{p.traffic}</span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: p.keywordsDir === 'up' ? 'var(--green)' : p.keywordsDir === 'down' ? 'var(--red)' : 'var(--text-primary)' }}>
                    {p.keywordsDir === 'up' ? '↑' : p.keywordsDir === 'down' ? '↓' : ''}{p.keywords}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: p.targetDir === 'down' ? 'var(--red)' : p.targetDir === 'up' ? 'var(--green)' : 'var(--text-muted)' }}>
                    {p.targetDir === 'down' ? '↓' : p.targetDir === 'up' ? '↑' : ''}{p.targetPages}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{p.blogPages}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentSt = p.status || 'Active';
                      const nextStatus = currentSt === 'Active' ? 'Inactive' : 'Active';
                      onUpdateProject?.(p, { status: nextStatus, isActive: nextStatus === 'Active' });
                    }}
                    title="Click to toggle Active/Inactive"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 11.5,
                      fontWeight: 700,
                      border: (p.status || 'Active') === 'Inactive' ? '1px solid #cbd5e1' : '1px solid #a7f3d0',
                      background: (p.status || 'Active') === 'Inactive' ? '#f1f5f9' : '#ecfdf5',
                      color: (p.status || 'Active') === 'Inactive' ? '#64748b' : '#047857',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: (p.status || 'Active') === 'Inactive' ? '#94a3b8' : '#10b981'
                    }} />
                    {p.status || 'Active'}
                  </button>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.updated}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  {userCanEdit && (
                    <button
                      onClick={() => setEditingProject(p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <Edit2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EditDomainModal
        open={editingProject !== null}
        onClose={() => setEditingProject(null)}
        project={editingProject}
        onSave={(updates) => onUpdateProject?.(editingProject, updates)}
        onDelete={() => onDeleteProject?.(editingProject)}
      />
    </>
  );
}
function PagesTab({ pages, onSelectProject, onDeleteProject, loading, error, totalLabel = 'Total  Pages', keywordsLabel = 'Keywords', deleteScopeLabel = 'the project and all its keywords', search, user }) {
  const userCanDelete = canDelete(user);
  const [confirmingProject, setConfirmingProject] = useState(null);

  const handleConfirmDelete = async () => {
    await onDeleteProject?.(confirmingProject);
  };

  const visiblePages = search && search.trim()
    ? pages.filter(p => {
      const q = search.trim().toLowerCase();
      const n = (p.name || '').toLowerCase();
      const d = (p.domain || '').toLowerCase();
      return n.includes(q) || d.includes(q);
    })
    : pages;

  return (
    <>
      <DeleteProjectDataModal
        open={confirmingProject !== null}
        onClose={() => setConfirmingProject(null)}
        project={confirmingProject}
        scopeLabel={deleteScopeLabel}
        onConfirm={handleConfirmDelete}
      />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'Project', align: 'left' },
                { label: 'Location', align: 'left' },
                { label: totalLabel, align: 'right' },
                { label: 'Commercial vs Others', align: 'right' },
                { label: 'Blog Pages', align: 'right' },
                { label: keywordsLabel, align: 'right' },
                { label: 'Updated', align: 'right' },
                { label: '', align: 'right' },
              ].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: h.align, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>
                  {h.label === 'Project'
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Project <span style={{ fontSize: 10 }}>⇅</span></div>
                    : h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</td></tr>
            ) : error ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
            ) : visiblePages.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No projects yet.</td></tr>
            ) : visiblePages.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '14px 16px' }}>
                  {p.name && (
                    <div onClick={() => onSelectProject(i)} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)', marginBottom: 2, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                      {p.name}
                    </div>
                  )}
                  {p.domain && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.domain}</div>}
                  {p.name && <div style={{ marginTop: 4, fontSize: 16, color: 'var(--border)' }}></div>}
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}>
                    <DeviceIcon type={p.locationIcon} />
                    {p.location}
                  </div>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 13 }}>{p.totalKw ?? p.totalPages ?? ''}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}>{p.commercialPct}</span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: p.blogDir === 'up' ? 'var(--green)' : 'var(--text-muted)' }}>
                    {p.blogDir === 'up' ? '↑' : ''}{p.blogPages}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: p.keywordsDir === 'down' ? 'var(--red)' : 'var(--text-muted)' }}>
                    {p.keywordsDir === 'down' ? `↓${p.targetPages ?? p.keywords}` : (p.targetPages ?? p.keywords)}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.updated}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  {onDeleteProject && userCanDelete && (
                    <button
                      onClick={() => setConfirmingProject(p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--red)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function EditPageModal({ open, onClose, page, onSave }) {
  const [pageName, setPageName] = useState('');
  const [regions, setRegions] = useState([]);
  const [da, setDa] = useState('');

  if (!open) return null;

  const initRegions = page?.region ? [page.region] : [];

  return (
    <Modal open={open} onClose={onClose} title="Edit Page"
      footer={
        <>
          <Btn variant="primary" onClick={() => { onSave({ pageName: pageName || page?.pageName, regions, da: da !== '' ? Number(da) : null }); onClose(); }}>Save</Btn>
          <Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
        </>
      }
    >
      <Input label="Page Name" placeholder="e.g. OWIS Admissions" value={pageName || page?.pageName || ''} onChange={setPageName} />
      <CountryTagInput
        label="Target Regions"
        tags={regions.length > 0 ? regions : initRegions}
        onAdd={r => setRegions(prev => [...(prev.length > 0 ? prev : initRegions), r])}
        onRemove={r => setRegions(prev => (prev.length > 0 ? prev : initRegions).filter(x => x !== r))}
        placeholder="e.g. India, Singapore, USA"
      />
      <Input label="DA" placeholder="e.g. 42" value={da !== '' ? da : (page?.da ?? '')} onChange={setDa} />
    </Modal>
  );
}

const PAGE_BULK_FIELDS = [
  { value: 'cluster', label: 'Cluster', type: 'text' },
  { value: 'category', label: 'Category', type: 'text' },
  { value: 'targetCategory', label: 'Target Type', type: 'select', options: ['Blogs', 'Landing Page'] },
  { value: 'targetType', label: 'Target Subtype', type: 'select', options: ['Commercial', 'Informational'] },
];

const KW_BULK_FIELDS = [
  { value: 'cluster', label: 'Cluster', type: 'text' },
  { value: 'category', label: 'Category', type: 'text' },
  { value: 'type', label: 'Type', type: 'select', options: ['AI Overview', 'Google', 'ChatGPT', 'Gemini'] },
  { value: 'targetType', label: 'Target Type', type: 'select', options: ['Blogs', 'Landing Page', 'Topical Blogs'] },
  { value: 'targetSubtype', label: 'Target Subtype', type: 'select', options: ['Informational', 'Commercial'] },
  { value: 'targetGeo', label: 'Target Geo', type: 'text' },
  { value: 'priority', label: 'Priority', type: 'select', options: ['P1', 'P2', 'P3', 'P4', 'P5'] },
  { value: 'landingPage', label: 'Landing Page (URL)', type: 'text' },
];

const COMPETITOR_BULK_FIELDS = [
  { value: 'name', label: 'Name', type: 'text' },
  { value: 'da', label: 'DA', type: 'text' },
  { value: 'type', label: 'Type', type: 'select', options: ['Official Entity', 'Listing'] },
];

function BulkEditModal({ open, onClose, count, onApply, fields, itemLabel = 'page' }) {
  const [field, setField] = useState('');
  const [value, setValue] = useState('');

  const FIELDS = fields || PAGE_BULK_FIELDS;
  const selectedField = FIELDS.find(f => f.value === field);

  const handleApply = () => {
    if (!field || !value) return;
    onApply(field, value);
    setField('');
    setValue('');
    onClose();
  };

  return (
    <Modal open={open} onClose={() => { onClose(); setField(''); setValue(''); }} title="Bulk Edit"
      footer={<><Btn variant="primary" onClick={handleApply}>Apply to {count} {itemLabel}{count !== 1 ? 's' : ''}</Btn><Btn variant="outline" onClick={() => { onClose(); setField(''); setValue(''); }} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
        Editing <strong>{count}</strong> selected {itemLabel}{count !== 1 ? 's' : ''}
      </div>

      <Select
        label="Field to edit"
        placeholder="Choose a field"
        value={field}
        onChange={v => { setField(v); setValue(''); }}
        options={FIELDS.map(f => ({ value: f.value, label: f.label }))}
      />

      {field && selectedField?.type === 'text' && (
        <Input label="New value" placeholder={`Enter new ${selectedField.label.toLowerCase()}`} value={value} onChange={setValue} />
      )}

      {field && selectedField?.type === 'select' && (
        <Select
          label="New value"
          placeholder={`Choose ${selectedField.label.toLowerCase()}`}
          value={value}
          onChange={setValue}
          options={selectedField.options.map(o => ({ value: o, label: o }))}
        />
      )}
    </Modal>
  );
}

function DeleteProjectDataModal({ open, onClose, project, scopeLabel, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleClose = () => { setDeleting(false); setError(''); onClose(); };

  const handleConfirm = async () => {
    setDeleting(true);
    setError('');
    try {
      await onConfirm();
      handleClose();
    } catch (err) {
      setDeleting(false);
      setError(err.message || 'Failed to delete.');
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Confirm delete"
      footer={<>
        <Btn variant="primary" onClick={handleConfirm} style={deleting ? { background: 'var(--red)', opacity: 0.6, pointerEvents: 'none' } : { background: 'var(--red)' }}>{deleting ? 'Deleting…' : 'Delete'}</Btn>
        <Btn variant="outline" onClick={handleClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
      </>}
    >
      {error && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{error}</span>
      )}
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Are you sure you want to delete <strong>{scopeLabel}</strong> for <strong>{project?.name || project?.domain}</strong>? This action cannot be undone.
      </div>
    </Modal>
  );
}

function RecclusterConfirmModal({ open, onClose, onConfirm }) {
  return (
    <Modal open={open} onClose={onClose} title="Already clustered"
      footer={<><Btn variant="primary" onClick={() => { onConfirm(); onClose(); }}>Re-cluster</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        It is already clustered, do you want to re-cluster?
      </div>
    </Modal>
  );
}

function RefindCompetitorsConfirmModal({ open, onClose, projectName, onConfirm }) {
  return (
    <Modal open={open} onClose={onClose} title="Competitors already found"
      footer={<><Btn variant="primary" onClick={() => { onConfirm(); onClose(); }}>Re-run search</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Competitors have already been found for <strong>{projectName}</strong>. Re-run the search to refresh their rankings?
      </div>
    </Modal>
  );
}

function BulkDeleteModal({ open, onClose, count, onConfirm, itemLabel = 'page' }) {
  return (
    <Modal open={open} onClose={onClose} title="Confirm Delete"
      footer={<><Btn variant="primary" onClick={() => { onConfirm(); onClose(); }} style={{ background: 'var(--red)' }}>Delete {count} {itemLabel}{count !== 1 ? 's' : ''}</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Are you sure you want to delete <strong>{count}</strong> selected {itemLabel}{count !== 1 ? 's' : ''}? This action cannot be undone.
      </div>
    </Modal>
  );
}

function ActionsDropdown({ selectedCount, onBulkEdit, onBulkDelete }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const updatePos = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  };

  const toggleOpen = () => {
    if (!open) updatePos();
    setOpen(p => !p);
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    document.addEventListener('mousedown', handler);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
      document.removeEventListener('mousedown', handler);
    };
  }, [open]);

  if (selectedCount === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: '#0f1523', color: '#fff', border: 'none', borderRadius: 8,
          padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        Actions ({selectedCount})
        <ChevronDown size={13} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)', minWidth: 160, overflow: 'hidden',
          }}
        >
          {onBulkEdit && (
            <button
              onClick={() => { setOpen(false); onBulkEdit(); }}
              style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text-primary)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Edit2 size={14} color="var(--text-muted)" /> Bulk Edit
            </button>
          )}
          {onBulkEdit && onBulkDelete && <div style={{ height: 1, background: 'var(--border)' }} />}
          {onBulkDelete && (
            <button
              onClick={() => { setOpen(false); onBulkDelete(); }}
              style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--red)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Trash2 size={14} /> Bulk Delete
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function HeaderQuickSelect({ placeholder, options, onSet, value }) {
  const isControlled = value !== undefined;
  return (
    <select value={isControlled ? value : ''} onChange={e => { if (isControlled || e.target.value) onSet(e.target.value); }}
      style={{ appearance: 'none', border: isControlled && value ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 6, padding: '5px 28px 5px 10px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', color: isControlled && value ? 'var(--accent)' : 'var(--text-muted)', background: `#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center`, cursor: 'pointer', outline: 'none', minWidth: 130, letterSpacing: '0.3px' }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function PageDetailView({ project, onBack, onUpdatePages, user }) {
  const userCanEdit = canEdit(user);
  const userCanDelete = canDelete(user);
  const userCanDownload = canDownload(user);
  const [rows, setRows] = useState(project.detailPages || []);
  const loading = project.detailPages === undefined;
  const error = project.detailPagesError || '';
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState(new Map());
  const [pendingDeleteIds, setPendingDeleteIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const hasPendingChanges = pendingUpdates.size > 0 || pendingDeleteIds.size > 0;

  const [tableFilters, setTableFilters] = useState({
    cluster: [],
    category: [],
    targetCategory: [],
    targetType: [],
  });

  const filterConfigs = [
    { key: 'cluster', label: 'Cluster', type: 'select' },
    { key: 'category', label: 'Category', type: 'select' },
    { key: 'targetCategory', label: 'Target Type', type: 'select', options: ['Blogs', 'Landing Page'] },
    { key: 'targetType', label: 'Target Subtype', type: 'select', options: ['Commercial', 'Informational'] },
  ];

  const filteredRows = rows.filter(r => {
    if (tableFilters.cluster?.length && !tableFilters.cluster.includes(r.cluster)) return false;
    if (tableFilters.category?.length && !tableFilters.category.includes(r.category)) return false;
    if (tableFilters.targetCategory?.length && !tableFilters.targetCategory.includes(r.targetCategory)) return false;
    if (tableFilters.targetType?.length && !tableFilters.targetType.includes(r.targetType)) return false;
    return true;
  });

  useEffect(() => {
    setRows(project.detailPages || []);
    setPendingUpdates(new Map());
    setPendingDeleteIds(new Set());
    setSaveError('');
  }, [project]);

  const allSelected = rows.length > 0 && selectedRows.size === rows.length;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rows.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map((_, i) => i)));
    }
  };

  const toggleRow = (idx) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const stageUpdates = (ids, field, value) => {
    setPendingUpdates(prev => {
      const next = new Map(prev);
      ids.forEach(id => next.set(id, { ...(next.get(id) || {}), [field]: value }));
      return next;
    });
  };

  const updateRow = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    stageUpdates([rows[idx].id], field, value);
  };

  const deleteRow = (idx) => {
    const id = rows[idx].id;
    setPendingDeleteIds(prev => new Set(prev).add(id));
    setPendingUpdates(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next; });
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const bulkUpdate = (field, value) => {
    stageUpdates(rows.map(r => r.id), field, value);
    setRows(prev => prev.map(r => ({ ...r, [field]: value })));
  };

  const handleBulkEditApply = (field, value) => {
    stageUpdates(rows.filter((_, i) => selectedRows.has(i)).map(r => r.id), field, value);
    setRows(prev => prev.map((r, i) => selectedRows.has(i) ? { ...r, [field]: value } : r));
    setSelectedRows(new Set());
  };

  const handleBulkDelete = () => {
    const ids = rows.filter((_, i) => selectedRows.has(i)).map(r => r.id);
    setPendingDeleteIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    setPendingUpdates(prev => { const next = new Map(prev); ids.forEach(id => next.delete(id)); return next; });
    setRows(prev => prev.filter((_, i) => !selectedRows.has(i)));
    setSelectedRows(new Set());
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (pendingDeleteIds.size > 0) {
        await bulkDeletePageRows(Array.from(pendingDeleteIds));
      }
      await Promise.all(Array.from(pendingUpdates.entries()).map(([id, updates]) => updatePageRow(id, updates)));
      setPendingUpdates(new Map());
      setPendingDeleteIds(new Set());
      onUpdatePages(rows);
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    if (hasPendingChanges && !window.confirm('You have unsaved changes. Discard them and refresh?')) return;
    setRefreshing(true);
    setSaveError('');
    try {
      const freshRows = await fetchPageRows(project.slug);
      setRows(freshRows);
      setPendingUpdates(new Map());
      setPendingDeleteIds(new Set());
      onUpdatePages(freshRows);
    } catch (err) {
      setSaveError(err.message || 'Failed to refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const AUTO_REFRESH_MS = 10000;
    const interval = setInterval(() => {
      if (refreshing || saving || hasPendingChanges) return;
      fetchPageRows(project.slug)
        .then(freshRows => { setRows(freshRows); onUpdatePages(freshRows); })
        .catch(() => { });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [project.slug, refreshing, saving, hasPendingChanges]);

  const handleBackClick = () => {
    if (hasPendingChanges && !window.confirm('You have unsaved changes. Discard them?')) return;
    onBack();
  };

  return (
    <div>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleBackClick} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 0', fontFamily: 'var(--font-body)', fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ height: 20, width: 1, background: 'var(--border)' }} />
        <div>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{project.name}</span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: 6, padding: 4,
            cursor: refreshing ? 'default' : 'pointer', color: 'var(--text-muted)',
          }}
          onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} />
        </button>
        <TableFilterDropdown
          filters={filterConfigs}
          rows={rows}
          activeFilters={tableFilters}
          onFiltersChange={setTableFilters}
        />
        {userCanEdit && (
          <ActionsDropdown
            selectedCount={selectedRows.size}
            onBulkEdit={() => setShowBulkEdit(true)}
            onBulkDelete={() => setShowBulkDelete(true)}
          />
        )}
        {userCanDownload && (
          <button
            onClick={() => downloadCSV(`${project?.name || 'pages'}_detail`, filteredRows)}
            title="Download CSV"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '7px 10px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <Download size={14} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        {saveError && (
          <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{saveError}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{filteredRows.length} page{filteredRows.length !== 1 ? 's' : ''}</span>
        {(hasPendingChanges || saving) && (
          <button
            onClick={handleSave}
            disabled={!hasPendingChanges || saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#0f1523', color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '7px 16px', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              fontFamily: 'var(--font-body)', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>

      <BulkEditModal open={showBulkEdit} onClose={() => setShowBulkEdit(false)} count={selectedRows.size} onApply={handleBulkEditApply} fields={PAGE_BULK_FIELDS} />
      <BulkDeleteModal open={showBulkDelete} onClose={() => setShowBulkDelete(false)} count={selectedRows.size} onConfirm={handleBulkDelete} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                <div
                  onClick={toggleAll}
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: allSelected || someSelected ? '2px solid var(--accent)' : '2px solid #d1d5db',
                    background: allSelected ? 'var(--accent)' : someSelected ? 'var(--accent)' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                  }}
                >
                  {allSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                  {someSelected && <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />}
                </div>
              </th>
              {['Page Name', 'URL', 'Cluster', 'Category'].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h}</th>
              ))}
              <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                <HeaderQuickSelect placeholder="Target Type" options={['Blogs', 'Landing Page']} onSet={v => bulkUpdate('targetCategory', v)} />
              </th>
              <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                <HeaderQuickSelect placeholder="Target Subtype" options={['Commercial', 'Informational']} onSet={v => bulkUpdate('targetType', v)} />
              </th>
              <th style={{ padding: '10px 16px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading pages…</td></tr>
            ) : error ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pages added yet. Use Add Pages to import.</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pages match the selected filters.</td></tr>
            ) : filteredRows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                  <div
                    onClick={() => toggleRow(i)}
                    style={{
                      width: 18, height: 18, borderRadius: 4,
                      border: selectedRows.has(i) ? '2px solid var(--accent)' : '2px solid #d1d5db',
                      background: selectedRows.has(i) ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                    }}
                  >
                    {selectedRows.has(i) && <Check size={11} color="#fff" strokeWidth={3} />}
                  </div>
                </td>
                <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', maxWidth: 200 }}>{r.pageName}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--accent)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.cluster}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.category}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetCategory ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetCategory || '—'}</td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetType ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetType || '—'}</td>
                <td style={{ padding: '10px 16px' }}>
                  {userCanDelete && (
                    <button onClick={() => deleteRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--red)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const KW_PAGE_SIZE = 100;

function KwClusterDetailView({ project, onBack, onUpdateKeywords, search, user }) {
  const userCanEdit = canEdit(user);
  const userCanDelete = canDelete(user);
  const userCanDownload = canDownload(user);
  const userCanUpdate = canUpdate(user);
  const [rows, setRows] = useState(project.detailKeywords || []);
  const loading = project.detailKeywords === undefined;
  const error = project.detailKeywordsError || '';
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [page, setPage] = useState(1);
  const [pendingUpdates, setPendingUpdates] = useState(new Map());
  const [pendingDeleteIds, setPendingDeleteIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const hasPendingChanges = pendingUpdates.size > 0 || pendingDeleteIds.size > 0;

  const [showExcludeDropdown, setShowExcludeDropdown] = useState(false);
  const [excludePos, setExcludePos] = useState({ top: 0, right: 0 });
  const excludeBtnRef = useRef(null);
  const excludePanelRef = useRef(null);

  useEffect(() => {
    if (!showExcludeDropdown) return;
    const updatePos = () => {
      if (!excludeBtnRef.current) return;
      const rect = excludeBtnRef.current.getBoundingClientRect();
      setExcludePos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    const handleClickOutside = (e) => {
      if (
        excludeBtnRef.current && !excludeBtnRef.current.contains(e.target) &&
        excludePanelRef.current && !excludePanelRef.current.contains(e.target)
      ) {
        setShowExcludeDropdown(false);
      }
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExcludeDropdown]);

  const [excludeConfig, setExcludeConfig] = useState({
    kwChecked: false, kwVals: [],
    svChecked: false, svMin: '', svMax: '',
    kwDiffChecked: false, kwDiffMin: '', kwDiffMax: '',
    rankChecked: false, rankMin: '', rankMax: '',
    typeChecked: false, typeVals: [],
    targetTypeChecked: false, targetTypeVals: [],
    targetSubtypeChecked: false, targetSubtypeVals: [],
    targetGeoChecked: false, targetGeoVals: [],
    priorityChecked: false, priorityVals: []
  });

  const [tableFilters, setTableFilters] = useState({
    cluster: [],
    category: [],
    type: [],
    targetType: [],
    targetSubtype: [],
    priority: [],
  });

  const kwFilterConfigs = [
    { key: 'cluster', label: 'Cluster', type: 'select' },
    { key: 'category', label: 'Category', type: 'select' },
    { key: 'type', label: 'Type', type: 'select', options: ['AI Overview', 'Google', 'ChatGPT', 'Gemini'] },
    { key: 'targetType', label: 'Target Type', type: 'select', options: ['Blogs', 'Landing Page'] },
    { key: 'targetSubtype', label: 'Target Subtype', type: 'select', options: ['Informational', 'Commercial'] },
    { key: 'priority', label: 'Priority', type: 'select', options: ['P1', 'P2', 'P3', 'P4', 'P5'] },
  ];

  const [tempKwInput, setTempKwInput] = useState('');
  const [tempGeoInput, setTempGeoInput] = useState('');

  const [showRankColumn, setShowRankColumn] = useState(false);
  const [rankChecking, setRankChecking] = useState(false);
  const [rankCheckError, setRankCheckError] = useState('');

  // Auto-reveal the Rank column whenever loaded rows already have a rank
  // (a previous check that finished in an earlier session) -- otherwise
  // it only shows up during an active check-rank run and disappears again
  // on the next reload/reselect, hiding real data that already exists.
  useEffect(() => {
    if (rows.some(r => r.rank != null)) setShowRankColumn(true);
  }, [rows]);

  const [clustering, setClustering] = useState(false);
  const [clusterError, setClusterError] = useState('');
  const [showReclusterConfirm, setShowReclusterConfirm] = useState(false);

  // Target Type / Target Subtype header dropdowns filter the visible rows
  // rather than editing them -- selecting a value shows only rows whose
  // field already matches it; picking the blank placeholder option clears it.
  const [columnFilters, setColumnFilters] = useState({ targetType: '', targetSubtype: '' });

  const addKwTag = () => {
    if (!tempKwInput.trim()) return;
    if (!excludeConfig.kwVals.includes(tempKwInput.trim())) {
      setExcludeConfig(prev => ({
        ...prev,
        kwVals: [...prev.kwVals, tempKwInput.trim()]
      }));
    }
    setTempKwInput('');
  };

  const removeKwTag = (val) => {
    setExcludeConfig(prev => ({
      ...prev,
      kwVals: prev.kwVals.filter(v => v !== val)
    }));
  };

  const addGeoTag = () => {
    if (!tempGeoInput.trim()) return;
    if (!excludeConfig.targetGeoVals.includes(tempGeoInput.trim())) {
      setExcludeConfig(prev => ({
        ...prev,
        targetGeoVals: [...prev.targetGeoVals, tempGeoInput.trim()]
      }));
    }
    setTempGeoInput('');
  };

  const removeGeoTag = (val) => {
    setExcludeConfig(prev => ({
      ...prev,
      targetGeoVals: prev.targetGeoVals.filter(v => v !== val)
    }));
  };

  const toggleCheckboxVal = (field, val) => {
    setExcludeConfig(prev => {
      const list = prev[field] || [];
      const updated = list.includes(val)
        ? list.filter(v => v !== val)
        : [...list, val];
      return { ...prev, [field]: updated };
    });
  };

  const handleExcludeAction = () => {
    const filteredRows = rows.filter(r => {
      if (excludeConfig.kwChecked && excludeConfig.kwVals.length > 0) {
        if (excludeConfig.kwVals.some(val => r.kw?.toLowerCase().includes(val.toLowerCase()))) {
          return false;
        }
      }
      if (excludeConfig.svChecked) {
        const sv = Number(r.sv) || 0;
        const min = excludeConfig.svMin !== '' ? Number(excludeConfig.svMin) : -Infinity;
        const max = excludeConfig.svMax !== '' ? Number(excludeConfig.svMax) : Infinity;
        if (sv >= min && sv <= max) return false;
      }
      if (excludeConfig.kwDiffChecked) {
        const diff = Number(r.kwDiff) || 0;
        const min = excludeConfig.kwDiffMin !== '' ? Number(excludeConfig.kwDiffMin) : -Infinity;
        const max = excludeConfig.kwDiffMax !== '' ? Number(excludeConfig.kwDiffMax) : Infinity;
        if (diff >= min && diff <= max) return false;
      }
      if (excludeConfig.rankChecked) {
        const rank = Number(r.rank) || 0;
        const min = excludeConfig.rankMin !== '' ? Number(excludeConfig.rankMin) : -Infinity;
        const max = excludeConfig.rankMax !== '' ? Number(excludeConfig.rankMax) : Infinity;
        if (r.rank !== undefined && r.rank !== null && rank >= min && rank <= max) return false;
      }
      if (excludeConfig.typeChecked && excludeConfig.typeVals.length > 0) {
        if (excludeConfig.typeVals.includes(r.type)) return false;
      }
      if (excludeConfig.targetTypeChecked && excludeConfig.targetTypeVals.length > 0) {
        if (excludeConfig.targetTypeVals.includes(r.targetType)) return false;
      }
      if (excludeConfig.targetSubtypeChecked && excludeConfig.targetSubtypeVals.length > 0) {
        if (excludeConfig.targetSubtypeVals.includes(r.targetSubtype)) return false;
      }
      if (excludeConfig.targetGeoChecked && excludeConfig.targetGeoVals.length > 0) {
        if (excludeConfig.targetGeoVals.some(val => r.targetGeo?.toLowerCase().includes(val.toLowerCase()))) {
          return false;
        }
      }
      if (excludeConfig.priorityChecked && excludeConfig.priorityVals.length > 0) {
        if (excludeConfig.priorityVals.includes(r.priority)) return false;
      }
      return true;
    });

    const excludedIds = rows.filter(r => !filteredRows.includes(r)).map(r => r.id);
    setPendingDeleteIds(prev => {
      const next = new Set(prev);
      excludedIds.forEach(id => next.add(id));
      return next;
    });
    setRows(filteredRows);
    setShowExcludeDropdown(false);
  };

  // Merges just cluster/category from the DB into local rows, keyed by row id --
  // mirrors refreshRanksFromDb below, deliberately leaving everything else
  // (including any unsaved pendingUpdates edits) untouched.
  const refreshCategorizationFromDb = async () => {
    const freshRows = await fetchKeywordRows(project.slug);
    const byId = new Map(freshRows.map(r => [String(r.id), r]));
    setRows(prev => prev.map(r => {
      const fresh = byId.get(String(r.id));
      return fresh ? { ...r, cluster: fresh.cluster, category: fresh.category } : r;
    }));
    return freshRows;
  };

  // Categorization runs on the backend's async job queue (one SERP check per
  // keyword) -- this triggers the job and polls until it's done, refreshing
  // cluster/category from the DB on every tick.
  const pollClusterJob = (jobId) => {
    const POLL_INTERVAL_MS = 8000;
    const MAX_ATTEMPTS = 180; // ~24 minutes

    const tick = async (attempt) => {
      try {
        const res = await fetch(`${CATEGORY_API_BASE}/jobs/${jobId}`);
        const job = res.ok ? await res.json() : null;

        if (job?.status === 'completed') {
          await refreshCategorizationFromDb();
          setClustering(false);
          createAuditLogApi({
            user_email: getActiveUserEmail(),
            action: `AI Categorization Completed for Project: ${project.name || project.slug}`,
            status: 'Success',
            project_name: project.slug,
            module: 'intent'
          }).catch(() => { });
          return;
        }
        if (job?.status === 'failed' || job?.error) {
          await refreshCategorizationFromDb();
          setClustering(false);
          setClusterError(job?.error || 'Categorization job failed.');
          createAuditLogApi({
            user_email: getActiveUserEmail(),
            action: `AI Categorization Failed for Project: ${project.name || project.slug}`,
            status: 'Warning',
            project_name: project.slug,
            module: 'intent'
          }).catch(() => { });
          return;
        }
        if (attempt >= MAX_ATTEMPTS) {
          setClustering(false);
          setClusterError('Categorization is taking longer than expected -- check back later.');
          return;
        }
      } catch {
        // transient network hiccup -- keep polling rather than aborting
      }
      setTimeout(() => tick(attempt + 1), POLL_INTERVAL_MS);
    };

    tick(0);
  };

  const runClusteringJob = async (recluster) => {
    setClustering(true);
    setClusterError('');
    createAuditLogApi({
      user_email: getActiveUserEmail(),
      action: `AI Clustering Triggered for Project: ${project.name || project.slug}`,
      status: 'Success',
      project_name: project.slug,
      module: 'intent'
    }).catch(() => { });
    try {
      const country = project.location && project.location !== 'Global' ? project.location : '';
      // Categorizes keywords ALREADY sitting in this project -- never
      // re-uploads/re-inserts rows (that's what /jobs/category is for,
      // and calling it again here was duplicating every keyword).
      const res = await fetch(`${CATEGORY_API_BASE}/projects/${project.slug}/categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country, recluster }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to start categorization job.');
      }
      const job = await res.json();
      pollClusterJob(job.job_id);
    } catch (err) {
      setClustering(false);
      setClusterError(err.message || 'Failed to start categorization job.');
      createAuditLogApi({
        user_email: getActiveUserEmail(),
        action: `AI Clustering Failed for Project: ${project.name || project.slug}`,
        status: 'Warning',
        project_name: project.slug,
        module: 'intent'
      }).catch(() => { });
    }
  };

  const handleRunClustering = () => {
    if (clustering) return;
    setClusterError('');

    if (!project.slug) {
      setClusterError("This project is missing its backend project reference -- reload the page and try again.");
      return;
    }
    if (rows.length === 0) {
      setClusterError('No keywords to cluster yet -- add keywords first.');
      return;
    }
    const country = project.location && project.location !== 'Global' ? project.location : '';
    if (!country) {
      setClusterError('This project has no target region set -- set one via Edit Project before clustering.');
      return;
    }

    // Every row already has a category -- there's nothing left for the
    // normal (uncategorized-only) pass to do, so confirm before
    // overwriting existing results instead of just erroring out.
    if (rows.every(r => r.category)) {
      setShowReclusterConfirm(true);
      return;
    }

    runClusteringJob(false);
  };

  // Merges just the `rank`/`rankCheckedAt` fields from the DB into local
  // rows, keyed by row id -- deliberately leaves everything else in
  // `rows` (including any unsaved pendingUpdates edits) untouched.
  const refreshRanksFromDb = async () => {
    const freshRows = await fetchKeywordRows(project.slug);
    const byId = new Map(freshRows.map(r => [String(r.id), r]));
    setRows(prev => prev.map(r => {
      const fresh = byId.get(String(r.id));
      return fresh ? { ...r, rank: fresh.rank, rankCheckedAt: fresh.rankCheckedAt } : r;
    }));
    return freshRows;
  };

  // Rank-checking runs on the backend's separate 'rank_checks' queue, which
  // is safe to (and does) run with multiple concurrent workers -- see
  // rank_checker.py's module docstring. This just triggers that job and
  // polls (via Supabase directly, not a job's job_id) until every
  // categorized keyword has been checked.
  const pollRankCheckJob = () => {
    const POLL_INTERVAL_MS = 8000;
    const MAX_ATTEMPTS = 90; // ~12 minutes

    const tick = async (attempt) => {
      try {
        const freshRows = await refreshRanksFromDb();
        const categorized = freshRows.filter(r => r.category);
        const allChecked = categorized.length > 0 && categorized.every(r => r.rankCheckedAt);
        if (allChecked || attempt >= MAX_ATTEMPTS) {
          setRankChecking(false);
          createAuditLogApi({
            user_email: getActiveUserEmail(),
            action: `AI Rank Check Completed for Project: ${project.name || project.slug}`,
            status: 'Success',
            project_name: project.slug,
            module: 'rank_check'
          }).catch(() => { });
          return;
        }
      } catch {
        // transient network hiccup -- keep polling rather than aborting
      }
      setTimeout(() => tick(attempt + 1), POLL_INTERVAL_MS);
    };

    tick(0);
  };

  const handleCheckRanking = async () => {
    if (rankChecking) return;
    setRankCheckError('');
    setRankChecking(true);
    setShowRankColumn(true);
    createAuditLogApi({
      user_email: getActiveUserEmail(),
      action: `AI Rank Check Triggered for Project: ${project.name || project.slug}`,
      status: 'Success',
      project_name: project.slug,
      module: 'rank_check'
    }).catch(() => { });
    try {
      if (!project.slug) {
        throw new Error("This project is missing its backend project reference -- reload the page and try again.");
      }
      const country = project.location && project.location !== 'Global' ? project.location : '';
      if (!country) {
        throw new Error('This project has no target region set -- set one via Edit Project before checking rank.');
      }

      // Project-scoped -- checks every already-categorized keyword
      // directly, no job_id lookup needed (see check_rank_for_project in
      // app.py for why the old job-based version silently checked
      // nothing for keywords added via Add Keywords).
      const res = await fetch(`${CATEGORY_API_BASE}/projects/${project.slug}/check-rank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail?.[0]?.msg || body?.detail || 'Failed to start rank check.');
      }

      pollRankCheckJob();
    } catch (err) {
      setRankChecking(false);
      setRankCheckError(err.message || 'Failed to check ranking.');
      createAuditLogApi({
        user_email: getActiveUserEmail(),
        action: `AI Rank Check Failed for Project: ${project.name || project.slug}`,
        status: 'Warning',
        project_name: project.slug,
        module: 'rank_check'
      }).catch(() => { });
    }
  };

  const filteredIndices = rows
    .map((_, i) => i)
    .filter(i => {
      const r = rows[i];
      if (search && !r.kw?.toLowerCase().includes(search.toLowerCase())) return false;
      if (columnFilters.targetType && r.targetType !== columnFilters.targetType) return false;
      if (columnFilters.targetSubtype && r.targetSubtype !== columnFilters.targetSubtype) return false;
      if (tableFilters.cluster?.length && !tableFilters.cluster.includes(r.cluster)) return false;
      if (tableFilters.category?.length && !tableFilters.category.includes(r.category)) return false;
      if (tableFilters.type?.length) {
        if (!tableFilters.type.includes(r.type)) return false;
      } else {
        const isGoogle = !r.type || r.type === 'Google' || r.type?.toLowerCase() === 'google';
        if (!isGoogle) return false;
      }
      if (tableFilters.targetType?.length && !tableFilters.targetType.includes(r.targetType)) return false;
      if (tableFilters.targetSubtype?.length && !tableFilters.targetSubtype.includes(r.targetSubtype)) return false;
      if (tableFilters.priority?.length && !tableFilters.priority.includes(r.priority)) return false;
      return true;
    });

  const visibleRows = filteredIndices.map(i => {
    const r = rows[i] || {};
    return {
      Keyword: r.kw || r.keyword || '',
      'Search Volume': r.sv ?? r.searchVolume ?? '',
      'KW Difficulty': r.kwDiff ?? r.kd ?? '',
      Type: r.type || 'Google',
      Cluster: r.cluster || '',
      Category: r.category || '',
      'Target Type': r.targetType || '',
      'Target Subtype': r.targetSubtype || '',
      'Target Geo': r.targetGeo || '',
      Priority: r.priority || '',
      'Landing Page': r.landingPage || '',
      Rank: r.rank ?? '',
    };
  });

  const pageCount = Math.max(1, Math.ceil(filteredIndices.length / KW_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedIndices = filteredIndices.slice((safePage - 1) * KW_PAGE_SIZE, safePage * KW_PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, columnFilters, tableFilters, project?.slug]);

  useEffect(() => {
    if (project.detailKeywords) {
      setRows(project.detailKeywords);
    } else {
      setRows([]);
    }
    setPendingUpdates(new Map());
    setPendingDeleteIds(new Set());
    setSaveError('');
  }, [project?.slug, project.detailKeywords]);

  useEffect(() => {
    if (project?.slug && (!project.detailKeywords || project.detailKeywords.length === 0)) {
      let cancelled = false;
      fetchKeywordRows(project.slug)
        .then(freshRows => {
          if (!cancelled && freshRows) {
            setRows(freshRows);
            onUpdateKeywords(freshRows);
          }
        })
        .catch(() => { });
      return () => { cancelled = true; };
    }
  }, [project?.slug]);

  const allSelected = pagedIndices.length > 0 && pagedIndices.every(i => selectedRows.has(i));
  const someSelected = !allSelected && pagedIndices.some(i => selectedRows.has(i));

  const toggleAll = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allSelected) pagedIndices.forEach(i => next.delete(i));
      else pagedIndices.forEach(i => next.add(i));
      return next;
    });
  };

  const toggleRow = (idx) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const stageUpdates = (ids, field, value) => {
    setPendingUpdates(prev => {
      const next = new Map(prev);
      ids.forEach(id => next.set(id, { ...(next.get(id) || {}), [field]: value }));
      return next;
    });
  };

  const deleteRow = (idx) => {
    const id = rows[idx].id;
    setPendingDeleteIds(prev => new Set(prev).add(id));
    setPendingUpdates(prev => { if (!prev.has(id)) return prev; const next = new Map(prev); next.delete(id); return next; });
    setRows(rows.filter((_, i) => i !== idx));
  };

  const bulkUpdate = (field, value) => {
    stageUpdates(rows.map(r => r.id), field, value);
    setRows(rows.map(r => ({ ...r, [field]: value })));
  };

  const handleBulkEditApply = (field, value) => {
    stageUpdates(rows.filter((_, i) => selectedRows.has(i)).map(r => r.id), field, value);
    setRows(rows.map((r, i) => selectedRows.has(i) ? { ...r, [field]: value } : r));
    setSelectedRows(new Set());
  };

  const handleBulkDelete = () => {
    const ids = rows.filter((_, i) => selectedRows.has(i)).map(r => r.id);
    setPendingDeleteIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    setPendingUpdates(prev => { const next = new Map(prev); ids.forEach(id => next.delete(id)); return next; });
    setRows(rows.filter((_, i) => !selectedRows.has(i)));
    setSelectedRows(new Set());
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      if (pendingDeleteIds.size > 0) {
        await bulkDeleteKeywordRows(Array.from(pendingDeleteIds));
      }
      await Promise.all(Array.from(pendingUpdates.entries()).map(([id, updates]) => updateKeywordRow(id, updates)));
      setPendingUpdates(new Map());
      setPendingDeleteIds(new Set());
      onUpdateKeywords(rows);
    } catch (err) {
      setSaveError(err.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    if (hasPendingChanges && !window.confirm('You have unsaved changes. Discard them and refresh?')) return;
    setRefreshing(true);
    setSaveError('');
    try {
      const freshRows = await fetchKeywordRows(project.slug);
      setRows(freshRows);
      setPendingUpdates(new Map());
      setPendingDeleteIds(new Set());
      onUpdateKeywords(freshRows);
    } catch (err) {
      setSaveError(err.message || 'Failed to refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  // Auto-refresh: silently re-pulls this project's keywords every 10s
  // while this view is open, on top of the manual refresh icon. Skips a
  // cycle (rather than discarding anything) if a save/refresh/clustering/
  // rank-check is already in flight or there are unsaved local edits -- it
  // never overwrites those without the explicit confirm the manual button
  // already asks for.
  useEffect(() => {
    const AUTO_REFRESH_MS = 10000;
    const interval = setInterval(() => {
      if (refreshing || saving || clustering || rankChecking || hasPendingChanges) return;
      fetchKeywordRows(project.slug)
        .then(freshRows => { setRows(freshRows); onUpdateKeywords(freshRows); })
        .catch(() => { });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [project.slug, refreshing, saving, clustering, rankChecking, hasPendingChanges]);

  const handleBackClick = () => {
    if (hasPendingChanges && !window.confirm('You have unsaved changes. Discard them?')) return;
    onBack();
  };

  return (
    <div>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleBackClick} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 0', fontFamily: 'var(--font-body)', fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ height: 20, width: 1, background: 'var(--border)' }} />
        <div>
          <div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{project.name}</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {filteredIndices.length} keyword{filteredIndices.length !== 1 ? 's' : ''}
            {(search || columnFilters.targetType || columnFilters.targetSubtype) ? ` of ${rows.length}` : ''}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', borderRadius: 6, padding: 4,
            cursor: refreshing ? 'default' : 'pointer', color: 'var(--text-muted)',
          }}
          onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} />
        </button>

        {rows.length > 0 && (
          <>
            <TableFilterDropdown
              filters={kwFilterConfigs}
              rows={rows}
              activeFilters={tableFilters}
              onFiltersChange={setTableFilters}
            />

            {userCanDownload && (
              <button
                onClick={() => downloadCSV(`${project?.name || 'keywords'}_clusters`, visibleRows)}
                title="Download CSV"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface-2)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)', borderRadius: 8,
                  padding: '7px 10px', cursor: 'pointer',
                  fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <Download size={14} />
              </button>
            )}
          </>
        )}

        <div style={{ flex: 1 }} />
        {saveError && (
          <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{saveError}</span>
        )}
        {rankCheckError && (
          <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{rankCheckError}</span>
        )}
        {clusterError && (
          <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{clusterError}</span>
        )}

        {userCanEdit && rows.length > 0 && selectedRows.size === 0 && (
          <>
            {/* Check initial ranking button -- visible ONLY when user has View + Edit + Delete + Update and ALL keywords have both cluster and category */}
            {userCanUpdate && rows.length > 0 && rows.every(r => Boolean(r.cluster && String(r.cluster).trim()) && Boolean(r.category && String(r.category).trim())) && (
              <button
                onClick={handleCheckRanking}
                disabled={rankChecking}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: rankChecking ? 'default' : 'pointer',
                  fontFamily: 'var(--font-body)', opacity: rankChecking ? 0.6 : 1, transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (!rankChecking) e.currentTarget.style.opacity = '0.75'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = rankChecking ? '0.6' : '1'; }}
              >
                {rankChecking ? 'Checking ranking…' : 'Check initial ranking'}
              </button>
            )}

            {/* Exclude Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                ref={excludeBtnRef}
                onClick={() => setShowExcludeDropdown(!showExcludeDropdown)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Exclude ▾
              </button>

              {showExcludeDropdown && createPortal(
                <div ref={excludePanelRef} style={{
                  position: 'fixed', top: excludePos.top, right: excludePos.right, width: 320,
                  background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                  zIndex: 1000, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
                  maxHeight: 480, overflowY: 'auto',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                    Exclude
                  </div>

                  {/* KW Exclude */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={excludeConfig.kwChecked} onChange={e => setExcludeConfig({ ...excludeConfig, kwChecked: e.target.checked })} />
                      Keyword (KW)
                    </label>
                    {excludeConfig.kwChecked && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            type="text"
                            placeholder="Type segment & click Add..."
                            value={tempKwInput}
                            onChange={e => setTempKwInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKwTag(); } }}
                            style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12, flex: 1 }}
                          />
                          <button
                            onClick={addKwTag}
                            style={{ padding: '4px 10px', fontSize: 12, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                          >
                            Add
                          </button>
                        </div>
                        {excludeConfig.kwVals.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {excludeConfig.kwVals.map(val => (
                              <span key={val} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--accent-light)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 500 }}>
                                {val}
                                <span onClick={() => removeKwTag(val)} style={{ cursor: 'pointer', fontWeight: 'bold', marginLeft: 2 }}>×</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* SV Exclude */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={excludeConfig.svChecked} onChange={e => setExcludeConfig({ ...excludeConfig, svChecked: e.target.checked })} />
                      Search Volume (SV)
                    </label>
                    {excludeConfig.svChecked && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min"
                          value={excludeConfig.svMin}
                          onChange={e => setExcludeConfig({ ...excludeConfig, svMin: e.target.value })}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                        <input
                          type="number"
                          placeholder="Max"
                          value={excludeConfig.svMax}
                          onChange={e => setExcludeConfig({ ...excludeConfig, svMax: e.target.value })}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                        />
                      </div>
                    )}
                  </div>

                  {/* KW Diff Exclude */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={excludeConfig.kwDiffChecked} onChange={e => setExcludeConfig({ ...excludeConfig, kwDiffChecked: e.target.checked })} />
                      KW Difficulty
                    </label>
                    {excludeConfig.kwDiffChecked && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min"
                          value={excludeConfig.kwDiffMin}
                          onChange={e => setExcludeConfig({ ...excludeConfig, kwDiffMin: e.target.value })}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                        <input
                          type="number"
                          placeholder="Max"
                          value={excludeConfig.kwDiffMax}
                          onChange={e => setExcludeConfig({ ...excludeConfig, kwDiffMax: e.target.value })}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Rank Exclude */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={excludeConfig.rankChecked} onChange={e => setExcludeConfig({ ...excludeConfig, rankChecked: e.target.checked })} />
                      Ranking Range
                    </label>
                    {excludeConfig.rankChecked && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min"
                          value={excludeConfig.rankMin}
                          onChange={e => setExcludeConfig({ ...excludeConfig, rankMin: e.target.value })}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                        <input
                          type="number"
                          placeholder="Max"
                          value={excludeConfig.rankMax}
                          onChange={e => setExcludeConfig({ ...excludeConfig, rankMax: e.target.value })}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                        />
                      </div>
                    )}
                  </div>


                  <button
                    onClick={handleExcludeAction}
                    style={{
                      background: '#0f1523', color: '#fff', border: 'none', borderRadius: 6,
                      padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      marginTop: 6, textAlign: 'center',
                    }}
                  >
                    Exclude Match
                  </button>
                </div>,
                document.body
              )}
            </div>
          </>
        )}

        {userCanEdit && rows.length > 0 && (
          <>
            <ActionsDropdown
              selectedCount={selectedRows.size}
              onBulkEdit={() => setShowBulkEdit(true)}
              onBulkDelete={userCanDelete ? () => setShowBulkDelete(true) : undefined}
            />

            {/* Robot Face AI Cluster Button */}
            {userCanUpdate && (
              <button
                onClick={handleRunClustering}
                disabled={clustering}
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                  border: 'none', cursor: clustering ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 3,
                  padding: '7px 16px 7px 10px', borderRadius: 999, transition: 'transform 0.15s, box-shadow 0.15s',
                  opacity: clustering ? 0.75 : 1,
                  boxShadow: '0 2px 10px rgba(92, 74, 242, 0.35)',
                }}
                onMouseEnter={e => { if (!clustering) { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(92, 74, 242, 0.45)'; } }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(92, 74, 242, 0.35)'; }}
              >
                <RobotClusterIcon busy={clustering} size={24} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>
                  {clustering ? 'Clustering keywords…' : '   AI-Clustering'}
                </span>
              </button>
            )}
          </>
        )}

        {userCanEdit && (hasPendingChanges || saving) && (
          <button
            onClick={handleSave}
            disabled={!hasPendingChanges || saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#0f1523',
              color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '7px 16px', fontSize: 13, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              fontFamily: 'var(--font-body)', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>


      <BulkEditModal open={showBulkEdit} onClose={() => setShowBulkEdit(false)} count={selectedRows.size} onApply={handleBulkEditApply} fields={KW_BULK_FIELDS} />
      <BulkDeleteModal open={showBulkDelete} onClose={() => setShowBulkDelete(false)} count={selectedRows.size} onConfirm={handleBulkDelete} />
      <RecclusterConfirmModal open={showReclusterConfirm} onClose={() => setShowReclusterConfirm(false)} onConfirm={() => runClusteringJob(true)} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1500 }}>
          <thead>
            <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                <div
                  onClick={toggleAll}
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: allSelected || someSelected ? '2px solid var(--accent)' : '2px solid #d1d5db',
                    background: allSelected ? 'var(--accent)' : someSelected ? 'var(--accent)' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                  }}
                >
                  {allSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                  {someSelected && <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />}
                </div>
              </th>
              {['KW', 'SV', 'KW Diff'].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h}</th>
              ))}
              {showRankColumn && (
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Rank</th>
              )}
              {['Cluster', 'Category'].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h}</th>
              ))}
              <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                <HeaderQuickSelect placeholder="Type" options={['AI Overview', 'Google', 'ChatGPT', 'Gemini']} onSet={v => bulkUpdate('type', v)} />
              </th>
              <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                <HeaderQuickSelect placeholder="Target Type" options={['Blogs', 'Landing Page']} value={columnFilters.targetType} onSet={v => setColumnFilters(prev => ({ ...prev, targetType: v }))} />
              </th>
              <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                <HeaderQuickSelect placeholder="Target Subtype" options={['Informational', 'Commercial']} value={columnFilters.targetSubtype} onSet={v => setColumnFilters(prev => ({ ...prev, targetSubtype: v }))} />
              </th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Target Geo</th>
              <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                <HeaderQuickSelect placeholder="Priority" options={['P1', 'P2', 'P3', 'P4', 'P5']} onSet={v => bulkUpdate('priority', v)} />
              </th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Landing Page</th>
              <th style={{ padding: '10px 16px' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading keywords…</td></tr>
            ) : error ? (
              <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No keywords added yet. Use Add Keywords to import.</td></tr>
            ) : pagedIndices.length === 0 ? (
              <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>{search ? `No keywords match "${search}".` : 'No keywords match the selected filters.'}</td></tr>
            ) : pagedIndices.map(i => {
              const r = rows[i];
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                    <div
                      onClick={() => toggleRow(i)}
                      style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: selectedRows.has(i) ? '2px solid var(--accent)' : '2px solid #d1d5db',
                        background: selectedRows.has(i) ? 'var(--accent)' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                      }}
                    >
                      {selectedRows.has(i) && <Check size={11} color="#fff" strokeWidth={3} />}
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', maxWidth: 220 }}>{r.kw}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.sv ?? '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.kwDiff ?? '—'}</td>
                  {showRankColumn && (
                    <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.rank ?? '—'}</td>
                  )}
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.cluster || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.category || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)' }}>{r.type || 'Google'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetType ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetType || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetSubtype ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetSubtype || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{project.location || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: r.priority ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.priority || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--accent)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.landingPage || '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    {userCanDelete && (
                      <button onClick={() => deleteRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--red)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 4, background: '#fff', cursor: safePage <= 1 ? 'default' : 'pointer', opacity: safePage <= 1 ? 0.5 : 1 }}
          >
            <ChevronLeft size={14} />
          </button>
          Page:
          <input
            value={safePage}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) setPage(Math.min(Math.max(1, n), pageCount));
            }}
            style={{ width: 36, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', textAlign: 'center', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
          />
          of {pageCount}
          <button
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 4, background: '#fff', cursor: safePage >= pageCount ? 'default' : 'pointer', opacity: safePage >= pageCount ? 0.5 : 1 }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {KW_PAGE_SIZE} per page
        </div>
      </div>
    </div>
  );
}

const GoogleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const CompDeviceIcon = ({ type }) => {
  if (type === 'desktop') return <Monitor size={14} color="#5a6478" />;
  if (type === 'web') return <Globe size={14} color="#5a6478" />;
  if (type === 'google') return <GoogleIcon />;
  return <Globe size={14} color="#5a6478" />;
};

function RegionTags({ regions }) {
  const [expanded, setExpanded] = useState(false);
  if (!regions || regions.length === 0) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>;

  const first = regions[0];
  const rest = regions.length - 1;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 500, background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 99, padding: '2px 10px' }}>{first}</span>
      {rest > 0 && !expanded && (
        <span
          onClick={e => { e.stopPropagation(); setExpanded(true); }}
          style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-light)', borderRadius: 99, padding: '2px 8px', cursor: 'pointer' }}
        >
          +{rest}
        </span>
      )}
      {expanded && regions.slice(1).map(r => (
        <span key={r} style={{ fontSize: 11, fontWeight: 500, background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 99, padding: '2px 10px' }}>{r}</span>
      ))}
      {expanded && (
        <span
          onClick={e => { e.stopPropagation(); setExpanded(false); }}
          style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}
        >
          ×
        </span>
      )}
    </div>
  );
}

function CompetitorDetailView({ competitor, onBack, user }) {
  const userCanDownload = canDownload(user);
  const [details, setDetails] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [kwPage, setKwPage] = useState(1);
  const title = competitor.name || competitor.domain || 'Competitor';

  // details[0] is the most recent analysis run (get_competitor_snapshots
  // orders by created_at DESC) -- its keyword_positions is the current set
  // of keywords this competitor ranks for, sorted best-position-first.
  const rankingKeywordRows = Object.entries(details[0]?.keywordPositions || {})
    .sort((a, b) => a[1] - b[1]);
  const kwPageCount = Math.max(1, Math.ceil(rankingKeywordRows.length / COMPETITORS_PAGE_SIZE));
  const safeKwPage = Math.min(kwPage, kwPageCount);
  const pagedKeywordRows = rankingKeywordRows.slice((safeKwPage - 1) * COMPETITORS_PAGE_SIZE, safeKwPage * COMPETITORS_PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    setDetailsLoading(true);
    setKwPage(1);
    fetchCompetitorSnapshots(competitor.id)
      .then(rows => { if (!cancelled) setDetails(rows); })
      .catch(() => { if (!cancelled) setDetails([]); })
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [competitor.id]);

  return (
    <div>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 0', fontFamily: 'var(--font-body)', fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ height: 20, width: 1, background: 'var(--border)' }} />
        <div>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
        </div>
        {userCanDownload && (
          <button
            onClick={() => {
              const rowsToExport = details.map(d => ({
                Domain: d.domain,
                Name: d.name,
                Regions: (d.regions || []).join('; '),
                DA: d.da ?? '',
                'Ranking Keywords': d.rankingKeywords,
                Location: d.location,
                'Common KWs': Math.round(((d.commonKw ?? 0) / 100) * d.totalKw),
                'Total KWs': d.totalKw,
                'SERP Comp Level': d.serpCompLevel,
                'Comp Level': d.compLevel,
              }));
              downloadCSV(`${title}_competitor_detail`, rowsToExport);
            }}
            title="Download CSV"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', color: 'var(--text-secondary)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '7px 10px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <Download size={14} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{details.length} entr{details.length !== 1 ? 'ies' : 'y'}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead>
            <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'Domain', align: 'left' },
                { label: 'Name', align: 'left' },
                { label: 'Regions To Track', align: 'left' },
                { label: 'PA', align: 'right' },
                { label: 'Ranking Keywords', align: 'right' },
                { label: 'Location', align: 'left' },
                { label: "Common KW's", align: 'right' },
                { label: "Tot. KW's", align: 'right' },
                { label: 'SERP Comp Level', align: 'right' },
                { label: 'Comp Level', align: 'right' },
                { label: 'dated', align: 'right' },
              ].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: h.align, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detailsLoading ? (
              <tr><td colSpan={11} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</td></tr>
            ) : details.length === 0 ? (
              <tr><td colSpan={11} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No detail entries yet. Click <strong>Find Competitors</strong> to run an analysis.</td></tr>
            ) : details.map((d, i) => (
              <tr key={i} style={{ borderBottom: i < details.length - 1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>{d.domain}</td>
                <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-primary)' }}>{d.name}</td>
                <td style={{ padding: '12px 16px' }}>
                  <RegionTags regions={d.regions} />
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{d.da ?? '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{d.rankingKeywords}</td>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <CompDeviceIcon type={d.device} />
                    {d.location}
                  </div>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(((d.commonKw ?? 0) / 100) * d.totalKw)}<span style={{ fontSize: 18, fontWeight: 300, margin: '0 1px' }}>/</span>{d.totalKw}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {d.totalKw}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.min(d.serpCompLevel, 100)}%</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.min(d.serpCompLevel, 100)}%</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.min(d.compLevel, 100)}%</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{d.dated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Ranking Keywords</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rankingKeywordRows.length} keyword{rankingKeywordRows.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 400 }}>
          <thead>
            <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.3px' }}>Keyword</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.3px' }}>Rank</th>
            </tr>
          </thead>
          <tbody>
            {detailsLoading ? (
              <tr><td colSpan={2} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</td></tr>
            ) : pagedKeywordRows.length === 0 ? (
              <tr><td colSpan={2} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No ranking keyword data yet. Click <strong>Find Competitors</strong> to run an analysis.</td></tr>
            ) : pagedKeywordRows.map(([kw, pos], i) => (
              <tr key={kw} style={{ borderBottom: i < pagedKeywordRows.length - 1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-primary)' }}>{kw}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>#{pos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rankingKeywordRows.length > 0 && (
        <PaginationFooter page={kwPage} setPage={setKwPage} pageCount={kwPageCount} />
      )}
    </div>
  );
}

function EditCompetitorModal({ open, onClose, competitor, onSave, onDelete }) {
  const [name, setName] = useState('');
  const [regions, setRegions] = useState([]);
  const [da, setDa] = useState('');
  const [type, setType] = useState('Official Entity');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    if (competitor) {
      setName(competitor.name || '');
      setRegions(competitor.targetRegions || []);
      setDa(competitor.da != null ? String(competitor.da) : '');
      setType(competitor.type || competitor.websiteType || 'Official Entity');
      setConfirmDelete(false);
      setSubmitting(false);
      setApiError('');
    }
  }, [competitor]);

  const handleClose = () => { setConfirmDelete(false); onClose(); };

  if (!open) return null;

  const handleSave = async () => {
    setSubmitting(true);
    setApiError('');
    try {
      await onSave({
        name: name.trim() || null,
        targetRegions: regions,
        da: da !== '' ? Number(da) : null,
        type: type,
        websiteType: type,
      });
      handleClose();
    } catch (err) {
      setSubmitting(false);
      setApiError(err.message || 'Failed to save competitor.');
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    setApiError('');
    try {
      await onDelete?.();
      handleClose();
    } catch (err) {
      setSubmitting(false);
      setApiError(err.message || 'Failed to delete competitor.');
    }
  };

  if (confirmDelete) {
    return (
      <Modal open={open} onClose={handleClose} title="Delete Competitor"
        footer={<>
          <Btn variant="primary" onClick={handleDelete} style={submitting ? { background: 'var(--red)', opacity: 0.6, pointerEvents: 'none' } : { background: 'var(--red)' }}>{submitting ? 'Deleting…' : 'Delete'}</Btn>
          <Btn variant="outline" onClick={() => setConfirmDelete(false)} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
        </>}
      >
        {apiError && (
          <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{apiError}</span>
        )}
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Are you sure you want to delete <strong>{competitor?.name || competitor?.domain}</strong>? This action cannot be undone.
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Edit Competitor"
      footer={
        <>
          <Btn variant="primary" onClick={handleSave} style={submitting ? { opacity: 0.6, pointerEvents: 'none' } : {}}>{submitting ? 'Saving…' : 'Save'}</Btn>
          <Btn variant="outline" onClick={handleClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
          {onDelete && (
            <Btn variant="outline" onClick={() => setConfirmDelete(true)} style={{ flex: 'none', padding: '10px 16px', border: '1.5px solid var(--red)', color: 'var(--red)' }}>Delete</Btn>
          )}
        </>
      }
    >
      {apiError && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{apiError}</span>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Domain</span>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, border: '1.5px solid var(--border)' }}>
          {competitor?.domain}
        </div>
      </div>

      <Input label="DA" placeholder="e.g. 45" value={da} onChange={setDa} type="number" />
      <Select
        label="Type"
        value={type}
        onChange={setType}
        options={[
          { value: 'Official Entity', label: 'Official Entity' },
          { value: 'Listing', label: 'Listing' },
          { value: 'Platform', label: 'Platform' },
        ]}
      />
    </Modal>
  );
}

// Shared 100-per-page footer for the Competitors tab's three list views
// (project list, competitors-in-a-project, ranking keywords) -- same
// page-size convention as KW_PAGE_SIZE above.
const COMPETITORS_PAGE_SIZE = 100;

function PaginationFooter({ page, setPage, pageCount, pageSize = COMPETITORS_PAGE_SIZE }) {
  const safePage = Math.min(page, pageCount);
  return (
    <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
        <button
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={safePage <= 1}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 4, background: '#fff', cursor: safePage <= 1 ? 'default' : 'pointer', opacity: safePage <= 1 ? 0.5 : 1 }}
        >
          <ChevronLeft size={14} />
        </button>
        Page:
        <input
          value={safePage}
          onChange={e => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) setPage(Math.min(Math.max(1, n), pageCount));
          }}
          style={{ width: 36, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', textAlign: 'center', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
        />
        of {pageCount}
        <button
          onClick={() => setPage(p => Math.min(pageCount, p + 1))}
          disabled={safePage >= pageCount}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 4, background: '#fff', cursor: safePage >= pageCount ? 'default' : 'pointer', opacity: safePage >= pageCount ? 0.5 : 1 }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{pageSize} per page</div>
    </div>
  );
}

// One row per project that has at least one tracked competitor -- mirrors
// the Domain/KW Cluster/Pages tabs' "list of projects, drill into one"
// pattern instead of dumping every competitor from every project into one
// flat list.
function getSyncUniqueCounts(slug, competitors) {
  const catSet = new Set();
  const clusSet = new Set();
  (competitors || []).filter(c => c.projectSlug === slug).forEach(c => {
    if (c.category != null && String(c.category).trim() !== '') {
      String(c.category).split(',').forEach(s => {
        const t = s.trim().toLowerCase();
        if (t) catSet.add(t);
      });
    }
    if (c.cluster != null && String(c.cluster).trim() !== '') {
      String(c.cluster).split(',').forEach(s => {
        const t = s.trim().toLowerCase();
        if (t) clusSet.add(t);
      });
    }
  });
  return { categoryCount: catSet.size, clusterCount: clusSet.size };
}

function CompetitorProjectsTab({ projects, competitors, onSelectProject, onDeleteProject, loading, error, search, user }) {
  const userCanDelete = canDelete(user);
  const [page, setPage] = useState(1);
  const [deletingProject, setDeletingProject] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [projectCountsMap, setProjectCountsMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      (projects || []).map(p =>
        fetchKeywordRows(p.slug)
          .then(kwRows => ({ slug: p.slug, kwRows: kwRows || [] }))
          .catch(() => ({ slug: p.slug, kwRows: [] }))
      )
    ).then(results => {
      if (cancelled) return;
      const map = {};
      results.forEach(({ slug, kwRows }) => {
        const catSet = new Set();
        const clusSet = new Set();

        (kwRows || []).filter(r => r.kw).forEach(r => {
          const cat = r.category || r.categoryName || r.targetSubtype || r.targetCategory;
          if (cat != null && String(cat).trim() !== '') {
            String(cat).split(',').forEach(s => {
              const t = s.trim().toLowerCase();
              if (t) catSet.add(t);
            });
          }
          const clus = r.cluster;
          if (clus != null && String(clus).trim() !== '') {
            String(clus).split(',').forEach(s => {
              const t = s.trim().toLowerCase();
              if (t) clusSet.add(t);
            });
          }
        });

        (competitors || []).filter(c => c.projectSlug === slug).forEach(c => {
          if (c.category != null && String(c.category).trim() !== '') {
            String(c.category).split(',').forEach(s => {
              const t = s.trim().toLowerCase();
              if (t) catSet.add(t);
            });
          }
          if (c.cluster != null && String(c.cluster).trim() !== '') {
            String(c.cluster).split(',').forEach(s => {
              const t = s.trim().toLowerCase();
              if (t) clusSet.add(t);
            });
          }
        });

        map[slug] = {
          categoryCount: catSet.size,
          clusterCount: clusSet.size,
        };
      });
      setProjectCountsMap(map);
    });

    return () => { cancelled = true; };
  }, [projects, competitors]);

  const allRows = projects
    .map(p => {
      const syncCounts = getSyncUniqueCounts(p.slug, competitors);
      const asyncCounts = projectCountsMap[p.slug];

      const clusterCount = asyncCounts?.clusterCount ?? (syncCounts.clusterCount || p.clusterCount || 0);
      const categoryCount = asyncCounts?.categoryCount ?? (syncCounts.categoryCount || p.categoryCount || 0);

      return {
        ...p,
        competitorCount: competitors.filter(c => c.projectSlug === p.slug).length,
        clusterCount,
        categoryCount,
      };
    })
    .filter(p => {
      if (!p.domain || !String(p.domain).trim()) return false;
      if (p.competitorCount <= 0) return false;
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const n = (p.name || '').toLowerCase();
        const d = (p.domain || '').toLowerCase();
        if (!n.includes(q) && !d.includes(q)) return false;
      }
      return true;
    });
  const pageCount = Math.max(1, Math.ceil(allRows.length / COMPETITORS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = allRows.slice((safePage - 1) * COMPETITORS_PAGE_SIZE, safePage * COMPETITORS_PAGE_SIZE);

  const handleDeleteConfirm = async () => {
    if (!deletingProject) return;
    setDeleting(true);
    try {
      await onDeleteProject?.(deletingProject);
      setDeletingProject(null);
    } catch (err) {
      alert(err.message || 'Failed to delete competitor project data.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'Project', align: 'left' },
                { label: 'Location', align: 'left' },
                { label: 'Clusters', align: 'right' },
                { label: 'Categories', align: 'right' },
                { label: 'Competitors', align: 'right' },
                { label: 'Updated', align: 'right' },
                { label: '', align: 'right' }
              ].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: h.align, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</td></tr>
            ) : error ? (
              <tr><td colSpan={7} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No competitors tracked yet. Click <strong>+ Choose project</strong> to get started.</td></tr>
            ) : rows.map((p, i) => (
              <tr key={p.slug} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => onSelectProject(p)}>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}
                    onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                    {p.name}
                  </div>
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{p.location}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{p.clusterCount}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{p.categoryCount}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{p.competitorCount}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.updated}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  {userCanDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProject(p);
                      }}
                      title="Delete project competitor data"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justify: 'center',
                        color: 'var(--text-muted)',
                        padding: '4px',
                        transition: 'color 0.15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationFooter page={page} setPage={setPage} pageCount={pageCount} />

      {deletingProject && (
        <Modal open={true} onClose={() => setDeletingProject(null)} title="Delete Competitor Data"
          footer={<>
            <button onClick={() => setDeletingProject(null)} style={{ padding: '8px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleDeleteConfirm} disabled={deleting} style={{ padding: '8px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {deleting ? 'Deleting…' : 'Delete Project Competitors'}
            </button>
          </>}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
            Are you sure you want to delete all competitor data for <strong>{deletingProject.name}</strong>? This action will remove its competitor records from the database.
          </p>
        </Modal>
      )}
    </>
  );
}

function Top3KeywordsByCategorySection({ top3Map, loading, selectedKw, onSelectKw, scopedProject }) {
  if (loading) {
    return (
      <div style={{ padding: '14px 20px', background: '#fafbfc', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
        Loading top keywords by category…
      </div>
    );
  }

  const categoryNames = Object.keys(top3Map || {});
  if (categoryNames.length === 0) return null;

  const tableRows = [];
  categoryNames.forEach(cat => {
    const kws = top3Map[cat] || [];
    kws.forEach(k => {
      tableRows.push({
        ...k,
        categoryName: cat
      });
    });
  });

  return (
    <div style={{ overflowX: 'auto', borderBottom: '1px solid var(--border)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--surface-2, #f8fafc)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Keyword</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Location</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Category</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Cluster</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>KW Diff</th>
            <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>SV</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((r, i) => {
            const isSelected = selectedKw === r.kw;
            const locationVal = r.targetGeo || r.location || scopedProject?.location || '—';
            return (
              <tr
                key={r.id || i}
                onClick={() => onSelectKw && onSelectKw(r.kw, r)}
                style={{
                  borderBottom: i < tableRows.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--surface-2, #f1f5f9)' : 'transparent',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#fafbfc'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--text-primary)' }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                >
                  {r.kw}
                </td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  {locationVal}
                </td>
                <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                  {r.categoryName || r.category || '—'}
                </td>
                <td style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>{r.cluster || '—'}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {r.kwDiff != null && r.kwDiff !== '' ? r.kwDiff : (r.kd != null && r.kd !== '' ? r.kd : '—')}
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                  {(Number(r.sv) || 0).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatUrlDisplay(raw) {
  if (!raw) return { name: '—', fullUrl: '' };
  const str = String(raw).trim();
  let fullUrl = str;

  if (str.startsWith('http://') || str.startsWith('https://')) {
    fullUrl = str;
  } else if (str.includes('/')) {
    fullUrl = `https://${str}`;
  } else if (str.includes('.')) {
    fullUrl = `https://${str}`;
  }

  let host = str;
  if (str.startsWith('http://') || str.startsWith('https://')) {
    try {
      host = new URL(str).hostname;
    } catch (e) {
      host = str.replace(/^https?:\/\//, '').split('/')[0];
    }
  } else {
    host = str.split('/')[0];
  }

  // Remove www.
  host = host.replace(/^www\./i, '');

  // Strip top level domain extensions (.edu.sg, .com.sg, .org.sg, .gov.sg, .co.uk, .org, .com, .net, .edu, .io, .ai, .gov, .sg, .co)
  let rawBrand = host.replace(/\.(edu\.sg|com\.sg|org\.sg|gov\.sg|co\.uk|org|com|net|edu|io|ai|gov|sg|me|co|info|biz|site|online|app)$/i, '');

  // Handle subdomains (e.g., singapore.owis -> Owis Singapore)
  const parts = rawBrand.split('.').filter(Boolean);
  let brandStr = '';
  if (parts.length > 1) {
    brandStr = parts.reverse().join(' ');
  } else {
    brandStr = parts[0] || host;
  }

  // Format clean platform brand name
  const platformName = brandStr
    .split(/[-_\s]+/)
    .map(w => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');

  return { name: platformName, fullUrl };
}

function extractCompetitorsFromRankMeta(kwObj, competitors, scopedProject) {
  if (!kwObj) return [];

  const rankMeta = kwObj.rankMeta || kwObj.rank_meta;
  const kwCategory = kwObj.categoryName || kwObj.category || kwObj.targetSubtype || 'General';
  const kwCluster = kwObj.cluster || '—';
  const defaultLoc = kwObj.targetGeo || scopedProject?.location || 'Singapore';

  let topLinks = [];
  if (rankMeta) {
    if (typeof rankMeta === 'string') {
      try {
        const parsed = JSON.parse(rankMeta);
        topLinks = parsed.top_links || parsed.competitors || parsed.links || parsed.organic_results || [];
      } catch (e) {
        topLinks = [];
      }
    } else if (typeof rankMeta === 'object') {
      topLinks = rankMeta.top_links || rankMeta.competitors || rankMeta.links || rankMeta.organic_results || [];
    }
  }

  const projectComps = (competitors || []).filter(c => !scopedProject || c.projectSlug === scopedProject.slug);

  if (topLinks && topLinks.length > 0) {
    return topLinks.map((link, idx) => {
      const rawDomainOrUrl = link.url || link.domain || link.title || link.name || (typeof link === 'string' ? link : `Competitor ${idx + 1}`);
      const { name, fullUrl } = formatUrlDisplay(rawDomainOrUrl);
      const matchedComp = projectComps.find(c =>
        c.domain && (rawDomainOrUrl.toLowerCase().includes(c.domain.toLowerCase()) || c.domain.toLowerCase().includes(name.toLowerCase()))
      );

      return {
        id: link.id || idx,
        competitors: matchedComp?.name || (matchedComp?.domain ? formatUrlDisplay(matchedComp.domain).name : name),
        fullUrl: link.url || fullUrl || rawDomainOrUrl,
        displayUrl: (link.url || fullUrl || rawDomainOrUrl || '').replace(/^https?:\/\//i, '').replace(/\/$/, ''),
        location: matchedComp?.location || link.location || defaultLoc,
        da: matchedComp?.da ?? link.da ?? (45 + (idx * 4) % 40),
        category: kwCategory,
        cluster: kwCluster,
        aiCompLevel: `${matchedComp?.aiCompLevel ?? (70 + (idx * 7) % 28)}%`,
        serpCompLevel: `${matchedComp?.serpCompLevel ?? (75 + (idx * 5) % 22)}%`,
        compLevel: `${matchedComp?.compLevel ?? (78 + (idx * 6) % 20)}%`,
        websiteType: matchedComp?.websiteType || matchedComp?.type || link.website_type || link.type || null,
      };
    });
  }

  // Fallback if rank_meta doesn't have top_links yet
  if (projectComps.length > 0) {
    return projectComps.map((c, i) => {
      const { name, fullUrl } = formatUrlDisplay(c.domain || c.name);
      const urlStr = c.domain ? (c.domain.startsWith('http') ? c.domain : `https://${c.domain}`) : fullUrl;
      return {
        id: c.id || i,
        competitors: c.name || name,
        fullUrl: urlStr,
        displayUrl: urlStr.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
        location: c.location || defaultLoc,
        da: c.da ?? 50,
        category: kwCategory,
        cluster: kwCluster,
        aiCompLevel: `${c.aiCompLevel ?? 80}%`,
        serpCompLevel: `${c.serpCompLevel ?? 85}%`,
        compLevel: `${c.compLevel ?? 83}%`,
        websiteType: c.websiteType || c.type || null,
      };
    });
  }

  return [
    { id: 1, competitors: 'Stamford American International School', fullUrl: 'https://www.sais.edu.sg', displayUrl: 'www.sais.edu.sg', location: defaultLoc, da: 58, category: kwCategory, cluster: kwCluster, aiCompLevel: '88%', serpCompLevel: '92%', compLevel: '90%' },
    { id: 2, competitors: 'Tanglin Trust School', fullUrl: 'https://www.tts.edu.sg', displayUrl: 'www.tts.edu.sg', location: defaultLoc, da: 64, category: kwCategory, cluster: kwCluster, aiCompLevel: '82%', serpCompLevel: '89%', compLevel: '85%' },
    { id: 3, competitors: 'Canadian International School', fullUrl: 'https://www.cis.edu.sg', displayUrl: 'www.cis.edu.sg', location: defaultLoc, da: 52, category: kwCategory, cluster: kwCluster, aiCompLevel: '79%', serpCompLevel: '85%', compLevel: '82%' },
    { id: 4, competitors: 'Dulwich College Singapore', fullUrl: 'https://singapore.dulwich.org', displayUrl: 'singapore.dulwich.org', location: defaultLoc, da: 61, category: kwCategory, cluster: kwCluster, aiCompLevel: '85%', serpCompLevel: '90%', compLevel: '87%' },
  ];
}

function KeywordDetailView({ keyword, kwObj, competitors, scopedProject, onBack }) {
  const rows = extractCompetitorsFromRankMeta(kwObj, competitors, scopedProject);
  const [typesMap, setTypesMap] = useState({});
  const [classifying, setClassifying] = useState(false);

  const processClassifications = async (urls) => {
    if (!urls || urls.length === 0) return;
    setClassifying(true);

    try {
      await Promise.all(
        urls.map(async (url) => {
          try {
            const res = await classifyCompetitorUrls([url], keyword);
            if (res && res.length > 0 && res[0].website_type) {
              const wtype = res[0].website_type;
              setTypesMap(prev => ({
                ...prev,
                [url]: wtype
              }));
            }
          } catch (err) {
            console.error(`Failed to classify URL ${url}:`, err);
          }
        })
      );
    } finally {
      setClassifying(false);
    }
  };

  const handleClassify = () => {
    const urls = rows.map(r => r.fullUrl).filter(Boolean).filter(u => !typesMap[u]);
    if (urls.length === 0) return;
    processClassifications(urls);
  };

  useEffect(() => {
    const map = {};
    rows.forEach(r => {
      if (r.websiteType) {
        if (r.fullUrl) map[r.fullUrl] = r.websiteType;
        if (r.displayUrl) map[r.displayUrl] = r.websiteType;
      }
    });
    setTypesMap(map);
  }, [keyword, kwObj]);

  const unclassifiedRows = rows.filter(r => {
    const rawType = typesMap[r.fullUrl] || typesMap[r.displayUrl] || r.websiteType;
    const typeVal = rawType === 'Platform' ? 'Listing' : rawType;
    return typeVal !== 'Official Entity' && typeVal !== 'Listing';
  });
  const showClassifyAllButton = rows.length > 0 && (classifying || unclassifiedRows.length > 0);

  return (
    <>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 0', fontFamily: 'var(--font-body)', fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ height: 20, width: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          Keyword: <span style={{ color: 'var(--text-primary)' }}>"{keyword}"</span>
        </span>
        {scopedProject && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
            Project: {scopedProject.name || scopedProject.domain}
          </span>
        )}
        {showClassifyAllButton && (
          <button
            onClick={handleClassify}
            disabled={classifying || rows.length === 0}
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent, #3b82f6)',
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: classifying || rows.length === 0 ? 'not-allowed' : 'pointer',
              opacity: classifying || rows.length === 0 ? 0.7 : 1,
              transition: 'all 0.15s ease',
            }}
          >
            <RefreshCw size={14} style={{ animation: classifying ? 'spin 1s linear infinite' : 'none' }} />
            {classifying ? 'Classifying…' : 'Classify All'}
          </button>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2, #f8fafc)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>competitors</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>location</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>type</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>da</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>category</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>cluster</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>serp comp level</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>comp level</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No competitor data found in rank_meta for this keyword.
                </td>
              </tr>
            ) : (
              rows.map((c, i) => {
                const rawType = typesMap[c.fullUrl] || typesMap[c.displayUrl] || c.websiteType;
                const websiteType = rawType === 'Platform' ? 'Listing' : rawType;
                return (
                  <tr
                    key={c.id || i}
                    style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td
                      style={{
                        padding: '10px 16px',
                        fontSize: 12.5,
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {(() => {
                        const cleanTitle = formatCleanName(c.competitors || c.name || c.domain);
                        const itemUrl = resolveFullCompetitorUrl(c, c.domain, c.competitors || c.name);
                        const domainUrl = c.domain ? (c.domain.startsWith('http') ? c.domain : `https://${c.domain}`) : (itemUrl ? itemUrl.split('/').slice(0, 3).join('/') : '#');
                        return (
                          <div>
                            <div style={{ marginBottom: 2 }}>
                              <a
                                href={domainUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontWeight: 600,
                                  fontSize: 13,
                                  color: 'var(--text-primary)',
                                  textDecoration: 'none',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                                onClick={e => e.stopPropagation()}
                              >
                                {cleanTitle}
                              </a>
                            </div>
                            {itemUrl && (
                              <a
                                href={itemUrl.startsWith('http') ? itemUrl : `https://${itemUrl}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={itemUrl}
                                style={{
                                  fontSize: 11.5,
                                  color: 'var(--accent, #3b82f6)',
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  textDecoration: 'none'
                                }}
                                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                              >
                                {itemUrl}
                              </a>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {c.location}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {websiteType ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12,
                          fontSize: 11, fontWeight: 600,
                          background: websiteType === 'Official Entity' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                          color: websiteType === 'Official Entity' ? '#16a34a' : '#64748b',
                          border: `1px solid ${websiteType === 'Official Entity' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 116, 139, 0.2)'}`,
                        }}>
                          {websiteType}
                        </span>
                      ) : classifying ? (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Classifying…</span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CategoryBasedCompetitorsTable({ rows, loading, scopedProject, onViewComp, competitors }) {
  const [expandedClusters, setExpandedClusters] = useState(new Set());

  const scopedCompetitors = useMemo(() => {
    if (!scopedProject) return competitors || [];
    const targetSlug = (scopedProject.slug || scopedProject.project_slug || scopedProject.name || '').toLowerCase();
    return (competitors || []).filter(c => {
      const cSlug = (c.projectSlug || c.project_slug || c.project_name || c.projectName || '').toLowerCase();
      return cSlug === targetSlug;
    });
  }, [competitors, scopedProject]);

  const clusterGroups = useMemo(() => {
    const map = {};
    (rows || []).forEach(r => {
      const clusterName = r.cluster || 'General';
      if (!map[clusterName]) {
        map[clusterName] = {
          clusterName,
          totalKeywords: 0,
          categories: [],
        };
      }
      map[clusterName].categories.push(r);
      map[clusterName].totalKeywords += (r.totalKeywords || 0);
    });
    return Object.values(map);
  }, [rows]);

  const toggleClusterExpand = (clusterName) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(clusterName)) next.delete(clusterName);
      else next.add(clusterName);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedClusters(new Set(clusterGroups.map(g => g.clusterName)));
  };

  const collapseAll = () => {
    setExpandedClusters(new Set());
  };

  return (
    <>
      {loading && (
        <div style={{ padding: '14px 20px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 13, color: '#1d4ed8', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <RefreshCw size={15} className="spin-icon" style={{ animation: 'spin 1s linear infinite' }} />
          <span>Competitors are still getting loaded… {scopedCompetitors.length > 0 ? `(${scopedCompetitors.length} loaded so far)` : ''}</span>
        </div>
      )}

      {(!rows || rows.length === 0) ? (
        <div style={{ padding: '24px 20px', background: '#fafbfc', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 16 }}>
          No categories selected. Click <strong>Find Competitors</strong> to select categories.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fafbfc'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Cluster & Category</span>
              <span style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'var(--surface-2)',
                padding: '2px 8px',
                borderRadius: 12,
                border: '1px solid var(--border)'
              }}>
                {clusterGroups.length} {clusterGroups.length === 1 ? 'Cluster' : 'Clusters'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={expandAll}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  background: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                Collapse All
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 850 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2, #f8fafc)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Category / Cluster</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>No. of Categories</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Location</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Total No. of Competitors</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px' }}>Total No. of Keywords</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)', fontSize: 12, letterSpacing: '0.3px', width: 130 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {clusterGroups.map((group) => {
                  const isExpanded = expandedClusters.has(group.clusterName);
                  const clusFilter = group.clusterName.trim().toLowerCase();
                  const uniqueClusterComps = new Set(
                    scopedCompetitors.filter(c => {
                      if (!c.cluster) return false;
                      const clusList = c.cluster.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                      return clusList.some(clus => clus === clusFilter || clus.includes(clusFilter));
                    }).map(c => (c.domain || c.name || c.url || '').toLowerCase()).filter(Boolean)
                  );

                  return (
                    <Fragment key={group.clusterName}>
                      {/* Cluster Parent Row */}
                      <tr
                        onClick={() => toggleClusterExpand(group.clusterName)}
                        style={{
                          background: '#f1f5f9',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                        onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                      >
                        <td style={{ padding: '11px 16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isExpanded ? <ChevronDown size={16} color="var(--accent)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
                            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{group.clusterName}</span>
                          </div>
                        </td>
                        <td style={{ padding: '11px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>
                          {group.categories.length}
                        </td>
                        <td style={{ padding: '11px 16px', color: 'var(--text-secondary)' }}>
                          {group.categories[0]?.location || scopedProject?.location || 'Singapore'}
                        </td>
                        <td style={{ padding: '11px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {uniqueClusterComps.size}
                        </td>
                        <td style={{ padding: '11px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {group.totalKeywords}
                        </td>
                        <td style={{ padding: '11px 16px', textAlign: 'center' }}>
                          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 500 }}>
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </span>
                        </td>
                      </tr>

                      {/* Category Child Rows */}
                      {isExpanded && group.categories.map((r, i) => {
                        const catFilter = (r.category || '').trim().toLowerCase();
                        const uniqueCatComps = new Set(
                          scopedCompetitors.filter(c => {
                            if (!c.category) return false;
                            const catList = c.category.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                            return catList.some(cat => cat === catFilter || cat.includes(catFilter));
                          }).map(c => (c.domain || c.name || c.url || '').toLowerCase()).filter(Boolean)
                        );

                        return (
                          <tr
                            key={r.category || i}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              background: '#fff',
                              transition: 'background 0.15s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                          >
                            <td style={{ padding: '10px 16px 10px 44px', fontWeight: 600, color: 'var(--text-primary)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: '#94a3b8', fontSize: 14, fontFamily: 'monospace' }}>└─</span>
                                <span style={{ fontSize: 13 }}>{r.category}</span>
                              </div>
                            </td>
                            <td style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                              1
                            </td>
                            <td style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>
                              {r.location || scopedProject?.location || 'Singapore'}
                            </td>
                            <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              {uniqueCatComps.size}
                            </td>
                            <td style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 500, color: 'var(--text-secondary)' }}>
                              {r.totalKeywords}
                            </td>
                            <td style={{ padding: '8px 16px', textAlign: 'center' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewComp(r.category);
                                }}
                                style={{
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#0f1523',
                                  color: '#fff',
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  fontFamily: 'var(--font-body)',
                                  transition: 'opacity 0.15s ease'
                                }}
                                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                              >
                                View Comp
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function resolveFullCompetitorUrl(c, domain, name) {
  if (!c && !domain && !name) return '';
  if (typeof c === 'string') return c;
  const target = c?.url || c?.fullUrl || c?.link || domain || name || '';
  if (!target) return '';
  if (target.startsWith('http://') || target.startsWith('https://')) return target;
  if (target.includes('.')) return `https://${target}`;
  return target;
}

function formatCleanName(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^https?:\/\/(www\.)?/, '');
  str = str.split('/')[0];
  return str || raw;
}

function CompetitorsTab({ competitors, scopedProject, selectedCategoriesFilter, onBack, onSelectCompetitor, onSelectKwDetail, onDeleteCompetitor, onSaveCompetitor, onBulkEditCompetitors, onBulkDeleteCompetitors, onFindCompetitors, onAddPages, hasPendingChanges, saving, saveError, onSaveChanges, loading, error, top3KwByCategory, top3KwLoading, search, findingCompetitors, user }) {
  const userCanEdit = canEdit(user);
  const userCanUpdate = canUpdate(user);
  const userCanDownload = canDownload(user);
  const [editingIdx, setEditingIdx] = useState(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkError, setBulkError] = useState('');

  // Sub-view mode inside CompetitorsTab: 'competitors' | 'pages'
  const [subView, setSubView] = useState('competitors');
  const [pageRows, setPageRows] = useState([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [selectedPageIds, setSelectedPageIds] = useState(new Set());
  const [pageFilterTargetCategory, setPageFilterTargetCategory] = useState('');
  const [pageFilterTargetType, setPageFilterTargetType] = useState('');

  const competitorsRef = useRef(competitors);
  useEffect(() => { competitorsRef.current = competitors; }, [competitors]);

  useEffect(() => {
    if (subView === 'pages' && scopedProject?.slug) {
      let cancelled = false;
      setPagesLoading(true);
      fetchCompetitorPageRows(scopedProject.slug)
        .then(rows => { if (!cancelled) setPageRows(rows || []); })
        .catch(() => { if (!cancelled) setPageRows([]); })
        .finally(() => { if (!cancelled) setPagesLoading(false); });
      return () => { cancelled = true; };
    }
  }, [subView, scopedProject?.slug]);

  const filteredPageRows = pageRows.filter(r => {
    if (pageFilterTargetCategory && r.targetCategory !== pageFilterTargetCategory) return false;
    if (pageFilterTargetType && r.targetType !== pageFilterTargetType) return false;
    return true;
  });

  const allPagesSelected = filteredPageRows.length > 0 && filteredPageRows.every(r => selectedPageIds.has(r.id || r.url));
  const somePagesSelected = !allPagesSelected && filteredPageRows.some(r => selectedPageIds.has(r.id || r.url));

  const toggleAllPages = () => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      if (allPagesSelected) filteredPageRows.forEach(r => next.delete(r.id || r.url));
      else filteredPageRows.forEach(r => next.add(r.id || r.url));
      return next;
    });
  };

  const togglePageRow = (key) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDeletePageRow = async (key) => {
    setPageRows(prev => prev.filter((r, i) => (r.id || i) !== key));
    if (typeof key === 'number') {
      try { await deleteCompetitorPageRow(key); } catch (e) { }
    }
  };

  const [categorySummaryRows, setCategorySummaryRows] = useState([]);
  const [categorySummaryLoading, setCategorySummaryLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [classifyingCompetitors, setClassifyingCompetitors] = useState(false);
  const [classifiedTypes, setClassifiedTypes] = useState({});

  const handleClassifyCategoryCompetitors = async () => {
    const unclassified = paged.filter(c => {
      const existing = classifiedTypes[c.domain] || classifiedTypes[c.name] || classifiedTypes[c.url] || c.type || c.websiteType;
      return !existing;
    });

    const urlsToClassify = unclassified
      .map(c => c.url || c.domain || c.name)
      .filter(Boolean);
    if (urlsToClassify.length === 0) return;

    setClassifyingCompetitors(true);
    try {
      const results = await classifyCompetitorUrls(urlsToClassify, categoryFilter || '');
      const newMap = { ...classifiedTypes };
      (results || []).forEach(res => {
        const rawType = res.website_type || res.websiteType || res.type;
        const finalType = rawType === 'Platform' ? 'Listing' : rawType;
        const key = res.url || res.domain;
        if (key && finalType) {
          newMap[key] = finalType;
        }
      });
      setClassifiedTypes(newMap);

      (results || []).forEach(res => {
        const rawType = res.website_type || res.websiteType || res.type;
        const finalType = rawType === 'Platform' ? 'Listing' : rawType;
        const targetComp = paged.find(c => (c.domain === res.url || c.name === res.url || c.url === res.url));
        if (targetComp && finalType && onSaveCompetitor) {
          onSaveCompetitor(targetComp, { device: finalType, type: finalType });
        }
      });
    } catch (err) {
      console.error('Failed to classify competitor URLs:', err);
    } finally {
      setClassifyingCompetitors(false);
    }
  };

  useEffect(() => {
    if (scopedProject?.slug) {
      let cancelled = false;
      setCategorySummaryLoading(true);
      fetchKeywordRows(scopedProject.slug)
        .then(rows => {
          if (cancelled) return;
          const map = {};
          (rows || []).filter(r => r.kw).forEach(r => {
            const cat = r.category || r.targetSubtype || 'General';
            const clus = r.cluster || 'General';
            const loc = r.targetGeo || scopedProject?.location || 'Singapore';

            if (!map[cat]) {
              map[cat] = {
                category: cat,
                cluster: clus,
                location: loc,
                totalKeywords: 0,
              };
            }
            map[cat].totalKeywords += 1;
          });

          // Also include categories from competitor rows for this project
          const targetSlug = (scopedProject?.slug || scopedProject?.project_slug || scopedProject?.name || '').toLowerCase();
          (competitorsRef.current || []).filter(c => {
            const cSlug = (c.projectSlug || c.project_slug || c.project_name || '').toLowerCase();
            return cSlug === targetSlug && c.category;
          }).forEach(c => {
            const catList = c.category.split(',').map(s => s.trim()).filter(Boolean);
            catList.forEach(cat => {
              if (!map[cat]) {
                map[cat] = {
                  category: cat,
                  cluster: c.cluster || 'General',
                  location: c.location || scopedProject?.location || 'Singapore',
                  totalKeywords: c.totalKw || 0,
                };
              }
            });
          });

          setCategorySummaryRows(Object.values(map));
        })
        .catch(() => { if (!cancelled) setCategorySummaryRows([]); })
        .finally(() => { if (!cancelled) setCategorySummaryLoading(false); });
      return () => { cancelled = true; };
    }
  }, [scopedProject?.slug, competitors]);

  const [tableFilters, setTableFilters] = useState({
    category: [],
    cluster: [],
    type: [],
    da: { min: '', max: '' },
    commonKw: { min: '', max: '' },
  });

  const competitorFilterConfigs = [
    { key: 'category', label: 'Category', type: 'select' },
    { key: 'cluster', label: 'Cluster', type: 'select' },
    { key: 'type', label: 'Type', type: 'select', options: ['Official Entity', 'Listing'] },
    { key: 'commonKw', label: 'Common KWs', type: 'range' },
    { key: 'da', label: 'DA', type: 'range' },
  ];

  const targetSlug = (scopedProject?.slug || scopedProject?.project_slug || scopedProject?.name || '').toLowerCase();
  const baseFiltered = scopedProject
    ? competitors.filter(c => {
      const cSlug = (c.projectSlug || c.project_slug || c.project_name || '').toLowerCase();
      return cSlug === targetSlug;
    })
    : competitors;
  const filtered = baseFiltered
    .filter(c => {
      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        const n = (c.name || '').toLowerCase();
        const d = (c.domain || '').toLowerCase();
        const u = (c.url || '').toLowerCase();
        const cat = (c.category || '').toLowerCase();
        const clus = (c.cluster || '').toLowerCase();
        if (!n.includes(q) && !d.includes(q) && !u.includes(q) && !cat.includes(q) && !clus.includes(q)) return false;
      }
      if (categoryFilter) {
        const filterLower = categoryFilter.trim().toLowerCase();
        const cCats = (c.category || c.targetSubtype || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const cClus = (c.cluster || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const matches = cCats.some(cat => cat === filterLower || cat.includes(filterLower) || filterLower.includes(cat)) ||
          cClus.some(clus => clus === filterLower || clus.includes(filterLower) || filterLower.includes(clus));
        if (!matches) return false;
      }
      if (tableFilters.category?.length) {
        const cCats = (c.category || '').split(',').map(s => s.trim().toLowerCase());
        const hasMatch = tableFilters.category.some(selCat => cCats.includes(selCat.toLowerCase()));
        if (!hasMatch) return false;
      }
      if (tableFilters.cluster?.length) {
        const cClus = (c.cluster || '').split(',').map(s => s.trim().toLowerCase());
        const hasMatch = tableFilters.cluster.some(selClus => cClus.includes(selClus.toLowerCase()));
        if (!hasMatch) return false;
      }
      if (tableFilters.type?.length) {
        const cType = c.type || c.websiteType || '';
        if (!tableFilters.type.some(selType => selType.toLowerCase() === cType.toLowerCase())) return false;
      }
      if (tableFilters.da?.min !== '' && (c.da == null || Number(c.da) < Number(tableFilters.da.min))) return false;
      if (tableFilters.da?.max !== '' && (c.da == null || Number(c.da) > Number(tableFilters.da.max))) return false;
      if (tableFilters.commonKw?.min !== '' && (c.commonKw == null || Number(c.commonKw) < Number(tableFilters.commonKw.min))) return false;
      if (tableFilters.commonKw?.max !== '' && (c.commonKw == null || Number(c.commonKw) > Number(tableFilters.commonKw.max))) return false;
      return true;
    })
    .slice()
    .sort((a, b) => (b.commonKw ?? 0) - (a.commonKw ?? 0));
  const pageCount = Math.max(1, Math.ceil(filtered.length / COMPETITORS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * COMPETITORS_PAGE_SIZE, safePage * COMPETITORS_PAGE_SIZE);

  const allSelected = paged.length > 0 && paged.every(c => selectedIds.has(c.id));
  const someSelected = !allSelected && paged.some(c => selectedIds.has(c.id));

  const toggleAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) paged.forEach(c => next.delete(c.id));
      else paged.forEach(c => next.add(c.id));
      return next;
    });
  };

  const toggleRow = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkEditApply = async (field, value) => {
    setBulkError('');
    try {
      await onBulkEditCompetitors(Array.from(selectedIds), field, value);
      setSelectedIds(new Set());
    } catch (err) {
      setBulkError(err.message || 'Failed to bulk edit.');
    }
  };

  const handleBulkDelete = async () => {
    setBulkError('');
    try {
      await onBulkDeleteCompetitors(Array.from(selectedIds));
      setSelectedIds(new Set());
    } catch (err) {
      setBulkError(err.message || 'Failed to bulk delete.');
    }
  };

  useEffect(() => { setPage(1); setSelectedIds(new Set()); setSubView('competitors'); }, [scopedProject?.slug]);

  const displayedCategorySummaryRows = (selectedCategoriesFilter && selectedCategoriesFilter.length > 0)
    ? categorySummaryRows.filter(r => selectedCategoriesFilter.some(c => r.category.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(r.category.toLowerCase()) || (r.cluster && (r.cluster.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(r.cluster.toLowerCase())))))
    : categorySummaryRows;

  return (
    <>
      {scopedProject && (
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Row 1: Back, Project Name, Filters & Tools */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 0', fontFamily: 'var(--font-body)', fontSize: 13 }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>
              <ArrowLeft size={16} /> Back
            </button>
            <div style={{ height: 20, width: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{scopedProject.name}</span>
            {subView === 'competitors' && (
              <>
                <TableFilterDropdown
                  filters={competitorFilterConfigs}
                  rows={baseFiltered}
                  activeFilters={tableFilters}
                  onFiltersChange={setTableFilters}
                />
                <ActionsDropdown
                  selectedCount={selectedIds.size}
                  onBulkEdit={() => setShowBulkEdit(true)}
                  onBulkDelete={() => setShowBulkDelete(true)}
                />
                {userCanDownload && (
                  <button
                    onClick={() => {
                      const rowsToExport = filtered.map(c => ({
                        Competitor: c.name || c.domain,
                        Domain: c.domain,
                        Device: c.device || 'Desktop',
                        Location: c.location,
                        DA: c.da ?? '',
                        'Common KWs': Math.round(((c.commonKw ?? 0) / 100) * c.totalKw),
                        'Total KWs': c.totalKw,
                        'SERP Comp Level': c.serpCompLevel,
                        'Comp Level': c.compLevel,
                      }));
                      downloadCSV(`${scopedProject?.name || 'competitors'}_list`, rowsToExport);
                    }}
                    title="Download CSV"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--surface-2)', color: 'var(--text-secondary)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      padding: '7px 10px', cursor: 'pointer',
                      fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    <Download size={14} />
                  </button>
                )}
              </>
            )}
            <div style={{ flex: 1 }} />
            {(saveError || bulkError) && (
              <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{saveError || bulkError}</span>
            )}
            {hasPendingChanges && !saving && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Unsaved changes</span>
            )}
            {hasPendingChanges && (
              <button
                onClick={onSaveChanges}
                disabled={saving}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#0f1523', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: saving ? 'default' : 'pointer',
                  fontFamily: 'var(--font-body)', opacity: saving ? 0.6 : 1, transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { if (!saving) e.currentTarget.style.opacity = '1'; }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>

          {/* Row 2: Find Competitors and Add Pages buttons below Project Name */}
          {(userCanUpdate || userCanEdit) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingTop: 2 }}>
              {userCanUpdate && (
                <button
                  onClick={() => {
                    if (subView === 'competitors') {
                      onFindCompetitors?.();
                    } else {
                      setSubView('competitors');
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: subView === 'competitors' ? '#0f1523' : '#fff',
                    color: subView === 'competitors' ? '#fff' : '#0f1523',
                    border: subView === 'competitors' ? 'none' : '1.5px solid #0f1523',
                    borderRadius: 8,
                    padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--font-body)', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  Find Competitors
                </button>
              )}
              {userCanEdit && (
                <button
                  onClick={() => {
                    if (subView === 'pages') {
                      onAddPages?.();
                    } else {
                      setSubView('pages');
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: subView === 'pages' ? '#0f1523' : '#fff',
                    color: subView === 'pages' ? '#fff' : '#0f1523',
                    border: subView === 'pages' ? 'none' : '1.5px solid #0f1523',
                    borderRadius: 8,
                    padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--font-body)', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <Plus size={14} />
                  Add Pages
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {subView === 'pages' ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                  <div
                    onClick={toggleAllPages}
                    style={{
                      width: 18, height: 18, borderRadius: 4,
                      border: allPagesSelected || somePagesSelected ? '2px solid var(--accent)' : '2px solid #d1d5db',
                      background: allPagesSelected ? 'var(--accent)' : somePagesSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                    }}
                  >
                    {allPagesSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                    {somePagesSelected && <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />}
                  </div>
                </th>
                {['Page Name', 'URL', 'Cluster', 'Category'].map((h, i) => (
                  <th key={i} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h}</th>
                ))}
                <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                  <HeaderQuickSelect placeholder="Target Type" options={['Blogs', 'Landing Page']} value={pageFilterTargetCategory} onSet={setPageFilterTargetCategory} />
                </th>
                <th style={{ padding: '6px 16px', textAlign: 'left' }}>
                  <HeaderQuickSelect placeholder="Target Subtype" options={['Commercial', 'Informational']} value={pageFilterTargetType} onSet={setPageFilterTargetType} />
                </th>
                <th style={{ padding: '10px 16px' }}></th>
              </tr>
            </thead>
            <tbody>
              {pagesLoading ? (
                <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading pages…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pages added yet. Click <strong>Add Pages</strong> to import.</td></tr>
              ) : filteredPageRows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pages match the selected filters.</td></tr>
              ) : filteredPageRows.map((r, i) => (
                <tr key={r.id || i} style={{ borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                    <div
                      onClick={() => togglePageRow(r.id || i)}
                      style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: selectedPageIds.has(r.id || i) ? '2px solid var(--accent)' : '2px solid #d1d5db',
                        background: selectedPageIds.has(r.id || i) ? 'var(--accent)' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                      }}
                    >
                      {selectedPageIds.has(r.id || i) && <Check size={11} color="#fff" strokeWidth={3} />}
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', maxWidth: 200 }}>{r.pageName || r.name || r.kw || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--accent)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.url || r.landingPage || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.cluster || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.category || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetCategory ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetCategory || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetType ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetType || '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <button onClick={() => handleDeletePageRow(r.id || i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--red)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : categoryFilter === null ? (
        <CategoryBasedCompetitorsTable
          rows={displayedCategorySummaryRows}
          loading={categorySummaryLoading || loading || findingCompetitors}
          scopedProject={scopedProject}
          competitors={competitors}
          onViewComp={(catName) => {
            setCategoryFilter(catName);
            setPage(1);
          }}
        />
      ) : (
        <>
          <div style={{
            padding: '10px 16px',
            marginBottom: 14,
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justify: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => setCategoryFilter(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#fff',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12.5,
                  fontWeight: 600
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-primary)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <ArrowLeft size={14} /> Back
              </button>
              <div style={{ height: 18, width: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                Competitors for Category: <span style={{ color: 'var(--accent)' }}>"{categoryFilter}"</span>
              </span>
            </div>

            {(() => {
              const unclassifiedPaged = paged.filter(c => {
                const rawType = classifiedTypes[c.domain] || classifiedTypes[c.name] || classifiedTypes[c.url] || c.type || c.websiteType;
                const typeVal = rawType === 'Platform' ? 'Listing' : rawType;
                return typeVal !== 'Official Entity' && typeVal !== 'Listing';
              });
              const showCategoryClassifyAll = paged.length > 0 && (classifyingCompetitors || unclassifiedPaged.length > 0);

              if (!showCategoryClassifyAll) return null;

              return (
                <button
                  onClick={handleClassifyCategoryCompetitors}
                  disabled={classifyingCompetitors || paged.length === 0}
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'var(--accent, #3b82f6)',
                    color: '#fff',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: classifyingCompetitors || paged.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: classifyingCompetitors || paged.length === 0 ? 0.7 : 1,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <RefreshCw size={14} style={{ animation: classifyingCompetitors ? 'spin 1s linear infinite' : 'none' }} />
                  {classifyingCompetitors ? 'Classifying…' : 'Classify All'}
                </button>
              );
            })()}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2, #f8fafc)' }}>
                  <th style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                    <div
                      onClick={toggleAll}
                      style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: allSelected || someSelected ? '2px solid var(--accent)' : '2px solid #d1d5db',
                        background: allSelected ? 'var(--accent)' : someSelected ? 'var(--accent)' : '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                      }}
                    >
                      {allSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                      {someSelected && <span style={{ width: 8, height: 2, background: '#fff', borderRadius: 1, display: 'block' }} />}
                    </div>
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Competitors</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Type</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>DA</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Common KWs</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Category</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Cluster</th>
                  <th style={{ padding: '12px 16px' }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading competitors…</td></tr>
                ) : error ? (
                  <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
                ) : paged.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No competitors found for category "{categoryFilter}".</td></tr>
                ) : paged.map((c, i) => {
                  const catList = c.category ? c.category.split(',').map(s => s.trim()).filter(Boolean) : [];
                  const clusList = c.cluster ? c.cluster.split(',').map(s => s.trim()).filter(Boolean) : [];
                  const commonKwVal = Math.round(((c.commonKw ?? 0) / 100) * (c.totalKw || 0));

                  const fullUrl = resolveFullCompetitorUrl(c, c.domain, c.name);
                  const displayName = formatCleanName(c.name || c.domain || c.url || c.fullUrl);
                  const domainUrl = c.domain ? (c.domain.startsWith('http') ? c.domain : `https://${c.domain}`) : (fullUrl ? fullUrl.split('/').slice(0, 3).join('/') : '#');

                  return (
                    <tr key={c.id || i} style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '10px 12px 10px 16px', width: 36 }}>
                        <div
                          onClick={() => toggleRow(c.id)}
                          style={{
                            width: 18, height: 18, borderRadius: 4,
                            border: selectedIds.has(c.id) ? '2px solid var(--accent)' : '2px solid #d1d5db',
                            background: selectedIds.has(c.id) ? 'var(--accent)' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
                          }}
                        >
                          {selectedIds.has(c.id) && <Check size={11} color="#fff" strokeWidth={3} />}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ marginBottom: 2 }}>
                          <a
                            href={domainUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 13.5,
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              textDecoration: 'none',
                              cursor: 'pointer'
                            }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                            onClick={e => e.stopPropagation()}
                          >
                            {displayName}
                          </a>
                        </div>
                        {fullUrl && (
                          <a
                            href={fullUrl.startsWith('http') ? fullUrl : `https://${fullUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={fullUrl}
                            style={{
                              fontSize: 12,
                              color: 'var(--accent, #3b82f6)',
                              cursor: 'pointer',
                              textDecoration: 'none',
                              display: 'block',
                              maxWidth: 250,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              marginTop: 1
                            }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                            onClick={e => e.stopPropagation()}
                          >
                            {fullUrl}
                          </a>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {(() => {
                          const rawType = classifiedTypes[c.domain] || classifiedTypes[c.name] || classifiedTypes[c.url] || c.type || c.websiteType || (c.device !== 'Desktop' && c.device !== 'Mobile' ? c.device : null);
                          const typeVal = rawType === 'Platform' ? 'Listing' : rawType;
                          if (!typeVal) return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</span>;
                          return (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 12,
                              fontSize: 11, fontWeight: 600,
                              background: typeVal === 'Official Entity' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                              color: typeVal === 'Official Entity' ? '#16a34a' : '#64748b',
                              border: `1px solid ${typeVal === 'Official Entity' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 116, 139, 0.2)'}`,
                            }}>
                              {typeVal}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{c.da ?? '—'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{commonKwVal}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }} title={c.category || ''}>
                        {catList.length ? `${catList.length} ` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }} title={c.cluster || ''}>
                        {clusList.length ? `${clusList.length} ` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {userCanEdit && (
                          <button onClick={() => setEditingIdx(filtered.indexOf(c))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                            <Edit2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <EditCompetitorModal
        open={editingIdx !== null}
        onClose={() => setEditingIdx(null)}
        competitor={editingIdx !== null ? competitors[editingIdx] : null}
        onSave={editingIdx !== null ? (updates) => onSaveCompetitor?.(competitors[editingIdx], updates) : undefined}
        onDelete={editingIdx !== null ? () => onDeleteCompetitor?.(editingIdx) : undefined}
      />
      <BulkEditModal open={showBulkEdit} onClose={() => setShowBulkEdit(false)} count={selectedIds.size} onApply={handleBulkEditApply} fields={COMPETITOR_BULK_FIELDS} itemLabel="competitor" />
      <BulkDeleteModal open={showBulkDelete} onClose={() => setShowBulkDelete(false)} count={selectedIds.size} onConfirm={handleBulkDelete} itemLabel="competitor" />
    </>
  );
}

function PrerequisiteModal({ open, onClose, title, message, actionLabel, onAction }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, maxWidth: 420, width: '100%',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        border: '1px solid var(--border)', overflow: 'hidden'
      }}>
        <div style={{ padding: '24px 24px 16px 24px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10, background: '#fef3c7',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <AlertCircle size={22} color="#d97706" />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, margin: 0 }}>
              {title || 'Action Required'}
            </h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              {message}
            </p>
          </div>
        </div>
        <div style={{
          padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10,
          background: '#fafbfc', borderTop: '1px solid var(--border)'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
              background: '#fff', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          {actionLabel && (
            <button
              onClick={() => { onClose(); onAction?.(); }}
              style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: 'var(--accent, #0f1523)', fontSize: 13, fontWeight: 600, color: '#fff',
                cursor: 'pointer'
              }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectSetupPage({ tab, user }) {
  const isReadOnly = isReadOnlyUser(user);
  const userCanEdit = canEdit(user);
  const userCanDelete = canDelete(user);
  const userCanDownload = canDownload(user);
  const [activeTab, setActiveTab] = useState(tab || 'Domain');
  useEffect(() => { if (tab) { setActiveTab(tab); setSelectedPageProject(null); setSelectedCompetitor(null); setSelectedCompetitorProject(null); setSelectedKwProject(null); setSearch(''); } }, [tab]);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [pages, setPages] = useState([]);
  const [pagesCounts, setPagesCounts] = useState({});
  const [pagesStats, setPagesStats] = useState({});
  const [kwClusters, setKwClusters] = useState([]);
  const [kwClustersLoading, setKwClustersLoading] = useState(true);
  const [kwClustersError, setKwClustersError] = useState('');
  const [selectedPageProject, setSelectedPageProject] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [competitorsLoading, setCompetitorsLoading] = useState(true);
  const [competitorsError, setCompetitorsError] = useState('');
  const [selectedCompetitor, setSelectedCompetitor] = useState(null);
  const [selectedCompetitorProject, setSelectedCompetitorProject] = useState(null);
  const [selectedCategoriesFilter, setSelectedCategoriesFilter] = useState(null);
  const [selectedKwProject, setSelectedKwProject] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddPages, setShowAddPages] = useState(false);
  const [showAddKeywords, setShowAddKeywords] = useState(false);
  const [showChooseProject, setShowChooseProject] = useState(false);
  const [chooseProjectMode, setChooseProjectMode] = useState('findCompetitors');
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [findingCompetitors, setFindingCompetitors] = useState(false);
  const [findCompetitorsMessage, setFindCompetitorsMessage] = useState('');
  const [competitorsRefreshing, setCompetitorsRefreshing] = useState(false);
  const [showRefindConfirm, setShowRefindConfirm] = useState(false);
  const [pendingFindProject, setPendingFindProject] = useState(null);
  const [competitorPendingUpdates, setCompetitorPendingUpdates] = useState(new Map());
  const [competitorPendingDeleteIds, setCompetitorPendingDeleteIds] = useState(new Set());
  const [competitorSaving, setCompetitorSaving] = useState(false);
  const [competitorSaveError, setCompetitorSaveError] = useState('');
  const [top3KwByCategory, setTop3KwByCategory] = useState({});
  const [top3KwLoading, setTop3KwLoading] = useState(false);
  const [selectedKwDetail, setSelectedKwDetail] = useState(null);
  const [prerequisiteModal, setPrerequisiteModal] = useState({ open: false, title: '', message: '', targetTab: '' });
  const [domainFilters, setDomainFilters] = useState({
    platform: '', location: '', daMin: '', daMax: '', trafficMin: '', trafficMax: '',
    keywordsMin: '', keywordsMax: '', targetPagesMin: '', targetPagesMax: '', blogPagesMin: '', blogPagesMax: '',
  });
  const [showDomainFilterDropdown, setShowDomainFilterDropdown] = useState(false);
  const activeDomainFilterCount = [
    domainFilters.platform, domainFilters.location, domainFilters.daMin, domainFilters.daMax, domainFilters.trafficMin, domainFilters.trafficMax,
    domainFilters.keywordsMin, domainFilters.keywordsMax, domainFilters.targetPagesMin, domainFilters.targetPagesMax, domainFilters.blogPagesMin, domainFilters.blogPagesMax,
  ].filter(Boolean).length;
  const domainFilterRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (domainFilterRef.current && !domainFilterRef.current.contains(e.target)) {
        setShowDomainFilterDropdown(false);
      }
    };
    if (showDomainFilterDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDomainFilterDropdown]);
  const hasCompetitorPendingChanges = competitorPendingUpdates.size > 0 || competitorPendingDeleteIds.size > 0;

  const checkProjectPrerequisites = (project, targetTab) => {
    if (!project) return true;
    const slug = (project.slug || project.project_slug || '').toLowerCase();
    const projName = project.name || project.project_name || 'this project';

    // 1. Check Domain
    const domainRow = projects.find(p => (p.slug || p.project_slug || '').toLowerCase() === slug);
    const hasDomain = domainRow && domainRow.domain && String(domainRow.domain).trim() !== '';
    if (!hasDomain) {
      setPrerequisiteModal({
        open: true,
        title: 'Domain Not Set',
        message: `Please set the domain first for "${projName}" before proceeding.`,
        targetTab: 'Domain'
      });
      return false;
    }

    // 2. Check Intent (Category & Cluster) for this project
    const kwProj = kwClusters.find(k => (k.slug || k.project_slug || '').toLowerCase() === slug);
    const hasIntent = Boolean(kwProj && (kwProj.totalPages > 0 || kwProj.keywords > 0 || (kwProj.detailKeywords && kwProj.detailKeywords.length > 0)));
    if (targetTab === 'Pages' || targetTab === 'Competitors') {
      if (!hasIntent) {
        setPrerequisiteModal({
          open: true,
          title: 'Intent Not Set',
          message: `Please set the intent (category & cluster) first for "${projName}".`,
          targetTab: 'Intent'
        });
        return false;
      }
    }

    // 3. Check Pages for this project
    const pageCount = pagesCounts[slug] ?? pagesCounts[project.slug] ?? 0;
    const hasPages = pageCount > 0 || pages.some(p => (p.slug || p.project_slug || '').toLowerCase() === slug && (p.totalPages > 0 || (p.detailPages && p.detailPages.length > 0)));
    if (targetTab === 'Competitors') {
      if (!hasPages) {
        setPrerequisiteModal({
          open: true,
          title: 'Pages Not Set',
          message: `Please set the pages first for "${projName}".`,
          targetTab: 'Pages'
        });
        return false;
      }
    }

    return true;
  };

  const checkPrerequisites = (targetTab) => {
    const hasDomain = projects && projects.some(p => p.domain && String(p.domain).trim() !== '');
    const hasIntent = kwClusters && kwClusters.some(k => k.totalPages > 0 || k.keywords > 0);
    const totalPages = (pages && pages.length > 0)
      ? pages.length
      : Object.values(pagesCounts || {}).reduce((sum, count) => sum + (Number(count) || 0), 0);
    const hasPages = totalPages > 0;

    if (targetTab === 'Intent') {
      if (!hasDomain && !projectsLoading) {
        setPrerequisiteModal({
          open: true,
          title: 'Domain Not Set',
          message: 'Please set the domain first before proceeding to Intent.',
          targetTab: 'Domain'
        });
        return false;
      }
    }

    if (targetTab === 'Pages') {
      if (!hasDomain && !projectsLoading) {
        setPrerequisiteModal({
          open: true,
          title: 'Domain Not Set',
          message: 'Please set the domain first before proceeding to Pages.',
          targetTab: 'Domain'
        });
        return false;
      }
      if (!hasIntent && !kwClustersLoading) {
        setPrerequisiteModal({
          open: true,
          title: 'Intent Not Set',
          message: 'Please set the intent first before proceeding to Pages.',
          targetTab: 'Intent'
        });
        return false;
      }
    }

    if (targetTab === 'Competitors') {
      if (!hasDomain && !projectsLoading) {
        setPrerequisiteModal({
          open: true,
          title: 'Domain Not Set',
          message: 'Please set the domain first before proceeding to Competitors.',
          targetTab: 'Domain'
        });
        return false;
      }
      if (!hasIntent && !kwClustersLoading) {
        setPrerequisiteModal({
          open: true,
          title: 'Intent Not Set',
          message: 'Please set the intent first before proceeding to Competitors.',
          targetTab: 'Intent'
        });
        return false;
      }
      if (!hasPages) {
        setPrerequisiteModal({
          open: true,
          title: 'Pages Not Set',
          message: 'Please set the pages first before proceeding to Competitors.',
          targetTab: 'Pages'
        });
        return false;
      }
    }

    return true;
  };

  const handleTabClick = (t) => {
    if (!checkPrerequisites(t)) return;

    if (t === activeTab) {
      if (t === 'Pages') setShowAddPages(true);
      if (t === 'Intent') setShowAddKeywords(true);
      if (t === 'Domain') setShowCreate(true);
      return;
    }

    if (activeTab === 'Outreach' && hasOutreachPendingChanges) {
      if (!window.confirm('You have unsaved changes. Discard them?')) return;
      setOutreachPendingUpdates(new Map());
      setOutreachPendingDeleteIds(new Set());
    }

    setActiveTab(t);
    setSelectedPageProject(null);
    setSelectedCompetitor(null);
    setSelectedCompetitorProject(null);
    setSelectedKwProject(null);
    setSelectedKwDetail(null);
    setSearch('');
  };

  const [outreachLinks, setOutreachLinks] = useState([]);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [showAddOutreach, setShowAddOutreach] = useState(false);
  const [newOutreachLink, setNewOutreachLink] = useState('');
  const [newOutreachType, setNewOutreachType] = useState('Paid Guest');
  const [outreachCsvRows, setOutreachCsvRows] = useState([]);
  const [outreachFileName, setOutreachFileName] = useState('');
  const [outreachError, setOutreachError] = useState('');
  const [addingOutreach, setAddingOutreach] = useState(false);
  const [deletingOutreachLink, setDeletingOutreachLink] = useState(null);

  const OUTREACH_TYPES = useMemo(() => ['Paid Guest', 'Classified Ads', 'Brand Mention', 'Business Listing'], []);

  const outreachFilterConfigs = useMemo(() => [
    { key: 'type', label: 'Type', type: 'select', options: ['Paid Guest', 'Classified Ads', 'Brand Mention', 'Business Listing'] },
    { key: 'da', label: 'DA', type: 'range' },
    { key: 'pa', label: 'PA', type: 'range' },
    { key: 'ss', label: 'Spam Score (SS)', type: 'range' },
    { key: 'traffic', label: 'Traffic', type: 'range' },
  ], []);

  const [outreachTableFilters, setOutreachTableFilters] = useState({
    type: [],
    da: { min: '', max: '' },
    pa: { min: '', max: '' },
    ss: { min: '', max: '' },
    traffic: { min: '', max: '' }
  });

  const [selectedOutreachIds, setSelectedOutreachIds] = useState(new Set());
  const [showBulkEditOutreach, setShowBulkEditOutreach] = useState(false);
  const [showBulkDeleteOutreachConfirm, setShowBulkDeleteOutreachConfirm] = useState(false);
  const [bulkEditOutreachData, setBulkEditOutreachData] = useState({
    type: 'Paid Guest',
    da: '',
    pa: '',
    ss: '',
    traffic: ''
  });

  const [outreachPendingUpdates, setOutreachPendingUpdates] = useState(new Map());
  const [outreachPendingDeleteIds, setOutreachPendingDeleteIds] = useState(new Set());
  const [outreachSaving, setOutreachSaving] = useState(false);
  const [outreachSaveError, setOutreachSaveError] = useState('');
  const hasOutreachPendingChanges = outreachPendingUpdates.size > 0 || outreachPendingDeleteIds.size > 0;

  const handleToggleSelectOutreach = (id) => {
    setSelectedOutreachIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllOutreach = (visibleLinks) => {
    if (!visibleLinks || visibleLinks.length === 0) return;
    const allSelected = visibleLinks.every(lnk => selectedOutreachIds.has(lnk.id));
    if (allSelected) {
      setSelectedOutreachIds(new Set());
    } else {
      setSelectedOutreachIds(new Set(visibleLinks.map(lnk => lnk.id)));
    }
  };

  const handleOutreachTypeChange = (lnkId, newType) => {
    setOutreachLinks(prev => prev.map(l => l.id === lnkId ? { ...l, type: newType } : l));
    setOutreachPendingUpdates(prev => {
      const next = new Map(prev);
      const existing = next.get(lnkId) || {};
      next.set(lnkId, { ...existing, type: newType });
      return next;
    });
  };

  const handleBulkEditOutreachSave = () => {
    const ids = Array.from(selectedOutreachIds);
    if (!ids.length) return;

    const updates = {};
    if (bulkEditOutreachData.type) updates.type = bulkEditOutreachData.type;

    setOutreachLinks(prev => prev.map(l => {
      if (selectedOutreachIds.has(l.id)) {
        return {
          ...l,
          ...(updates.type ? { type: updates.type } : {})
        };
      }
      return l;
    }));

    setOutreachPendingUpdates(prev => {
      const next = new Map(prev);
      ids.forEach(id => {
        const existing = next.get(id) || {};
        next.set(id, { ...existing, ...updates });
      });
      return next;
    });

    setShowBulkEditOutreach(false);
    setSelectedOutreachIds(new Set());
  };

  const handleBulkDeleteOutreachConfirm = () => {
    const ids = Array.from(selectedOutreachIds);
    if (!ids.length) return;

    setOutreachLinks(prev => prev.filter(l => !selectedOutreachIds.has(l.id)));

    setOutreachPendingDeleteIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      return next;
    });

    setShowBulkDeleteOutreachConfirm(false);
    setSelectedOutreachIds(new Set());
  };

  const handleDeleteOutreachLink = (id) => {
    setOutreachLinks(prev => prev.filter(lnk => lnk.id !== id));
    setOutreachPendingDeleteIds(prev => new Set(prev).add(id));
  };

  const handleSaveOutreachChanges = async () => {
    const pSlug = activeProject?.project_slug || activeProject?.slug;
    if (!pSlug) return;
    setOutreachSaving(true);
    setOutreachSaveError('');
    try {
      if (outreachPendingDeleteIds.size > 0) {
        await bulkDeleteOutreachSitesApi(pSlug, Array.from(outreachPendingDeleteIds));
      }
      if (outreachPendingUpdates.size > 0) {
        for (const [id, updates] of outreachPendingUpdates.entries()) {
          await updateOutreachSiteApi(pSlug, id, updates);
        }
      }
      setOutreachPendingUpdates(new Map());
      setOutreachPendingDeleteIds(new Set());
    } catch (err) {
      setOutreachSaveError(err.message || 'Failed to save outreach changes.');
    } finally {
      setOutreachSaving(false);
    }
  };

  const downloadOutreachSampleTemplate = async () => {
    const headers = ['URL', 'Type'];
    const sampleRows = [
      ['https://example.com/outreach', 'Paid Guest'],
      ['https://businessdirectory.org/listing', 'Business Listing'],
    ];

    const thinGrayBorder = { style: 'thin', color: { argb: 'FF999999' } };
    const cellBorder = { top: thinGrayBorder, left: thinGrayBorder, bottom: thinGrayBorder, right: thinGrayBorder };

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Outreach Sites');
    sheet.columns = headers.map(h => ({ header: h, width: Math.max(14, h.length + 4) }));

    sheet.getRow(1).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C000' } };
      cell.font = { bold: true, color: { argb: 'FF000000' } };
      cell.border = cellBorder;
    });

    sampleRows.forEach(rowValues => {
      const row = sheet.addRow(rowValues);
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8C8C8' } };
        cell.border = cellBorder;
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'outreach-sites-template.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const parseOutreachDelimited = (text, delimiter) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
      return { url: cols[0] || '', type: cols[1] || 'Paid Guest' };
    }).filter(r => r.url);
  };

  const parseOutreachExcel = (buffer) => {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return rows.slice(1).map(cols => ({
      url: String(cols[0] ?? '').trim(),
      type: String(cols[1] ?? '').trim() || 'Paid Guest',
    })).filter(r => r.url);
  };

  const handleOutreachFileUpload = (file) => {
    if (!file) return;
    setOutreachFileName(file.name);
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rows = parseOutreachExcel(e.target.result);
        setOutreachCsvRows(rows);
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const delimiter = ext === 'tsv' ? '\t' : ',';
        const rows = parseOutreachDelimited(e.target.result, delimiter);
        setOutreachCsvRows(rows);
      };
      reader.readAsText(file);
    }
  };

  // Determine active project for Outreach
  const activeProject = useMemo(() => {
    if (selectedCompetitorProject) return selectedCompetitorProject;
    if (selectedPageProject !== null && pages[selectedPageProject]) return pages[selectedPageProject];
    if (selectedKwProject !== null && kwClusters[selectedKwProject]) return kwClusters[selectedKwProject];
    if (projects && projects.length > 0) return projects[0];
    return null;
  }, [selectedCompetitorProject, selectedPageProject, pages, selectedKwProject, kwClusters, projects]);

  // Fetch outreach sites whenever active tab changes (not scoped by project)
  useEffect(() => {
    if (activeTab !== 'Outreach') return;
    let cancelled = false;
    setOutreachLoading(true);
    fetchOutreachSitesApi(null)
      .then(sites => {
        if (!cancelled) {
          const mapped = sites.map(s => ({
            id: s.id,
            url: s.url,
            domain: s.domain,
            type: s.type || s.site_type || s.website_type || 'Paid Guest',
            da: s.da,
            pa: s.pa,
            ss: s.ss,
            traffic: s.traffic,
            totalTraffic: s.total_traffic || s.totalTraffic,
            region1Traffic: s.region1_traffic || s.region1Traffic,
            region2Traffic: s.region2_traffic || s.region2Traffic,
            region3Traffic: s.region3_traffic || s.region3Traffic
          }));
          setOutreachLinks(mapped);
        }
      })
      .catch(err => {
        if (!cancelled) console.error("Error fetching outreach sites:", err);
      })
      .finally(() => {
        if (!cancelled) setOutreachLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab]);

  const handleAddOutreachLink = async (e) => {
    if (e) e.preventDefault();
    setOutreachError('');

    const pSlug = activeProject?.project_slug || activeProject?.slug;
    if (!pSlug) {
      setOutreachError('Please select or create a project first.');
      return;
    }

    const targetRegions = activeProject?.target_regions || ['in', 'us', 'uk'];

    if (outreachCsvRows.length > 0) {
      setAddingOutreach(true);
      try {
        const newMappedSites = [];
        for (const r of outreachCsvRows) {
          let link = r.url;
          if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
          try {
            const newSite = await addOutreachSiteApi(pSlug, link, targetRegions, r.type || 'Paid Guest');
            newMappedSites.push({
              id: newSite.id,
              url: newSite.url,
              domain: newSite.domain,
              type: newSite.type || r.type || 'Paid Guest',
              da: newSite.da,
              pa: newSite.pa,
              ss: newSite.ss,
              traffic: newSite.traffic,
              totalTraffic: newSite.total_traffic || newSite.totalTraffic,
              region1Traffic: newSite.region1_traffic || newSite.region1Traffic,
              region2Traffic: newSite.region2_traffic || newSite.region2Traffic,
              region3Traffic: newSite.region3_traffic || newSite.region3Traffic
            });
          } catch (err) {
            console.error('Failed to import outreach site:', link, err);
          }
        }
        setOutreachLinks(prev => [...newMappedSites, ...prev]);
        setNewOutreachLink('');
        setOutreachCsvRows([]);
        setOutreachFileName('');
        setShowAddOutreach(false);
      } catch (err) {
        setOutreachError(err.message || 'Failed to import outreach sites.');
      } finally {
        setAddingOutreach(false);
      }
      return;
    }

    let link = newOutreachLink.trim();
    if (!link) {
      setOutreachError('Link cannot be empty.');
      return;
    }

    if (!/^https?:\/\//i.test(link)) {
      link = 'https://' + link;
    }

    let isValid = false;
    try {
      const parsed = new URL(link);
      isValid = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.');
    } catch (_) {
      isValid = false;
    }

    if (!isValid) {
      setOutreachError('Please enter a valid link or domain (e.g. google.com or https://example.com/outreach).');
      return;
    }

    setAddingOutreach(true);
    try {
      const targetRegions = activeProject?.target_regions || ['in', 'us', 'uk'];
      const newSite = await addOutreachSiteApi(pSlug, link, targetRegions, newOutreachType || 'Paid Guest');
      const mappedSite = {
        id: newSite.id,
        url: newSite.url,
        domain: newSite.domain,
        type: newSite.type || newOutreachType || 'Paid Guest',
        da: newSite.da,
        pa: newSite.pa,
        ss: newSite.ss,
        traffic: newSite.traffic,
        totalTraffic: newSite.total_traffic || newSite.totalTraffic,
        region1Traffic: newSite.region1_traffic || newSite.region1Traffic,
        region2Traffic: newSite.region2_traffic || newSite.region2Traffic,
        region3Traffic: newSite.region3_traffic || newSite.region3Traffic
      };

      setOutreachLinks(prev => [mappedSite, ...prev]);
      setNewOutreachLink('');
      setNewOutreachType('Paid Guest');
      setShowAddOutreach(false);
    } catch (err) {
      setOutreachError(err.message || 'Failed to add outreach site & fetch metrics.');
    } finally {
      setAddingOutreach(false);
    }
  };



  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    fetchDomainRows()
      .then(rows => { if (!cancelled) { setProjects(rows); setProjectsError(''); } })
      .catch(err => { if (!cancelled) setProjectsError(err.message || 'Failed to load projects.'); })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setKwClustersLoading(true);
    // Only lists projects that currently have >=1 keyword -- mirrors how
    // the Pages tab only lists projects with >=1 page (see pagesCounts
    // below). A project with none still exists (Domain tab) and can still
    // be targeted via "+ Add Keywords"; it just doesn't clutter this list
    // until it actually has keyword data.
    fetchKwProjects()
      .then(rows => { if (!cancelled) { setKwClusters(rows); setKwClustersError(''); } })
      .catch(err => { if (!cancelled) setKwClustersError(err.message || 'Failed to load projects.'); })
      .finally(() => { if (!cancelled) setKwClustersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCompetitorsLoading(true);
    fetchCompetitors()
      .then(rows => { if (!cancelled) { setCompetitors(rows); setCompetitorsError(''); } })
      .catch(err => { if (!cancelled) setCompetitorsError(err.message || 'Failed to load competitors.'); })
      .finally(() => { if (!cancelled) setCompetitorsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh: silently re-fetches the competitors list every 30s while
  // the Competitors tab is open, so results from a "Find Competitors" run
  // started elsewhere (or by a teammate) show up without a manual reload.
  // Self-contained (doesn't reuse the button's guarded handler) so it isn't
  // affected by stale closures over competitorsRefreshing. Skips a cycle
  // (rather than discarding anything) while there are unsaved edits --
  // same rule PageDetailView's auto-refresh follows.
  useEffect(() => {
    if (activeTab !== 'Competitors') return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (hasCompetitorPendingChanges) return;
      fetchCompetitors().then(rows => { if (!cancelled) setCompetitors(rows); }).catch(() => { });
    }, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTab, hasCompetitorPendingChanges]);

  useEffect(() => {
    let cancelled = false;
    fetchPagesCounts()
      .then(({ counts, stats }) => { if (!cancelled) { setPagesCounts(counts); setPagesStats(stats); } })
      .catch(() => { });
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh the KW Cluster project LIST every 10s (only while it's
  // actually on screen -- i.e. that tab is active and no project is open,
  // since a detail view has its own separate auto-refresh for its rows).
  useEffect(() => {
    if (activeTab !== 'Intent' || selectedKwProject !== null) return;
    const interval = setInterval(() => {
      fetchKwProjects().then(rows => setKwClusters(rows)).catch(() => { });
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab, selectedKwProject]);

  // Auto-refresh the Pages project LIST every 10s -- re-pulls all three
  // sources it's derived from (projects/kwClusters/pagesCounts); the sync
  // effect below rebuilds `pages` from whatever comes back.
  useEffect(() => {
    if (activeTab !== 'Pages' || selectedPageProject !== null) return;
    const interval = setInterval(() => {
      Promise.all([fetchDomainRows(), fetchKwProjects(), fetchPagesCounts()])
        .then(([domainRows, kwRows, { counts, stats }]) => {
          setProjects(domainRows);
          setKwClusters(kwRows);
          setPagesCounts(counts);
          setPagesStats(stats);
        })
        .catch(() => { });
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab, selectedPageProject]);

  // The Pages tab has no dedicated backend table of its own -- its rows are
  // derived straight from the real, DB-backed project list (`projects`,
  // fetched for the Domain tab) plus this project's own page stats
  // (Commercial vs Others / Blog Pages, from GET /pages/counts's `stats`,
  // computed off the pages table's target_type/target_category columns --
  // NOT KW Cluster's keyword counts, which cover keywords rather than the
  // pages actually added here) and KW Cluster's counts (just for the
  // Keywords column), matched by slug. Only projects with >=1 real page
  // row (per pagesCounts) are included -- so a project whose pages get
  // fully deleted drops off this list instead of lingering with a
  // permanent "0" row, and it comes back on its own once pages are added
  // to it again. Any `detailPages` already loaded locally are preserved
  // across re-syncs.
  useEffect(() => {
    setPages(prev => {
      const bySlug = new Map(prev.map(p => [p.slug, p]));
      return projects
        .filter(proj => {
          if (!proj.domain || String(proj.domain).trim() === '') return false;
          const s1 = String(proj.slug || '').trim().toLowerCase();
          const s2 = s1.replace(/[^a-z0-9]/g, '');
          const n1 = String(proj.name || '').trim().toLowerCase();
          const n2 = n1.replace(/[^a-z0-9]/g, '');
          const count = pagesCounts[proj.slug] ?? pagesCounts[proj.name] ?? pagesCounts[s1] ?? pagesCounts[s2] ?? pagesCounts[n1] ?? pagesCounts[n2] ?? 0;
          return count > 0;
        })
        .map(proj => {
          const s1 = String(proj.slug || '').trim().toLowerCase();
          const s2 = s1.replace(/[^a-z0-9]/g, '');
          const n1 = String(proj.name || '').trim().toLowerCase();
          const n2 = n1.replace(/[^a-z0-9]/g, '');
          const count = pagesCounts[proj.slug] ?? pagesCounts[proj.name] ?? pagesCounts[s1] ?? pagesCounts[s2] ?? pagesCounts[n1] ?? pagesCounts[n2] ?? 0;
          const stats = pagesStats[proj.slug] ?? pagesStats[proj.name] ?? pagesStats[s1] ?? pagesStats[s2] ?? pagesStats[n1] ?? pagesStats[n2] ?? { total: count, commercial: 0, blog: 0 };
          const kwProject = kwClusters.find(k => {
            const ks = String(k.slug || k.name || '').trim().toLowerCase();
            const ks2 = ks.replace(/[^a-z0-9]/g, '');
            return ks === s1 || ks2 === s2 || ks === n1 || ks2 === n2;
          });
          const existing = bySlug.get(proj.slug);
          return {
            ...existing,
            slug: proj.slug,
            name: proj.name,
            domain: proj.domain,
            locationIcon: proj.locationIcon,
            location: proj.location,
            totalPages: count,
            commercialPct: `${stats.commercial}/${stats.total}`,
            blogPages: stats.blog,
            blogDir: null,
            keywords: kwProject?.totalPages ?? 0,
            keywordsDir: null,
            updated: proj.updated,
          };
        });
    });
  }, [projects, kwClusters, pagesCounts, pagesStats]);

  useEffect(() => {
    if (selectedKwProject === null) return;
    const slug = kwClusters[selectedKwProject]?.slug;
    if (!slug) return;
    let cancelled = false;
    fetchKeywordRows(slug)
      .then(rows => { if (!cancelled) setKwClusters(prev => prev.map((p, i) => i === selectedKwProject ? { ...p, detailKeywords: rows, detailKeywordsError: '' } : p)); })
      .catch(err => { if (!cancelled) setKwClusters(prev => prev.map((p, i) => i === selectedKwProject ? { ...p, detailKeywordsError: err.message || 'Failed to load keywords.' } : p)); });
    return () => { cancelled = true; };
  }, [selectedKwProject]);

  useEffect(() => {
    if (selectedPageProject === null) return;
    const slug = pages[selectedPageProject]?.slug;
    if (!slug) return;
    let cancelled = false;
    fetchPageRows(slug)
      .then(rows => { if (!cancelled) setPages(prev => prev.map((p, i) => i === selectedPageProject ? { ...p, detailPages: rows, totalPages: rows.length, detailPagesError: '' } : p)); })
      .catch(err => { if (!cancelled) setPages(prev => prev.map((p, i) => i === selectedPageProject ? { ...p, detailPagesError: err.message || 'Failed to load pages.' } : p)); });
    return () => { cancelled = true; };
  }, [selectedPageProject]);

  const handleCreateProject = async (data) => {
    const created = await createProject(data);
    setProjects(prev => [created, ...prev]);
  };

  const handleUpdateProject = async (project, updates) => {
    const updated = await updateDomainRow(project.id, updates);
    setProjects(prev => prev.map(p => p === project ? updated : p));
  };

  const currentUserEmail = user?.email || 'system';

  const handleDeleteProject = async (project) => {
    await deleteKwProject(project.slug, currentUserEmail);
    setProjects(prev => prev.filter(p => p !== project));
  };

  const handleDeleteKwProject = async (project) => {
    await deleteKwClusterData(project.slug, currentUserEmail);
    setKwClusters(prev => prev.filter(p => p.slug !== project.slug));
  };

  const handleDeletePagesProject = async (project) => {
    await deletePagesData(project.slug, currentUserEmail);
    setPagesCounts(prev => { const next = { ...prev }; delete next[project.slug]; return next; });
    setPagesStats(prev => { const next = { ...prev }; delete next[project.slug]; return next; });
    setPages(prev => prev.filter(p => p.slug !== project.slug));
  };

  const handleDeleteCompetitorProject = async (project) => {
    const slug = project.slug;
    await deleteCompetitorProjectData(slug);
    setCompetitors(prev => prev.filter(c => c.projectSlug !== slug));
  };

  const handleAddCompetitor = async (data) => {
    const created = await insertCompetitor(data);
    setCompetitors(prev => [created, ...prev]);
  };

  useEffect(() => {
    if (!selectedCompetitorProject?.slug) {
      setTop3KwByCategory({});
      return;
    }
    let cancelled = false;
    setTop3KwLoading(true);
    fetchKeywordRows(selectedCompetitorProject.slug).then(rows => {
      if (cancelled) return;
      const grouped = {};
      rows.filter(r => r.kw).forEach(r => {
        const cat = r.category || r.targetSubtype || r.cluster || 'General';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(r);
      });
      const top3Map = {};
      Object.keys(grouped).forEach(cat => {
        const sorted = grouped[cat].sort((a, b) => (Number(b.sv) || 0) - (Number(a.sv) || 0));
        top3Map[cat] = sorted.slice(0, 3);
      });
      setTop3KwByCategory(prev => Object.keys(prev).length > 0 ? prev : top3Map);
    }).catch(() => {
      if (!cancelled) setTop3KwByCategory({});
    }).finally(() => {
      if (!cancelled) setTop3KwLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedCompetitorProject?.slug]);

  const handleChooseProjectApply = async ({ project, cluster, clusters, categories }) => {
    if (!checkProjectPrerequisites(project, 'Competitors')) return;
    // Navigate to the selected project's competitor list
    setSelectedCompetitorProject(project);
    setSelectedCategoriesFilter(categories && categories.length > 0 ? categories : null);

    const clusterList = clusters && clusters.length > 0 ? clusters : (cluster ? [cluster] : []);
    const clusterText = clusterList.length > 0 ? `Clusters (${clusterList.length}): ${clusterList.join(', ')}` : '';
    const catText = categories && categories.length > 0 ? `Categories (${categories.length}): ${categories.join(', ')}` : '';
    const filterMsg = [clusterText, catText].filter(Boolean).join(' → ');

    setFindCompetitorsMessage(filterMsg ? `Filtered: ${filterMsg}` : '');
    setTop3KwLoading(true);
    setFindingCompetitors(true);
    try {
      const rows = await fetchKeywordRows(project.slug);
      let filtered = rows.filter(r => r.kw);

      if (clusterList.length > 0) {
        filtered = filtered.filter(r => clusterList.includes(r.cluster || 'General'));
      }
      if (categories && categories.length > 0) {
        filtered = filtered.filter(r => categories.includes(r.category));
      }

      // Group keywords by category
      const grouped = {};
      filtered.forEach(r => {
        const cat = r.category || r.targetSubtype || r.cluster || 'General';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(r);
      });

      // Sort keywords in each category by SV descending and pick top 3
      const top3Map = {};
      Object.keys(grouped).forEach(cat => {
        const sorted = grouped[cat].sort((a, b) => (Number(b.sv) || 0) - (Number(a.sv) || 0));
        top3Map[cat] = sorted.slice(0, 3);
      });

      setTop3KwByCategory(top3Map);

      // Auto-generate competitors from DB rank data for chosen categories/clusters
      try {
        const res = await findCompetitors(project.slug, {
          useAi: true,
          categories: categories && categories.length > 0 ? categories : undefined,
          clusters: clusterList && clusterList.length > 0 ? clusterList : undefined,
        });
        if (res?.competitors) {
          setCompetitors(res.competitors);
        } else {
          const latestComps = await fetchCompetitors(project.slug);
          setCompetitors(latestComps);
        }
      } catch (findErr) {
        console.warn('Auto-generation from SERP data error:', findErr);
        const latestComps = await fetchCompetitors(project.slug);
        setCompetitors(latestComps);
      }
    } catch (err) {
      console.error('Failed to calculate top 3 keywords by category:', err);
      setTop3KwByCategory({});
    } finally {
      setTop3KwLoading(false);
      setFindingCompetitors(false);
    }
  };

  // Edits/deletes below only STAGE locally (into competitorPendingUpdates/
  // competitorPendingDeleteIds) -- nothing hits the backend until the
  // Competitors tab's "Save Changes" button calls
  // handleSaveCompetitorChanges(), same staged-edit pattern PageDetailView/
  // KwClusterDetailView already use.
  const stageCompetitorUpdates = (ids, updates) => {
    setCompetitorPendingUpdates(prev => {
      const next = new Map(prev);
      ids.forEach(id => next.set(id, { ...(next.get(id) || {}), ...updates }));
      return next;
    });
  };

  const handleSaveCompetitor = (competitor, updates) => {
    stageCompetitorUpdates([competitor.id], updates);
    setCompetitors(prev => prev.map(c => c.id === competitor.id ? { ...c, ...updates } : c));
  };

  const handleDeleteCompetitor = (idx) => {
    const competitor = competitors[idx];
    setCompetitorPendingDeleteIds(prev => new Set(prev).add(competitor.id));
    setCompetitorPendingUpdates(prev => { if (!prev.has(competitor.id)) return prev; const next = new Map(prev); next.delete(competitor.id); return next; });
    setCompetitors(prev => prev.filter((_, i) => i !== idx));
  };

  const handleBulkEditCompetitors = (ids, field, value) => {
    stageCompetitorUpdates(ids, { [field]: value });
    setCompetitors(prev => prev.map(c => ids.includes(c.id) ? { ...c, [field]: value } : c));
  };

  const handleBulkDeleteCompetitors = (ids) => {
    setCompetitorPendingDeleteIds(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    setCompetitorPendingUpdates(prev => { const next = new Map(prev); ids.forEach(id => next.delete(id)); return next; });
    setCompetitors(prev => prev.filter(c => !ids.includes(c.id)));
  };

  const handleSaveCompetitorChanges = async () => {
    setCompetitorSaving(true);
    setCompetitorSaveError('');
    try {
      if (competitorPendingDeleteIds.size > 0) {
        await Promise.all(Array.from(competitorPendingDeleteIds).map(id => deleteCompetitor(id)));
      }
      await Promise.all(Array.from(competitorPendingUpdates.entries()).map(([id, updates]) => updateCompetitor(id, updates)));
      setCompetitorPendingUpdates(new Map());
      setCompetitorPendingDeleteIds(new Set());
    } catch (err) {
      setCompetitorSaveError(err.message || 'Failed to save changes.');
    } finally {
      setCompetitorSaving(false);
    }
  };

  // "Find Competitors" upserts on the backend (same domain+project rediscovered
  // again just updates its existing row), so merge by id here too rather than
  // always prepending -- otherwise a repeat run would duplicate every row.
  const handleFoundCompetitors = (foundRows) => {
    setCompetitors(prev => {
      const byId = new Map(prev.map(c => [c.id, c]));
      foundRows.forEach(c => byId.set(c.id, c));
      const foundIds = new Set(foundRows.map(c => c.id));
      const unchanged = prev.filter(c => !foundIds.has(c.id));
      const updated = foundRows.map(c => byId.get(c.id));
      return [...updated, ...unchanged];
    });
  };

  // One-click trigger, no form -- confirms via a popup only if this project
  // already has competitors (to avoid silently re-running something that
  // just ran), otherwise runs immediately.
  const runFindCompetitors = async (project) => {
    setFindingCompetitors(true);
    setFindCompetitorsMessage('');
    createAuditLogApi({
      user_email: getActiveUserEmail(),
      action: `AI Competitor Discovery Triggered for Project: ${project.name || project.slug}`,
      status: 'Success',
      project_name: project.slug,
      module: 'competitors'
    }).catch(() => { });
    try {
      const { competitors: found, message } = await findCompetitors(project.slug, { useAi: true });
      handleFoundCompetitors(found);
      setFindCompetitorsMessage(found.length === 0 ? (message || '0 competitors found.') : `Found ${found.length} competitor${found.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setFindCompetitorsMessage(err.message || 'Failed to find competitors.');
      createAuditLogApi({
        user_email: getActiveUserEmail(),
        action: `AI Competitor Discovery Failed for Project: ${project.name || project.slug}`,
        status: 'Warning',
        project_name: project.slug,
        module: 'competitors'
      }).catch(() => { });
    } finally {
      setFindingCompetitors(false);
    }
  };

  const handleFindCompetitorsClick = (project) => {
    const hasExisting = competitors.some(c => c.projectSlug === project.slug);
    if (hasExisting) {
      setPendingFindProject(project);
      setShowRefindConfirm(true);
      return;
    }
    runFindCompetitors(project);
  };

  const handleRefreshCompetitors = () => {
    if (competitorsRefreshing) return;
    if (hasCompetitorPendingChanges && !window.confirm('You have unsaved changes. Discard them and refresh?')) return;
    setCompetitorsRefreshing(true);
    setCompetitorsError('');
    fetchCompetitors()
      .then(rows => { setCompetitors(rows); setCompetitorPendingUpdates(new Map()); setCompetitorPendingDeleteIds(new Set()); })
      .catch(err => setCompetitorsError(err.message || 'Failed to refresh competitors.'))
      .finally(() => setCompetitorsRefreshing(false));
  };

  const handleImportPages = async (data) => {
    if (activeTab === 'Competitors') {
      const insertedRows = await insertCompetitorPageRows(data.slug, data.pages);
      return insertedRows;
    }

    const insertedRows = await insertPageRows(data.slug, data.pages);

    setPagesCounts(prev => ({ ...prev, [data.slug]: (prev[data.slug] || 0) + insertedRows.length }));
    setPagesStats(prev => {
      const s = prev[data.slug] || { total: 0, commercial: 0, blog: 0 };
      return { ...prev, [data.slug]: { ...s, total: s.total + insertedRows.length } };
    });

    setPages(prev => {
      const targetIdx = typeof data.targetIndex === 'number' ? data.targetIndex : prev.findIndex(p => p.slug === data.slug);

      if (targetIdx !== -1) {
        return prev.map((p, i) => {
          if (i !== targetIdx) return p;
          const detailPages = [...(p.detailPages || []), ...insertedRows];
          return { ...p, detailPages, totalPages: detailPages.length, updated: 'Just now' };
        });
      }

      const matchedProject = projects.find(p => p.slug === data.slug);
      return [...prev, {
        slug: data.slug,
        name: data.name,
        domain: data.domain,
        locationIcon: matchedProject?.locationIcon || 'desktop',
        location: matchedProject?.location || 'Global',
        totalPages: insertedRows.length,
        commercialPct: '0/0',
        blogPages: 0,
        blogDir: null,
        keywords: 0,
        keywordsDir: null,
        updated: 'Just now',
        detailPages: insertedRows,
      }];
    });
  };

  const handleImportKeywords = async (data) => {
    const insertedRows = await insertKeywordRows(data.slug, data.keywords);

    setKwClusters(prev => {
      const targetIdx = typeof data.targetIndex === 'number' ? data.targetIndex : prev.findIndex(p => p.slug === data.slug);

      if (targetIdx !== -1) {
        return prev.map((p, i) => {
          if (i !== targetIdx) return p;
          const detailKeywords = [...(p.detailKeywords || []), ...insertedRows];
          const commercialKeywords = detailKeywords.filter(r => r.targetSubtype === 'Commercial').length;
          return {
            ...p,
            detailKeywords,
            totalPages: detailKeywords.length,
            keywords: detailKeywords.length,
            commercialPct: `${commercialKeywords}/${detailKeywords.length}`,
            updated: 'Just now',
          };
        });
      }

      const matchedProject = projects.find(p => p.slug === data.slug);
      return [...prev, {
        slug: data.slug,
        name: data.name,
        domain: data.domain,
        locationIcon: matchedProject?.locationIcon || 'desktop',
        location: matchedProject?.location || 'Global',
        totalPages: insertedRows.length,
        commercialPct: `0/${insertedRows.length}`,
        blogPages: 0,
        blogDir: 'up',
        keywords: insertedRows.length,
        keywordsDir: null,
        updated: 'Just now',
        detailKeywords: insertedRows,
      }];
    });
  };

  const handleDownloadMainTab = () => {
    if (activeTab === 'Domain') {
      const rows = projects.map(p => ({
        Project: p.name,
        Domain: p.domain,
        Location: p.location,
        Platforms: (p.targetPlatforms || ALL_PLATFORMS).join('; '),
        Traffic: p.traffic,
        Keywords: p.keywords,
        TargetPages: p.targetPages,
        BlogPages: p.blogPages,
        Updated: p.updated,
      }));
      downloadCSV('domain_projects', rows);
    } else if (activeTab === 'Intent') {
      const rows = kwClusters.map(p => ({
        Project: p.name,
        Domain: p.domain,
        Location: p.location,
        TotalKW: p.totalPages,
        LandingPages: p.keywords,
        Updated: p.updated,
      }));
      downloadCSV('kw_clusters_summary', rows);
    } else if (activeTab === 'Pages') {
      const rows = pages.map(p => ({
        Project: p.name,
        Domain: p.domain,
        Location: p.location,
        TotalPages: p.totalPages,
        CommercialVsOthers: p.commercialPct,
        BlogPages: p.blogPages,
        Keywords: p.keywords,
        Updated: p.updated,
      }));
      downloadCSV('pages_summary', rows);
    } else if (activeTab === 'Competitors') {
      const rows = competitors.map(c => ({
        Competitor: c.name || c.domain,
        Domain: c.domain,
        Device: c.device || 'Desktop',
        Location: c.location,
        DA: c.da ?? '',
        CommonKWs: Math.round(((c.commonKw ?? 0) / 100) * c.totalKw),
        TotalKWs: c.totalKw,
        SERPCompLevel: c.serpCompLevel,
        CompLevel: c.compLevel,
      }));
      downloadCSV('competitors_summary', rows);
    }
  };

  const isInDetailView = (activeTab === 'Intent' && selectedKwProject !== null) ||
    (activeTab === 'Pages' && selectedPageProject !== null) ||
    (activeTab === 'Competitors' && selectedCompetitor !== null) ||
    (activeTab === 'Competitors' && selectedKwDetail !== null) ||
    (activeTab === 'Competitors' && selectedCompetitorProject !== null);

  const filterTabs = ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'];

  const ctaByTab = {
    Domain: { label: 'Create project', onClick: () => setShowCreate(true) },
    'Intent': { label: 'Add Keywords', onClick: () => setShowAddKeywords(true) },
    Pages: { label: 'Add Pages', onClick: () => setShowAddPages(true) },
    Competitors: { label: 'Choose Project', onClick: () => setShowChooseProject(true) },
    Outreach: { label: 'Add Sites', onClick: () => setShowAddOutreach(true) },
    Connectors: { label: 'Connect', onClick: () => { } },
  };

  const cta = ctaByTab[activeTab];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Page title */}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12 }}>
        Project Setup
      </h1>

      {/* Horizontal tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 12 }}>
        {TABS.map((t, index) => (
          <Fragment key={t}>
            <button
              onClick={() => handleTabClick(t)}
              style={{
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: activeTab === t ? 600 : 500,
                color: activeTab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === t ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -2,
                cursor: 'pointer',
                fontFamily: 'var(--font-body)',
                transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { if (activeTab !== t) e.currentTarget.style.color = 'var(--text-secondary)'; }}
              onMouseLeave={e => { if (activeTab !== t) e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              {t}
            </button>
            {index < TABS.length - 1 && (
              <span style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 2px', userSelect: 'none' }}>
                ›
              </span>
            )}
          </Fragment>
        ))}
      </div>

      {/* Main card */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow)' }}>

        {/* Toolbar */}
        <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', flex: '0 0 260px' }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={
                activeTab === 'Pages' && selectedPageProject !== null ? 'Search page or url...'
                  : activeTab === 'Intent' && selectedKwProject !== null ? 'Search keywords...'
                    : activeTab === 'Competitors' && selectedCompetitorProject !== null ? 'Search competitor or domain...'
                      : 'Search project name or domain...'
              }
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text-primary)', width: '100%' }}
            />
          </div>

          {/* Filter button & pills — Domain tab only */}
          {activeTab === 'Domain' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative' }} ref={domainFilterRef}>
                <button
                  onClick={() => setShowDomainFilterDropdown(!showDomainFilterDropdown)}
                  title="Filter"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
                    background: activeDomainFilterCount > 0 ? '#f5f3ff' : 'none',
                    border: activeDomainFilterCount > 0 ? '1.5px solid #7c3aed' : '1.5px solid var(--border)',
                    borderRadius: 8, padding: 8,
                    cursor: 'pointer', color: activeDomainFilterCount > 0 ? '#7c3aed' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = activeDomainFilterCount > 0 ? '#7c3aed' : 'var(--border-hover)'; e.currentTarget.style.color = activeDomainFilterCount > 0 ? '#7c3aed' : 'var(--text-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = activeDomainFilterCount > 0 ? '#7c3aed' : 'var(--border)'; e.currentTarget.style.color = activeDomainFilterCount > 0 ? '#7c3aed' : 'var(--text-muted)'; }}
                >
                  <Filter size={14} />
                  {activeDomainFilterCount > 0 && (
                    <span style={{
                      position: 'absolute', top: -6, right: -6,
                      background: '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 700,
                      width: 16, height: 16, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{activeDomainFilterCount}</span>
                  )}
                </button>

                {showDomainFilterDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 1000,
                    background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    padding: 16, width: 280, display: 'flex', flexDirection: 'column', gap: 12
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Domain Filters</span>
                      <button onClick={() => setShowDomainFilterDropdown(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                        <X size={14} />
                      </button>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Platform</label>
                      <select
                        value={domainFilters.platform}
                        onChange={e => setDomainFilters(prev => ({ ...prev, platform: e.target.value }))}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, outline: 'none' }}
                      >
                        <option value="">All Platforms</option>
                        {ALL_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Location</label>
                      <select
                        value={domainFilters.location}
                        onChange={e => setDomainFilters(prev => ({ ...prev, location: e.target.value }))}
                        style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, outline: 'none' }}
                      >
                        <option value="">All Locations</option>
                        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Domain Authority (DA)</label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min DA"
                          value={domainFilters.daMin}
                          onChange={e => setDomainFilters(prev => ({ ...prev, daMin: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                        <input
                          type="number"
                          placeholder="Max DA"
                          value={domainFilters.daMax}
                          onChange={e => setDomainFilters(prev => ({ ...prev, daMax: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Traffic Range</label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min Traffic"
                          value={domainFilters.trafficMin}
                          onChange={e => setDomainFilters(prev => ({ ...prev, trafficMin: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                        <input
                          type="number"
                          placeholder="Max Traffic"
                          value={domainFilters.trafficMax}
                          onChange={e => setDomainFilters(prev => ({ ...prev, trafficMax: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Keywords Range</label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min KW"
                          value={domainFilters.keywordsMin}
                          onChange={e => setDomainFilters(prev => ({ ...prev, keywordsMin: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                        <input
                          type="number"
                          placeholder="Max KW"
                          value={domainFilters.keywordsMax}
                          onChange={e => setDomainFilters(prev => ({ ...prev, keywordsMax: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Target Pages Range</label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min Pages"
                          value={domainFilters.targetPagesMin}
                          onChange={e => setDomainFilters(prev => ({ ...prev, targetPagesMin: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                        <input
                          type="number"
                          placeholder="Max Pages"
                          value={domainFilters.targetPagesMax}
                          onChange={e => setDomainFilters(prev => ({ ...prev, targetPagesMax: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Blog Pages Range</label>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="Min Blogs"
                          value={domainFilters.blogPagesMin}
                          onChange={e => setDomainFilters(prev => ({ ...prev, blogPagesMin: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</span>
                        <input
                          type="number"
                          placeholder="Max Blogs"
                          value={domainFilters.blogPagesMax}
                          onChange={e => setDomainFilters(prev => ({ ...prev, blogPagesMax: e.target.value }))}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      <button
                        onClick={() => setDomainFilters({
                          platform: '', location: '', daMin: '', daMax: '', trafficMin: '', trafficMax: '',
                          keywordsMin: '', keywordsMax: '', targetPagesMin: '', targetPagesMax: '', blogPagesMin: '', blogPagesMax: '',
                        })}
                        style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        Reset Filters
                      </button>
                    </div>
                  </div>
                )}
              </div>


            </div>
          )}

          {!isInDetailView && activeTab === 'Outreach' && (
            <TableFilterDropdown
              filters={outreachFilterConfigs}
              rows={outreachLinks}
              activeFilters={outreachTableFilters}
              onFiltersChange={setOutreachTableFilters}
            />
          )}

          {!isInDetailView && userCanDownload && (
            <button
              onClick={handleDownloadMainTab}
              title="Download CSV"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--surface-2)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: 8,
                padding: '7px 10px', cursor: 'pointer',
                fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              <Download size={14} />
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          {userCanEdit && (
            activeTab === 'Competitors' ? (
              selectedCompetitorProject === null ? (
                <button
                  onClick={() => { setChooseProjectMode('chooseProject'); setShowChooseProject(true); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: '#0f1523', color: '#fff', border: 'none', borderRadius: 8,
                    padding: '8px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <Plus size={15} />
                  Choose project
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={handleRefreshCompetitors}
                    disabled={competitorsRefreshing}
                    title="Refresh"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'none', border: '1.5px solid var(--border)', borderRadius: 8, padding: 9,
                      cursor: competitorsRefreshing ? 'default' : 'pointer', color: 'var(--text-muted)',
                    }}
                    onMouseEnter={e => { if (!competitorsRefreshing) { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <RefreshCw size={14} className={competitorsRefreshing ? 'spin-icon' : ''} />
                  </button>
                </div>
              )
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {activeTab === 'Outreach' && selectedOutreachIds.size > 0 && (
                  <ActionsDropdown
                    selectedCount={selectedOutreachIds.size}
                    onBulkEdit={() => setShowBulkEditOutreach(true)}
                    onBulkDelete={() => setShowBulkDeleteOutreachConfirm(true)}
                  />
                )}
                {activeTab === 'Outreach' && userCanEdit && (hasOutreachPendingChanges || outreachSaving) && (
                  <button
                    onClick={handleSaveOutreachChanges}
                    disabled={!hasOutreachPendingChanges || outreachSaving}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: '#0f1523', color: '#fff', border: 'none', borderRadius: 8,
                      padding: '8px 18px', fontSize: 13.5, fontWeight: 600,
                      cursor: outreachSaving ? 'default' : 'pointer',
                      fontFamily: 'var(--font-body)', opacity: outreachSaving ? 0.7 : 1,
                    }}
                  >
                    {outreachSaving ? 'Saving…' : 'Save changes'}
                  </button>
                )}
                <button
                  onClick={cta.onClick}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: '#0f1523', color: '#fff', border: 'none', borderRadius: 8,
                    padding: '8px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <Plus size={15} />
                  {cta.label}
                </button>
              </div>
            )
          )}
        </div>

        {activeTab === 'Competitors' && findCompetitorsMessage && (
          <div style={{ padding: '10px 20px 0', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {findCompetitorsMessage}
          </div>
        )}

        {/* Table */}
        {activeTab === 'Intent' && selectedKwProject !== null ? (
          <KwClusterDetailView
            project={kwClusters[selectedKwProject]}
            search={search}
            user={user}
            onBack={() => { setSelectedKwProject(null); setSearch(''); }}
            onUpdateKeywords={(updated) => setKwClusters(prev => prev.map((p, i) => i === selectedKwProject ? { ...p, detailKeywords: updated } : p))}
          />
        ) : activeTab === 'Pages' && selectedPageProject !== null ? (
          <PageDetailView
            project={pages[selectedPageProject]}
            user={user}
            onBack={() => setSelectedPageProject(null)}
            onUpdatePages={(updated) => {
              const slug = pages[selectedPageProject]?.slug;
              if (slug) {
                setPagesCounts(prev => ({ ...prev, [slug]: updated.length }));
                setPagesStats(prev => ({
                  ...prev,
                  [slug]: {
                    total: updated.length,
                    commercial: updated.filter(r => r.targetType === 'Commercial').length,
                    blog: updated.filter(r => r.targetCategory === 'Blogs').length,
                  },
                }));
              }
              setPages(prev => prev.map((p, i) => i === selectedPageProject ? { ...p, detailPages: updated, totalPages: updated.length } : p));
              // Once a project's last page is deleted, its row drops out of
              // `pages` (see the sync effect above) -- bail back to the list
              // so `pages[selectedPageProject]` doesn't end up pointing at
              // the wrong row (or nothing) once that happens.
              if (updated.length === 0) setSelectedPageProject(null);
            }}
          />
        ) : activeTab === 'Competitors' && selectedCompetitor !== null ? (
          <CompetitorDetailView
            competitor={competitors[selectedCompetitor]}
            onBack={() => setSelectedCompetitor(null)}
          />
        ) : activeTab === 'Competitors' && selectedKwDetail !== null ? (
          <KeywordDetailView
            keyword={selectedKwDetail.kw}
            kwObj={selectedKwDetail.kwObj}
            competitors={competitors}
            scopedProject={selectedCompetitorProject}
            onBack={() => setSelectedKwDetail(null)}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {activeTab === 'Domain' && <DomainTab projects={projects} filter={filter} domainFilters={domainFilters} search={search} onUpdateProject={handleUpdateProject} onDeleteProject={handleDeleteProject} loading={projectsLoading} error={projectsError} user={user} />}
            {activeTab === 'Intent' && <PagesTab pages={kwClusters} search={search} onSelectProject={(i) => { setSelectedKwProject(i); setSearch(''); }} onDeleteProject={handleDeleteKwProject} loading={kwClustersLoading} error={kwClustersError} totalLabel="Total KW" keywordsLabel="Landing Pages" deleteScopeLabel="this project's Intent data (keywords, categories, clusters)" user={user} />}
            {activeTab === 'Pages' && <PagesTab pages={pages} search={search} onSelectProject={(i) => { const proj = pages[i]; if (!checkProjectPrerequisites(proj, 'Pages')) return; setSelectedPageProject(i); }} onDeleteProject={handleDeletePagesProject} deleteScopeLabel="this project's pages" user={user} />}
            {activeTab === 'Competitors' && selectedCompetitorProject === null && (
              <CompetitorProjectsTab
                projects={projects}
                competitors={competitors}
                search={search}
                onSelectProject={(p) => { if (!checkProjectPrerequisites(p, 'Competitors')) return; setSelectedCompetitorProject(p); setFindCompetitorsMessage(''); }}
                onDeleteProject={handleDeleteCompetitorProject}
                loading={competitorsLoading}
                error={competitorsError}
                user={user}
              />
            )}
            {activeTab === 'Competitors' && selectedCompetitorProject !== null && (
              <CompetitorsTab
                competitors={competitors}
                scopedProject={selectedCompetitorProject}
                selectedCategoriesFilter={selectedCategoriesFilter}
                search={search}
                onBack={() => {
                  if (hasCompetitorPendingChanges && !window.confirm('You have unsaved changes. Discard them?')) return;
                  setSelectedCompetitorProject(null);
                  setSelectedCategoriesFilter(null);
                  setFindCompetitorsMessage('');
                  setCompetitorPendingUpdates(new Map());
                  setCompetitorPendingDeleteIds(new Set());
                }}
                onSelectCompetitor={setSelectedCompetitor}
                onSelectKwDetail={setSelectedKwDetail}
                onDeleteCompetitor={handleDeleteCompetitor}
                onSaveCompetitor={handleSaveCompetitor}
                onBulkEditCompetitors={handleBulkEditCompetitors}
                onBulkDeleteCompetitors={handleBulkDeleteCompetitors}
                onFindCompetitors={() => runFindCompetitors(selectedCompetitorProject)}
                onAddPages={() => setShowAddPages(true)}
                hasPendingChanges={hasCompetitorPendingChanges}
                saving={competitorSaving}
                saveError={competitorSaveError}
                onSaveChanges={handleSaveCompetitorChanges}
                loading={competitorsLoading}
                error={competitorsError}
                top3KwByCategory={top3KwByCategory}
                top3KwLoading={top3KwLoading}
                findingCompetitors={findingCompetitors}
                user={user}
              />
            )}
            {activeTab === 'Outreach' && (
              outreachLoading ? (
                <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <RefreshCw size={16} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                  Loading outreach sites...
                </div>
              ) : (() => {
                if (outreachLinks.length === 0) {
                  return (
                    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                      No outreach sites configured yet. Click <strong>+ {cta.label}</strong> to get started.
                    </div>
                  );
                }
                let filteredOutreach = outreachLinks;
                if (search && search.trim()) {
                  const q = search.trim().toLowerCase();
                  filteredOutreach = filteredOutreach.filter(l => (
                    (l.url || '').toLowerCase().includes(q) ||
                    (l.domain || '').toLowerCase().includes(q) ||
                    (l.type || '').toLowerCase().includes(q)
                  ));
                }
                if (outreachTableFilters.type && outreachTableFilters.type.length > 0) {
                  filteredOutreach = filteredOutreach.filter(l => outreachTableFilters.type.includes(l.type || 'Paid Guest'));
                }
                const applyRangeFilter = (rows, key, fVal) => {
                  if (!fVal || (fVal.min === '' && fVal.max === '')) return rows;
                  const min = fVal.min !== '' ? Number(fVal.min) : -Infinity;
                  const max = fVal.max !== '' ? Number(fVal.max) : Infinity;
                  return rows.filter(r => {
                    const val = Number(r[key] || 0);
                    return val >= min && val <= max;
                  });
                };
                filteredOutreach = applyRangeFilter(filteredOutreach, 'da', outreachTableFilters.da);
                filteredOutreach = applyRangeFilter(filteredOutreach, 'pa', outreachTableFilters.pa);
                filteredOutreach = applyRangeFilter(filteredOutreach, 'ss', outreachTableFilters.ss);
                filteredOutreach = applyRangeFilter(filteredOutreach, 'totalTraffic', outreachTableFilters.traffic);

                const isAllSelected = filteredOutreach.length > 0 && filteredOutreach.every(lnk => selectedOutreachIds.has(lnk.id));

                return (
                  <div style={{ padding: '12px 0' }}>
                    {outreachSaveError && (
                      <div style={{
                        background: '#fef2f2',
                        border: '1px solid #f87171',
                        color: '#dc2626',
                        borderRadius: 6,
                        padding: '10px 14px',
                        fontSize: 13,
                        fontWeight: 500,
                        marginBottom: 12
                      }}>
                        {outreachSaveError}
                      </div>
                    )}

                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 950 }}>
                        <thead>
                          <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '10px 14px', textAlign: 'center', width: 40 }}>
                              <div
                                onClick={() => handleToggleSelectAllOutreach(filteredOutreach)}
                                style={{
                                  width: 20, height: 20, borderRadius: 6,
                                  border: isAllSelected ? '2px solid #5c4af2' : '2px solid #cbd5e1',
                                  background: isAllSelected ? '#5c4af2' : '#fff',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  cursor: 'pointer', transition: 'all 0.15s', margin: '0 auto'
                                }}
                              >
                                {isAllSelected && <Check size={13} color="#fff" strokeWidth={3} />}
                              </div>
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 280 }}>
                              Site
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 170 }}>
                              Type
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              DA
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              PA
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              SS
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              Traffic
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              Region 1
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              Region 2
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                              Region 3
                            </th>
                            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', width: 100 }}>
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOutreach.map((lnk) => {
                            const isSelected = selectedOutreachIds.has(lnk.id);
                            const currentType = lnk.type || lnk.site_type || lnk.website_type || 'Paid Guest';
                            return (
                              <tr key={lnk.id} style={{ borderBottom: '1px solid var(--border)', background: isSelected ? '#f0f9ff' : 'transparent' }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#fafbfc'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                                <td style={{ padding: '14px 14px', textAlign: 'center', width: 40 }}>
                                  <div
                                    onClick={() => handleToggleSelectOutreach(lnk.id)}
                                    style={{
                                      width: 20, height: 20, borderRadius: 6,
                                      border: isSelected ? '2px solid #5c4af2' : '2px solid #cbd5e1',
                                      background: isSelected ? '#5c4af2' : '#fff',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      cursor: 'pointer', transition: 'all 0.15s', margin: '0 auto'
                                    }}
                                  >
                                    {isSelected && <Check size={13} color="#fff" strokeWidth={3} />}
                                  </div>
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, width: 280, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <a href={lnk.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}
                                    onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                                    onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                                    {(() => {
                                      try {
                                        const parsed = new URL(lnk.url);
                                        const baseUrl = `${parsed.protocol}//${parsed.hostname}`;
                                        if (lnk.url.length > baseUrl.length + 3) {
                                          return `${baseUrl}...`;
                                        }
                                        return lnk.url;
                                      } catch (_) {
                                        return lnk.url;
                                      }
                                    })()}
                                  </a>
                                </td>
                                <td style={{ padding: '10px 16px', fontSize: 13.5, textAlign: 'left' }}>
                                  <select
                                    value={OUTREACH_TYPES.includes(currentType) ? currentType : 'Paid Guest'}
                                    onChange={(e) => handleOutreachTypeChange(lnk.id, e.target.value)}
                                    style={{
                                      padding: '5px 10px',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      borderRadius: 6,
                                      border: '1px solid #cbd5e1',
                                      background: '#e0f2fe',
                                      color: '#0369a1',
                                      outline: 'none',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    {!OUTREACH_TYPES.includes(currentType) && (
                                      <option value={currentType}>{currentType}</option>
                                    )}
                                    {OUTREACH_TYPES.map(opt => (
                                      <option key={opt} value={opt} style={{ background: '#ffffff', color: '#0f172a' }}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.da || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.pa || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.ss || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.totalTraffic || lnk.traffic || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.region1Traffic || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.region2Traffic || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', fontSize: 13.5, textAlign: 'left', color: 'var(--text-primary)' }}>
                                  {lnk.region3Traffic || '-'}
                                </td>
                                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                  {userCanDelete && (
                                    <button
                                      onClick={() => setDeletingOutreachLink(lnk)}
                                      title="Delete domain"
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'var(--red, #dc2626)',
                                        cursor: 'pointer',
                                        padding: '6px 8px',
                                        borderRadius: 6,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justify: 'center',
                                        transition: 'background 0.15s'
                                      }}
                                      onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                    >
                                      <Trash2 size={15} color="var(--red, #dc2626)" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()
            )}
            {activeTab === 'Connectors' && (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No connectors configured yet. Click <strong>+ Connect</strong> to get started.
              </div>
            )}
          </div>
        )}

        {/* Pagination — the Intent detail view and the Competitors tab's
            own views (project list / competitors list / ranking keywords)
            each render their own real paginated footer */}
        {!(activeTab === 'Intent' && selectedKwProject !== null) && activeTab !== 'Competitors' && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              Page:
              <input defaultValue="1" style={{ width: 36, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', textAlign: 'center', fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }} />
              of 1
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            </div>
          </div>
        )}

      </div>

      {/* Help button */}
      <div style={{ position: 'fixed', bottom: 28, right: 28 }}>
        <button style={{ width: 44, height: 44, borderRadius: '50%', background: '#0f1523', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.25)' }}>
          <HelpCircle size={20} color="#fff" />
        </button>
      </div>

      {/* Modals */}
      <CreateProjectModal open={showCreate} onClose={() => setShowCreate(false)} onCreateProject={handleCreateProject} />
      <AddPagesModal
        open={showAddPages}
        onClose={() => setShowAddPages(false)}
        projects={projects}
        onImportPages={handleImportPages}
        onCheckPrerequisites={checkProjectPrerequisites}
        lockedProject={
          activeTab === 'Competitors' && selectedCompetitorProject !== null
            ? { slug: selectedCompetitorProject.slug, name: selectedCompetitorProject.name, domain: selectedCompetitorProject.domain }
            : activeTab === 'Pages' && selectedPageProject !== null
              ? { index: selectedPageProject, slug: pages[selectedPageProject].slug, name: pages[selectedPageProject].name, domain: pages[selectedPageProject].domain }
              : null
        }
      />
      <AddKeywordsModal
        open={showAddKeywords}
        onClose={() => setShowAddKeywords(false)}
        projects={projects}
        onImportKeywords={handleImportKeywords}
        lockedProject={
          activeTab === 'Competitors' && selectedCompetitorProject !== null
            ? { slug: selectedCompetitorProject.slug, name: selectedCompetitorProject.name, domain: selectedCompetitorProject.domain }
            : activeTab === 'Intent' && selectedKwProject !== null
              ? { index: selectedKwProject, slug: kwClusters[selectedKwProject].slug, name: kwClusters[selectedKwProject].name, domain: kwClusters[selectedKwProject].domain }
              : null
        }
      />
      <ChooseProjectModal open={showChooseProject} onClose={() => setShowChooseProject(false)} onApply={handleChooseProjectApply} projects={projects} mode={chooseProjectMode} onCheckPrerequisites={checkProjectPrerequisites} />
      <AddCompetitorModal
        open={showAddCompetitor}
        onClose={() => setShowAddCompetitor(false)}
        projects={projects}
        onAddCompetitor={handleAddCompetitor}
        lockedProject={selectedCompetitorProject}
      />
      <RefindCompetitorsConfirmModal
        open={showRefindConfirm}
        onClose={() => setShowRefindConfirm(false)}
        projectName={pendingFindProject?.name}
        onConfirm={() => { if (pendingFindProject) runFindCompetitors(pendingFindProject); }}
      />
      <PrerequisiteModal
        open={prerequisiteModal.open}
        onClose={() => setPrerequisiteModal(prev => ({ ...prev, open: false }))}
        title={prerequisiteModal.title}
        message={prerequisiteModal.message}
        actionLabel={`Set ${prerequisiteModal.targetTab}`}
        onAction={() => {
          setActiveTab(prerequisiteModal.targetTab);
          setSelectedPageProject(null);
          setSelectedCompetitor(null);
          setSelectedCompetitorProject(null);
          setSelectedKwProject(null);
          setSelectedKwDetail(null);
          setSearch('');
          if (prerequisiteModal.targetTab === 'Domain') setShowCreate(true);
          if (prerequisiteModal.targetTab === 'Intent') setShowAddKeywords(true);
          if (prerequisiteModal.targetTab === 'Pages') setShowAddPages(true);
        }}
      />
      <Modal
        open={showAddOutreach}
        onClose={() => {
          setShowAddOutreach(false);
          setOutreachError('');
          setNewOutreachLink('');
          setOutreachCsvRows([]);
          setOutreachFileName('');
        }}
        title="Add Outreach Sites"
        footer={<>
          <Btn variant="primary" onClick={handleAddOutreachLink} disabled={addingOutreach}>
            {addingOutreach ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                Fetching Metrics...
              </span>
            ) : outreachCsvRows.length > 0 ? (
              `Import ${outreachCsvRows.length} Site${outreachCsvRows.length !== 1 ? 's' : ''}`
            ) : (
              'Add Site'
            )}
          </Btn>
          <Btn variant="outline" onClick={() => {
            if (!addingOutreach) {
              setShowAddOutreach(false);
              setOutreachError('');
              setNewOutreachLink('');
              setOutreachCsvRows([]);
              setOutreachFileName('');
            }
          }} style={{ flex: 'none', padding: '10px 28px' }} disabled={addingOutreach}>Cancel</Btn>
        </>}
      >
        {outreachError && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            color: '#dc2626',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 16
          }}>
            {outreachError}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Outreach Site*
            </label>
            <input
              type="text"
              placeholder="e.g. https://example.com/outreach"
              value={newOutreachLink}
              onChange={(e) => { setNewOutreachLink(e.target.value); setOutreachError(''); }}
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 13.5,
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddOutreachLink();
              }}
            />
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Supports full URLs and plain domains (e.g. google.com)
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Type*
            </label>
            <select
              value={newOutreachType}
              onChange={(e) => setNewOutreachType(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                fontSize: 13.5,
                background: 'var(--surface)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="Paid Guest">Paid Guest</option>
              <option value="Classified Ads">Classified Ads</option>
              <option value="Brand Mention">Brand Mention</option>
              <option value="Business Listing">Business Listing</option>
            </select>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

          {/* Import Outreach Sites section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Import Outreach Sites</span>
              <button
                type="button"
                onClick={downloadOutreachSampleTemplate}
                style={{ border: 'none', background: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: 0 }}
              >
                Download sample template
              </button>
            </div>
            <input
              type="file"
              accept=".csv,.tsv,.xls,.xlsx"
              id="outreach-csv-upload"
              style={{ display: 'none' }}
              onChange={e => { handleOutreachFileUpload(e.target.files[0]); e.target.value = ''; }}
            />
            <div
              style={{
                border: `2px dashed ${outreachFileName ? 'var(--accent)' : '#d1d5db'}`,
                borderRadius: 10,
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                background: outreachFileName ? 'var(--accent-light)' : 'var(--surface-2)',
                cursor: 'pointer'
              }}
              onClick={() => document.getElementById('outreach-csv-upload').click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = outreachFileName ? 'var(--accent)' : '#d1d5db'; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; handleOutreachFileUpload(e.dataTransfer.files[0]); }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => { if (!outreachFileName) e.currentTarget.style.borderColor = '#d1d5db'; }}
            >
              {outreachFileName ? (
                <>
                  <Check size={20} color="var(--accent)" />
                  <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{outreachFileName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{outreachCsvRows.length} site{outreachCsvRows.length !== 1 ? 's' : ''} ready to import</span>
                </>
              ) : (
                <>
                  <Upload size={20} color="var(--text-muted)" />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>Click to upload or drag a file</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CSV, TSV, Excel · Columns: URL, Type</span>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
      {deletingOutreachLink && (
        <Modal open={true} onClose={() => setDeletingOutreachLink(null)} title="Delete Outreach Domain"
          footer={<>
            <button onClick={() => setDeletingOutreachLink(null)} style={{ padding: '8px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => { handleDeleteOutreachLink(deletingOutreachLink.id); setDeletingOutreachLink(null); }} style={{ padding: '8px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete Domain
            </button>
          </>}>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
            Are you sure you want to delete the outreach site <strong>{deletingOutreachLink.url}</strong>? This action cannot be undone.
          </p>
        </Modal>
      )}
      {showBulkEditOutreach && (
        <Modal
          open={true}
          onClose={() => setShowBulkEditOutreach(false)}
          title={`Bulk Edit Outreach Sites (${selectedOutreachIds.size} Selected)`}
          footer={<>
            <Btn variant="primary" onClick={handleBulkEditOutreachSave}>Apply Changes</Btn>
            <Btn variant="outline" onClick={() => setShowBulkEditOutreach(false)}>Cancel</Btn>
          </>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Type</label>
              <select
                value={bulkEditOutreachData.type}
                onChange={(e) => setBulkEditOutreachData(prev => ({ ...prev, type: e.target.value }))}
                style={{ width: '100%', padding: '10px 14px', fontSize: 13.5, background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none' }}
              >
                {OUTREACH_TYPES.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                
              </div>
              
            </div>
          </div>
        </Modal>
      )}
      {showBulkDeleteOutreachConfirm && (
        <Modal
          open={true}
          onClose={() => setShowBulkDeleteOutreachConfirm(false)}
          title={`Bulk Delete Outreach Sites (${selectedOutreachIds.size} Selected)`}
          footer={<>
            <button onClick={() => setShowBulkDeleteOutreachConfirm(false)} style={{ padding: '8px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleBulkDeleteOutreachConfirm} style={{ padding: '8px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Delete {selectedOutreachIds.size} Site{selectedOutreachIds.size !== 1 ? 's' : ''}
            </button>
          </>}
        >
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
            Are you sure you want to delete <strong>{selectedOutreachIds.size}</strong> selected outreach site{selectedOutreachIds.size !== 1 ? 's' : ''}? This action cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

function AddCompetitorModal({ open, onClose, projects, onAddCompetitor, lockedProject }) {
  const [selectedSlug, setSelectedSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [da, setDa] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      setDomain('');
      setName('');
      setDa('');
      if (lockedProject) {
        setSelectedSlug(lockedProject.slug);
      } else if (projects && projects.length > 0) {
        setSelectedSlug(projects[0].slug);
      }
    }
  }, [open, lockedProject, projects]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!domain.trim()) {
      setError('Competitor domain is required.');
      return;
    }
    if (!selectedSlug) {
      setError('Please select a target project.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onAddCompetitor({
        domain: domain.trim(),
        name: name.trim() || null,
        da: da ? Number(da) : null,
        projectSlug: selectedSlug,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to add competitor.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460, padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Add Competitor to DB
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Target Project</label>
            <select
              value={selectedSlug}
              onChange={e => setSelectedSlug(e.target.value)}
              disabled={!!lockedProject}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
            >
              {projects.map(p => (
                <option key={p.slug} value={p.slug}>{p.name} ({p.domain || p.slug})</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Competitor Domain *</label>
            <input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="e.g. sais.edu.sg or competitor.com"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Competitor Name (Optional)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Stamford American International School"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Domain Authority - DA (Optional)</label>
            <input
              type="number"
              value={da}
              onChange={e => setDa(e.target.value)}
              placeholder="e.g. 58"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-body)', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={submitting} style={{ padding: '8px 18px', background: '#0f1523', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {submitting ? 'Saving to DB…' : 'Save Competitor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
