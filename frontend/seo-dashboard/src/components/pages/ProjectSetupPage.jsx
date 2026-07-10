import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Plus, X, ChevronDown, ChevronLeft, ChevronRight, Edit2, HelpCircle, Upload, Check, Monitor, Globe, ArrowLeft, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Badge } from '../ui/Card';
import { derivedPages, projectSetupData, brandMentionKeywords } from '../../data/mockData';
import {
  fetchDomainRows, createProject, updateDomainRow, deleteDomainRow,
  fetchKwProjects, fetchKeywordRows, insertKeywordRows, updateKeywordRow, bulkDeleteKeywordRows,
} from '../../lib/projectsApi';

// ─── shared tiny components ────────────────────────────────────────────────

function Input({ label, hint, placeholder, required, value, onChange, type = 'text' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
          {hint && <HelpCircle size={13} color="var(--text-muted)" />}
        </div>
      )}
      {hint === 'domain' && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -2 }}>Enter a domain or subdomain. </span>
      )}
      <input
        type={type}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', border: '1.5px solid #5c4af2', borderRadius: 8,
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

function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px 16px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6, display: 'flex' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '0 28px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '16px 28px 24px', display: 'flex', gap: 12 }}>
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
  const [userType, setUserType] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [users, setUsers] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

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
    setPlatforms([]); setDa(''); setUserType(''); setUserEmail(''); setUsers([]);
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
    <Modal open={open} onClose={onClose} title="Create project"
      footer={<><Btn variant="primary" onClick={handleCreate} style={submitting ? { opacity: 0.6, pointerEvents: 'none' } : {}}>{submitting ? 'Creating…' : 'Create SEO project'}</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      {apiError && (
        <span style={{ fontSize: 12, color: 'var(--red, #dc2626)' }}>{apiError}</span>
      )}
      <Input label="Domain" hint="domain" placeholder="domain.com" value={domain} onChange={setDomain} />
      <Input label="Project Name" placeholder="Auto-generated if left blank" value={name} onChange={setName} />
      <div style={{ height: 1, background: 'var(--border)' }} />

      <CountryTagInput
        label="Target Regions"
        tags={regions}
        onAdd={r => setRegions(p => [...p, r])}
        onRemove={r => setRegions(p => p.filter(x => x !== r))}
        placeholder="e.g. India, Singapore, USA"
      />

      <MultiSelect
        label="Platforms"
        options={platformOptions}
        selected={platforms}
        onToggle={togglePlatform}
      />

      <Input label="Domain Authority" placeholder="e.g. 42" value={da} onChange={setDa} type="number" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Add Users</span>

        {users.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {users.map((u, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-light)', borderRadius: 99, padding: '2px 8px' }}>
                  {userTypeLabels[u.type] || u.type}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{u.email}</span>
                <button onClick={() => removeUser(idx)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, lineHeight: 1, fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
      </div>

    </Modal>
  );
}

// ─── Add Pages Modal ─────────────────────────────────────────────────────────

function AddPagesModal({ open, onClose, projects, onImportPages, lockedProject }) {
  const [clustered, setClustered] = useState(false);
  const [project, setProject] = useState('');
  const [share, setShare] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [fileName, setFileName] = useState('');

  const projectOptions = projects
    .filter(p => p.name)
    .map(p => ({ value: p.domain, label: p.name }));

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
    setClustered(false); setProject('');
    setShare(false); setCsvRows([]); setFileName('');
  };

  const handleImport = () => {
    if (lockedProject) {
      if (csvRows.length === 0) return;
      onImportPages({
        domain: lockedProject.domain,
        name: lockedProject.name,
        targetIndex: lockedProject.index,
        clustered,
        pages: csvRows,
        share,
      });
      resetForm();
      onClose();
      return;
    }
    if (!project && csvRows.length === 0) return;
    const matchedProject = projects.find(p => p.domain === project);
    onImportPages({
      domain: project,
      name: matchedProject?.name || project,
      project,
      clustered,
      pages: csvRows,
      share,
    });
    resetForm();
    onClose();
  };

  const canImport = lockedProject ? csvRows.length > 0 : true;

  return (
    <Modal open={open} onClose={onClose} title="Add Pages"
      footer={<><Btn variant="primary" onClick={handleImport} style={canImport ? {} : { opacity: 0.5, pointerEvents: 'none' }}>Import Pages</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
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
          onChange={setProject}
          options={projectOptions}
        />
      )}


      <Checkbox label="Is this project's keywords already clustered?" checked={clustered} onChange={setClustered} />
      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Import Pages section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Import Pages</span>
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

const CATEGORY_API_BASE = 'https://seo-backend-fqlp.onrender.com';

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
    const headers = ['KW', 'SV', 'KW Diff', 'Type', 'Cluster', 'Category', 'Target Type', 'Target Subtype', 'Target Geo', 'Priority', 'Landing Page'];
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

function AddCompetitorsModal({ open, onClose }) {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [da, setDa] = useState('');
  const [regions, setRegions] = useState([]);

  return (
    <Modal open={open} onClose={onClose} title="Add Competitors"
      footer={<><Btn variant="primary">Add Competitor</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <Input label="Domain" hint="domain" placeholder="domain.com" value={domain} onChange={setDomain} />
      <Input label="Name" placeholder="Auto-generated if left blank" value={name} onChange={setName} />
      <Input label="DA" placeholder="e.g. 45" value={da} onChange={setDa} />

      <div style={{ height: 1, background: 'var(--border)' }} />

      <CountryTagInput
        label="Regions to Track"
        tags={regions}
        onAdd={r => setRegions(p => [...p, r])}
        onRemove={r => setRegions(p => p.filter(x => x !== r))}
        placeholder="e.g. India, Singapore"
      />
    </Modal>
  );
}

// ─── Table rows data ─────────────────────────────────────────────────────────

const blogPageCount = derivedPages.filter(p => p.targetCategory === 'Topical Blog').length;

const ALL_PLATFORMS = ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'];

const PLATFORM_BADGE_STYLES = {
  'AI Mode':     { bg: '#ede9fe', color: '#7c3aed' },
  'AI Overview': { bg: '#dbeafe', color: '#1d4ed8' },
  'Google':      { bg: '#fef9c3', color: '#854d0e' },
  'ChatGPT':     { bg: '#dcfce7', color: '#166534' },
  'Gemini':      { bg: '#fce7f3', color: '#9d174d' },
};

const DeviceIcon = ({ type }) => {
  if (type === 'desktop') return <Monitor size={14} color="#5a6478" />;
  if (type === 'ai') return <span style={{ fontSize: 13 }}>✦</span>;
  if (type === 'google') return <span style={{ fontSize: 13, color: '#4285F4', fontWeight: 700 }}>G</span>;
  return <Globe size={14} color="#5a6478" />;
};

// ─── Tab configurations ───────────────────────────────────────────────────────

const TABS = ['Domain', 'KW Cluster', 'Pages', 'Competitors', 'Outreach', 'Connectors'];

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
  const [keywords, setKeywords] = useState('');
  const [targetPages, setTargetPages] = useState('');
  const [blogPages, setBlogPages] = useState('');
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
      setKeywords(project.keywords ?? '');
      setTargetPages(project.targetPages ?? '');
      setBlogPages(project.blogPages ?? '');
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
        keywords: keywords !== '' ? Number(keywords) : 0,
        targetPages: targetPages !== '' ? Number(targetPages) : 0,
        blogPages: blogPages !== '' ? Number(blogPages) : 0,
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
      <Input label="Keywords" placeholder="e.g. 120" value={keywords} onChange={setKeywords} type="number" />
      <Input label="Target Pages" placeholder="e.g. 10" value={targetPages} onChange={setTargetPages} type="number" />
      <Input label="Blog Pages" placeholder="e.g. 25" value={blogPages} onChange={setBlogPages} type="number" />
    </Modal>
  );
}

function DomainTab({ projects, filter, onUpdateProject, onDeleteProject, loading, error }) {
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [editingProject, setEditingProject] = useState(null);

  const toggleRow = (i) => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const visibleProjects = filter
    ? projects.filter(p => (p.targetPlatforms || ALL_PLATFORMS).includes(filter))
    : projects;

  return (
    <>
    <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
      <thead>
        <tr style={{ background: '#f8f9fb', borderBottom: '1px solid var(--border)' }}>
          {['Project', 'Location', 'Target Platforms', 'DA', 'Traffic', 'Keywords', 'Target Pages', 'Blog Pages', 'Updated', ''].map((h, i) => (
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
          <tr><td colSpan={10} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading projects…</td></tr>
        ) : error ? (
          <tr><td colSpan={10} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
        ) : visibleProjects.length === 0 ? (
          <tr><td colSpan={10} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No projects yet. Click <strong>+ Create project</strong> to get started.</td></tr>
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
              <span style={{ fontSize: 13.5, fontWeight: 600, color: p.keywordsDir === 'up' ? 'var(--green)' : 'var(--red)' }}>
                {p.keywordsDir === 'up' ? '↑' : '↓'}{p.keywords}
              </span>
            </td>
            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: p.targetDir === 'down' ? 'var(--red)' : p.targetDir === 'up' ? 'var(--green)' : 'var(--text-muted)' }}>
                {p.targetDir === 'down' ? '↓' : p.targetDir === 'up' ? '↑' : ''}{p.targetPages}
              </span>
            </td>
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{p.blogPages}</td>
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.updated}</td>
            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
              <button
                onClick={() => setEditingProject(p)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <Edit2 size={14} />
              </button>
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
const commercialPages = derivedPages.filter(p => p.targetType.toLowerCase().includes('commercial')).length;

const INITIAL_PAGES = [
  {
    name: 'OWIS Singapore',
    domain: 'owis.org',
    locationIcon: 'desktop',
    location: 'Singapore',
    totalPages: derivedPages.length,
    commercialPct: `${commercialPages}/${derivedPages.length}`,
    blogPages: blogPageCount,
    blogDir: 'up',
    keywords: projectSetupData.totalKeywords,
    keywordsDir: 'up',
    updated: '20h ago',
    detailPages: derivedPages.map(p => ({
      pageName: p.pageName,
      url: p.url,
      cluster: p.cluster,
      category: p.category,
      targetCategory: p.targetCategory,
      targetType: p.targetType,
    })),
  },
  {
    name: 'owis.org (AI)',
    domain: 'owis.org',
    locationIcon: 'ai',
    location: 'Singapore',
    totalPages: brandMentionKeywords.length,
    commercialPct: '—',
    blogPages: projectSetupData.aiMentionCount,
    blogDir: 'up',
    keywords: brandMentionKeywords.length,
    keywordsDir: 'up',
    updated: '19h ago',
    detailPages: brandMentionKeywords.map(kw => ({
      pageName: kw,
      url: '/' + kw.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      cluster: 'Brand Mention',
      category: 'AI Visibility',
      targetCategory: '',
      targetType: 'commercial',
    })),
  },
];

function PagesTab({ pages, onSelectProject, loading, error }) {

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'Project', align: 'left' },
                { label: 'Location', align: 'left' },
                { label: 'Total  Pages', align: 'right' },
                { label: 'Commercial vs Others', align: 'right' },
                { label: 'Blog Pages', align: 'right' },
                { label: 'Keywords', align: 'right' },
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
              <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</td></tr>
            ) : error ? (
              <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
            ) : pages.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No projects yet.</td></tr>
            ) : pages.map((p, i) => (
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
                <td style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 13 }}>{p.totalPages ?? ''}</td>
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
                    {p.keywordsDir === 'down' ? `↓${p.keywords}` : p.keywords}
                  </span>
                </td>
                <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.updated}</td>
                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <Edit2 size={14} />
                  </button>
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
  { value: 'targetCategory', label: 'Target Category', type: 'select', options: ['Landing Page', 'Topical Blog'] },
  { value: 'targetType', label: 'Target Type', type: 'select', options: ['Commercial', 'Informational', 'Informational/Commercial', 'Transactional', 'Navigational'] },
];

const KW_BULK_FIELDS = [
  { value: 'cluster', label: 'Cluster', type: 'text' },
  { value: 'category', label: 'Category', type: 'text' },
  { value: 'type', label: 'Type', type: 'select', options: ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'] },
  { value: 'targetType', label: 'Target Type', type: 'select', options: ['Blogs', 'Landing Page', 'Topical Blogs'] },
  { value: 'targetSubtype', label: 'Target Subtype', type: 'select', options: ['Informational', 'Commercial'] },
  { value: 'targetGeo', label: 'Target Geo', type: 'text' },
  { value: 'priority', label: 'Priority', type: 'select', options: ['P1', 'P2', 'P3', 'P4', 'P5'] },
  { value: 'landingPage', label: 'Landing Page (URL)', type: 'text' },
];

function BulkEditModal({ open, onClose, count, onApply, fields }) {
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
      footer={<><Btn variant="primary" onClick={handleApply}>Apply to {count} page{count !== 1 ? 's' : ''}</Btn><Btn variant="outline" onClick={() => { onClose(); setField(''); setValue(''); }} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
        Editing <strong>{count}</strong> selected page{count !== 1 ? 's' : ''}
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

function BulkDeleteModal({ open, onClose, count, onConfirm }) {
  return (
    <Modal open={open} onClose={onClose} title="Confirm Delete"
      footer={<><Btn variant="primary" onClick={() => { onConfirm(); onClose(); }} style={{ background: 'var(--red)' }}>Delete {count} page{count !== 1 ? 's' : ''}</Btn><Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn></>}
    >
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Are you sure you want to delete <strong>{count}</strong> selected page{count !== 1 ? 's' : ''}? This action cannot be undone.
      </div>
    </Modal>
  );
}

function ActionsDropdown({ selectedCount, onBulkEdit, onBulkDelete }) {
  const [open, setOpen] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(p => !p)}
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
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50,
            background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 160, overflow: 'hidden',
          }}>
            <button
              onClick={() => { setOpen(false); onBulkEdit(); }}
              style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text-primary)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Edit2 size={14} color="var(--text-muted)" /> Bulk Edit
            </button>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <button
              onClick={() => { setOpen(false); onBulkDelete(); }}
              style={{ width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--red)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Trash2 size={14} /> Bulk Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function HeaderQuickSelect({ placeholder, options, onSet }) {
  return (
    <select value="" onChange={e => { if (e.target.value) onSet(e.target.value); }}
      style={{ appearance: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 28px 5px 10px', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', color: 'var(--text-muted)', background: `#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center`, cursor: 'pointer', outline: 'none', minWidth: 130, letterSpacing: '0.3px' }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function PageDetailView({ project, onBack, onUpdatePages }) {
  const [rows, setRows] = useState(project.detailPages || []);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [editingPage, setEditingPage] = useState(null);

  useEffect(() => {
    setRows(project.detailPages || []);
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

  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const updated = prev.map((r, i) => i === idx ? { ...r, [field]: value } : r);
      onUpdatePages(updated);
      return updated;
    });
  };

  const deleteRow = (idx) => {
    setRows(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      onUpdatePages(updated);
      return updated;
    });
  };

  const bulkUpdate = (field, value) => {
    setRows(prev => {
      const updated = prev.map(r => ({ ...r, [field]: value }));
      onUpdatePages(updated);
      return updated;
    });
  };

  const handleBulkEditApply = (field, value) => {
    setRows(prev => {
      const updated = prev.map((r, i) => selectedRows.has(i) ? { ...r, [field]: value } : r);
      onUpdatePages(updated);
      return updated;
    });
    setSelectedRows(new Set());
  };

  const handleBulkDelete = () => {
    setRows(prev => {
      const updated = prev.filter((_, i) => !selectedRows.has(i));
      onUpdatePages(updated);
      return updated;
    });
    setSelectedRows(new Set());
  };

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
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{project.name}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{project.domain}</span>
        </div>
        <div style={{ flex: 1 }} />
        <ActionsDropdown
          selectedCount={selectedRows.size}
          onBulkEdit={() => setShowBulkEdit(true)}
          onBulkDelete={() => setShowBulkDelete(true)}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} page{rows.length !== 1 ? 's' : ''}</span>
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
              <HeaderQuickSelect placeholder="Target Category" options={['Landing Page', 'Topical Blog']} onSet={v => bulkUpdate('targetCategory', v)} />
            </th>
            <th style={{ padding: '6px 16px', textAlign: 'left' }}>
              <HeaderQuickSelect placeholder="Target Type" options={['Commercial', 'Informational', 'Informational/Commercial', 'Transactional', 'Navigational']} onSet={v => bulkUpdate('targetType', v)} />
            </th>
            <th style={{ padding: '10px 16px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No pages added yet. Use Add Pages to import.</td></tr>
          ) : rows.map((r, i) => (
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
                <button onClick={() => deleteRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
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
    </div>
  );
}

const KW_PAGE_SIZE = 100;

function KwClusterDetailView({ project, onBack, onUpdateKeywords, search }) {
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
  const hasPendingChanges = pendingUpdates.size > 0 || pendingDeleteIds.size > 0;

  const [showExcludeDropdown, setShowExcludeDropdown] = useState(false);
  const [excludePos, setExcludePos] = useState({ top: 0, right: 0 });
  const excludeBtnRef = useRef(null);

  useEffect(() => {
    if (!showExcludeDropdown) return;
    const updatePos = () => {
      if (!excludeBtnRef.current) return;
      const rect = excludeBtnRef.current.getBoundingClientRect();
      setExcludePos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
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

  const [tempKwInput, setTempKwInput] = useState('');
  const [tempGeoInput, setTempGeoInput] = useState('');

  const [showRankColumn, setShowRankColumn] = useState(false);
  const [rankChecking, setRankChecking] = useState(false);
  const [rankCheckError, setRankCheckError] = useState('');

  const [clustering, setClustering] = useState(false);
  const [clusterError, setClusterError] = useState('');

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
          return;
        }
        if (job?.status === 'failed' || job?.error) {
          await refreshCategorizationFromDb();
          setClustering(false);
          setClusterError(job?.error || 'Categorization job failed.');
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

  const handleRunClustering = async () => {
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

    setClustering(true);
    try {
      // Categorizes keywords ALREADY sitting in this project -- never
      // re-uploads/re-inserts rows (that's what /jobs/category is for,
      // and calling it again here was duplicating every keyword).
      const res = await fetch(`${CATEGORY_API_BASE}/projects/${project.slug}/categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country }),
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
    }
  };

  // Merges just the `rank` field from the DB into local rows, keyed by row id
  // -- deliberately leaves everything else in `rows` (including any unsaved
  // pendingUpdates edits) untouched.
  const refreshRanksFromDb = async () => {
    const freshRows = await fetchKeywordRows(project.slug);
    const rankById = new Map(freshRows.map(r => [String(r.id), r.rank]));
    setRows(prev => prev.map(r => rankById.has(String(r.id)) ? { ...r, rank: rankById.get(String(r.id)) } : r));
    return freshRows;
  };

  // Rank-checking runs on the backend's separate 'rank_checks' queue, which
  // is safe to (and does) run with multiple concurrent workers -- see
  // rank_checker.py's module docstring. This just triggers that job and
  // polls until every keyword in it has been checked.
  const pollRankCheckJob = (jobId) => {
    const POLL_INTERVAL_MS = 8000;
    const MAX_ATTEMPTS = 90; // ~12 minutes

    const tick = async (attempt) => {
      try {
        const res = await fetch(`${CATEGORY_API_BASE}/jobs/${jobId}/results`);
        const data = await res.json();
        const results = data.results || [];
        await refreshRanksFromDb();

        const allChecked = results.length > 0 && results.every(r => r.rank_checked_at);
        if (allChecked || attempt >= MAX_ATTEMPTS) {
          setRankChecking(false);
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
    try {
      if (!project.slug) {
        throw new Error("This project is missing its backend project reference -- reload the page and try again.");
      }

      const jobsRes = await fetch(`${CATEGORY_API_BASE}/jobs`);
      if (!jobsRes.ok) throw new Error('Failed to look up this project\'s keyword import jobs.');
      const jobsData = await jobsRes.json();
      const latestJob = (jobsData.jobs || [])
        .filter(j => j.domain === project.slug && j.status === 'completed' && j.clustering_triggered_at)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      if (!latestJob) {
        throw new Error('No completed keyword import found for this project yet -- import keywords first.');
      }

      const res = await fetch(`${CATEGORY_API_BASE}/jobs/${latestJob.id}/check-rank`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || 'Failed to start rank check.');
      }

      pollRankCheckJob(latestJob.id);
    } catch (err) {
      setRankChecking(false);
      setRankCheckError(err.message || 'Failed to check ranking.');
    }
  };

  const filteredIndices = rows
    .map((_, i) => i)
    .filter(i => !search || rows[i].kw?.toLowerCase().includes(search.toLowerCase()));

  const pageCount = Math.max(1, Math.ceil(filteredIndices.length / KW_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedIndices = filteredIndices.slice((safePage - 1) * KW_PAGE_SIZE, safePage * KW_PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, project]);

  useEffect(() => {
    setRows(project.detailKeywords || []);
    setPendingUpdates(new Map());
    setPendingDeleteIds(new Set());
    setSaveError('');
  }, [project]);

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
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{project.domain}</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {filteredIndices.length} keyword{filteredIndices.length !== 1 ? 's' : ''}
            {search ? ` of ${rows.length}` : ''}
          </span>
        </div>
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

        {selectedRows.size === 0 && (
        <>
        {/* Check initial ranking button */}
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
            <div style={{
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
                  <input type="checkbox" checked={excludeConfig.kwChecked} onChange={e => setExcludeConfig({...excludeConfig, kwChecked: e.target.checked})} />
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
                  <input type="checkbox" checked={excludeConfig.svChecked} onChange={e => setExcludeConfig({...excludeConfig, svChecked: e.target.checked})} />
                  Search Volume (SV)
                </label>
                {excludeConfig.svChecked && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number"
                      placeholder="Min"
                      value={excludeConfig.svMin}
                      onChange={e => setExcludeConfig({...excludeConfig, svMin: e.target.value})}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={excludeConfig.svMax}
                      onChange={e => setExcludeConfig({...excludeConfig, svMax: e.target.value})}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                    />
                  </div>
                )}
              </div>

              {/* KW Diff Exclude */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={excludeConfig.kwDiffChecked} onChange={e => setExcludeConfig({...excludeConfig, kwDiffChecked: e.target.checked})} />
                  KW Difficulty
                </label>
                {excludeConfig.kwDiffChecked && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number"
                      placeholder="Min"
                      value={excludeConfig.kwDiffMin}
                      onChange={e => setExcludeConfig({...excludeConfig, kwDiffMin: e.target.value})}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={excludeConfig.kwDiffMax}
                      onChange={e => setExcludeConfig({...excludeConfig, kwDiffMax: e.target.value})}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                    />
                  </div>
                )}
              </div>

              {/* Rank Exclude */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={excludeConfig.rankChecked} onChange={e => setExcludeConfig({...excludeConfig, rankChecked: e.target.checked})} />
                  Ranking Range
                </label>
                {excludeConfig.rankChecked && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number"
                      placeholder="Min"
                      value={excludeConfig.rankMin}
                      onChange={e => setExcludeConfig({...excludeConfig, rankMin: e.target.value})}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={excludeConfig.rankMax}
                      onChange={e => setExcludeConfig({...excludeConfig, rankMax: e.target.value})}
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

        <ActionsDropdown
          selectedCount={selectedRows.size}
          onBulkEdit={() => setShowBulkEdit(true)}
          onBulkDelete={() => setShowBulkDelete(true)}
        />

        {/* Robot Face AI Cluster Button */}
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

        {(hasPendingChanges || saving) && (
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
              <HeaderQuickSelect placeholder="Type" options={['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini']} onSet={v => bulkUpdate('type', v)} />
            </th>
            <th style={{ padding: '6px 16px', textAlign: 'left' }}>
              <HeaderQuickSelect placeholder="Target Type" options={['Blogs', 'Landing Page', 'Topical Blogs']} onSet={v => bulkUpdate('targetType', v)} />
            </th>
            <th style={{ padding: '6px 16px', textAlign: 'left' }}>
              <HeaderQuickSelect placeholder="Target Subtype" options={['Informational', 'Commercial']} onSet={v => bulkUpdate('targetSubtype', v)} />
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
            <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading keywords…</td></tr>
          ) : error ? (
            <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--red, #dc2626)', fontSize: 13 }}>{error}</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No keywords added yet. Use Add Keywords to import.</td></tr>
          ) : pagedIndices.length === 0 ? (
            <tr><td colSpan={showRankColumn ? 14 : 13} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No keywords match "{search}".</td></tr>
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
              <td style={{ padding: '10px 16px', fontSize: 13, color: r.type ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.type || '—'}</td>
              <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetType ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetType || '—'}</td>
              <td style={{ padding: '10px 16px', fontSize: 13, color: r.targetSubtype ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.targetSubtype || '—'}</td>
              <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>{r.targetGeo || '—'}</td>
              <td style={{ padding: '10px 16px', fontSize: 13, color: r.priority ? 'var(--text-primary)' : 'var(--text-muted)' }}>{r.priority || '—'}</td>
              <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--accent)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.landingPage || '—'}</td>
              <td style={{ padding: '10px 16px' }}>
                <button onClick={() => deleteRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 6 }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = 'var(--red)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                  <Trash2 size={14} />
                </button>
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

const COMPETITOR_ROWS = [
  {
    name: 'OWIS Singapore', domain: 'owis.org', device: 'desktop', location: 'Singapore', da: null, commonKw: 44.29, commonKwChange: -0.47, totalKw: 139, totalKwChange: 139, aiCompLevel: 137, aiCompChange: -137, serpCompLevel: 757, compLevel: 82, dated: '20h ago',
    details: [
      { domain: 'owis.org', name: 'OWIS Main Site', regions: ['Singapore', 'India'], da: 42, rankingKeywords: 139, device: 'desktop', location: 'Singapore', commonKw: 38.12, totalKw: 139, aiCompLevel: 95, serpCompLevel: 520, compLevel: 78, dated: '20h ago' },
      { domain: 'owis.org/admissions', name: 'OWIS Admissions', regions: ['Singapore'], da: 42, rankingKeywords: 47, device: 'desktop', location: 'Singapore', commonKw: 4.80, totalKw: 47, aiCompLevel: 28, serpCompLevel: 152, compLevel: 45, dated: '20h ago' },
      { domain: 'owis.org/blog', name: 'OWIS Blog', regions: ['Singapore', 'Malaysia'], da: 42, rankingKeywords: 68, device: 'web', location: 'Singapore', commonKw: 1.37, totalKw: 68, aiCompLevel: 14, serpCompLevel: 85, compLevel: 31, dated: '20h ago' },
    ],
  },
  {
    name: 'owis.org', domain: 'owis.org', device: 'web', location: 'Singapore', da: null, commonKw: 24.44, commonKwChange: 2.40, totalKw: 90, totalKwChange: 1, aiCompLevel: 0, aiCompChange: 0, serpCompLevel: 4, compLevel: 12, dated: '19h ago',
    details: [
      { domain: 'owis.org', name: 'OWIS AI Presence', regions: ['Singapore'], da: 42, rankingKeywords: 1, device: 'web', location: 'Singapore', commonKw: 24.44, totalKw: 90, aiCompLevel: 0, serpCompLevel: 4, compLevel: 12, dated: '19h ago' },
    ],
  },
  {
    name: null, domain: null, device: 'google', location: 'Singapore', da: null, commonKw: 5.56, commonKwChange: 10.44, totalKw: 190, totalKwChange: 3, aiCompLevel: 0, aiCompChange: 0, serpCompLevel: 3, compLevel: 95, dated: '18h ago',
    details: [
      { domain: 'google.com', name: 'Google Search', regions: ['Singapore'], da: 98, rankingKeywords: 3, device: 'google', location: 'Singapore', commonKw: 5.56, totalKw: 90, aiCompLevel: 0, serpCompLevel: 3, compLevel: 95, dated: '18h ago' },
    ],
  },
];

const GoogleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
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

function CompetitorDetailView({ competitor, onBack }) {
  const details = competitor.details || [];
  const title = competitor.name || competitor.domain || 'Competitor';

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
          {competitor.domain && competitor.name && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{competitor.domain}</span>}
        </div>
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
                { label: 'AI Comp. Level', align: 'right' },
                { label: 'SERP Comp Level', align: 'right' },
                { label: 'Comp Level', align: 'right' },
                { label: 'dated', align: 'right' },
              ].map((h, i) => (
                <th key={i} style={{ padding: '10px 16px', textAlign: h.align, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {details.length === 0 ? (
              <tr><td colSpan={12} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No detail entries yet.</td></tr>
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
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: d.totalKw > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                  {d.totalKw > 0 ? '↑' : ''}{d.totalKw}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.min(d.aiCompLevel, 100)}%</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.min(d.serpCompLevel, 100)}%</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>{Math.min(d.compLevel, 100)}%</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{d.dated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditCompetitorModal({ open, onClose, competitor }) {
  const [name, setName] = useState('');
  const [regions, setRegions] = useState([]);
  const [da, setDa] = useState('');

  if (!open) return null;

  const initName = competitor?.name || competitor?.domain || '';
  const initDa = competitor?.da ?? '';

  return (
    <Modal open={open} onClose={onClose} title="Edit Competitor"
      footer={
        <>
          <Btn variant="primary" onClick={onClose}>Save</Btn>
          <Btn variant="outline" onClick={onClose} style={{ flex: 'none', padding: '10px 28px' }}>Cancel</Btn>
        </>
      }
    >
      <Input label="Name" placeholder="e.g. ISS International School" value={name || initName} onChange={setName} />
      <CountryTagInput
        label="Target Regions"
        tags={regions}
        onAdd={r => setRegions(prev => [...prev, r])}
        onRemove={r => setRegions(prev => prev.filter(x => x !== r))}
        placeholder="e.g. India, Singapore, USA"
      />
      <Input label="DA" placeholder="e.g. 45" value={da !== '' ? da : String(initDa)} onChange={setDa} />
    </Modal>
  );
}

function CompetitorsTab({ onSelectCompetitor }) {
  const [editingIdx, setEditingIdx] = useState(null);

  return (
    <>
    <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Competitors</th>
          <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Location</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>DA</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Common KW's</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Tot. KW's</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>AI Comp. Level</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>SERP Comp Level</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>Comp Level</th>
          <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>dated</th>
          <th style={{ padding: '10px 16px' }}></th>
        </tr>
      </thead>
      <tbody>
        {COMPETITOR_ROWS.map((c, i) => (
          <tr key={i} style={{ borderBottom: i < COMPETITOR_ROWS.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#fafbfc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            onClick={() => onSelectCompetitor(i)}>
            {/* Competitor name & domain */}
            <td style={{ padding: '14px 16px' }}>
              {c.name && (
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--accent)' }}
                  onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                  onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                  {c.name}
                </div>
              )}
              {c.domain && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{c.domain}</div>}
              {c.name && <div style={{ marginTop: 4, fontSize: 16, color: 'var(--border)' }}></div>}
            </td>
            {/* Location */}
            <td style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                <CompDeviceIcon type={c.device} />
                {c.location}
              </div>
            </td>
            {/* DA */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {c.da ?? ''}
            </td>
            {/* Common KW's % */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {Math.round((c.commonKw / 100) * c.totalKw)}<span style={{ fontSize: 18, fontWeight: 300, margin: '0 1px' }}>/</span>{c.totalKw}
            </td>
            {/* Tot. KW's */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: c.totalKwChange > 0 ? 'var(--green)' : c.totalKwChange < 0 ? 'var(--red)' : 'var(--text-muted)' }}>
              {c.totalKwChange > 0 ? '↑' : c.totalKwChange < 0 ? '↓' : ''}{Math.abs(c.totalKwChange)}
            </td>
            {/* AI Comp. Level */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {Math.min(c.aiCompLevel, 100)}%
            </td>
            {/* SERP Comp Level */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {Math.min(c.serpCompLevel, 100)}%
            </td>
            {/* Comp Level */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-primary)' }}>
              {Math.min(c.compLevel, 100)}%
            </td>
            {/* Dated */}
            <td style={{ padding: '14px 16px', textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {c.dated}
            </td>
            {/* Edit */}
            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
              <button onClick={e => { e.stopPropagation(); setEditingIdx(i); }} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                <Edit2 size={13} color="var(--text-muted)" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
    <EditCompetitorModal
      open={editingIdx !== null}
      onClose={() => setEditingIdx(null)}
      competitor={editingIdx !== null ? COMPETITOR_ROWS[editingIdx] : null}
    />
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectSetupPage({ tab }) {
  const [activeTab, setActiveTab] = useState(tab || 'Domain');
  useEffect(() => { if (tab) { setActiveTab(tab); setSelectedPageProject(null); setSelectedCompetitor(null); setSelectedKwProject(null); setSearch(''); } }, [tab]);
  const [filter, setFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [pages, setPages] = useState(INITIAL_PAGES);
  const [kwClusters, setKwClusters] = useState([]);
  const [kwClustersLoading, setKwClustersLoading] = useState(true);
  const [kwClustersError, setKwClustersError] = useState('');
  const [selectedPageProject, setSelectedPageProject] = useState(null);
  const [selectedCompetitor, setSelectedCompetitor] = useState(null);
  const [selectedKwProject, setSelectedKwProject] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddPages, setShowAddPages] = useState(false);
  const [showAddKeywords, setShowAddKeywords] = useState(false);
  const [showAddCompetitors, setShowAddCompetitors] = useState(false);

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
    fetchKwProjects()
      .then(rows => { if (!cancelled) { setKwClusters(rows); setKwClustersError(''); } })
      .catch(err => { if (!cancelled) setKwClustersError(err.message || 'Failed to load projects.'); })
      .finally(() => { if (!cancelled) setKwClustersLoading(false); });
    return () => { cancelled = true; };
  }, []);

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

  const handleCreateProject = async (data) => {
    const location = data.regions[0] || 'Global';
    const locationIcon = data.platforms.includes('google') ? 'google'
      : data.platforms.includes('ai_mode') || data.platforms.includes('ai_overview') ? 'ai'
      : 'desktop';

    const created = await createProject(data);
    setProjects(prev => [created, ...prev]);

    setPages(prev => [...prev, {
      name: data.name,
      domain: data.domain,
      locationIcon,
      location,
      totalPages: 0,
      commercialPct: '0/0',
      blogPages: 0,
      blogDir: null,
      keywords: 0,
      keywordsDir: null,
      updated: 'Just now',
    }]);
  };

  const handleUpdateProject = async (project, updates) => {
    const updated = await updateDomainRow(project.id, updates);
    setProjects(prev => prev.map(p => p === project ? updated : p));
  };

  const handleDeleteProject = async (project) => {
    await deleteDomainRow(project.id);
    setProjects(prev => prev.filter(p => p !== project));
  };

  const handleImportPages = (data) => {
    const newRows = data.pages.map(r => ({
      pageName: r.pageName,
      url: r.url,
      cluster: r.cluster,
      category: r.category,
      targetCategory: '',
      targetType: '',
    }));

    setPages(prev => {
      const targetIdx = typeof data.targetIndex === 'number' ? data.targetIndex : prev.findIndex(p => p.domain === data.domain);

      if (targetIdx !== -1) {
        return prev.map((p, i) => {
          if (i !== targetIdx) return p;
          const detailPages = [...(p.detailPages || []), ...newRows];
          const commercialPages = detailPages.filter(r => (r.targetType || '').toLowerCase().includes('commercial')).length;
          return {
            ...p,
            detailPages,
            totalPages: detailPages.length,
            commercialPct: `${commercialPages}/${detailPages.length}`,
            updated: 'Just now',
          };
        });
      }

      const matchedProject = projects.find(p => p.domain === data.domain);
      return [...prev, {
        name: data.name,
        domain: data.domain,
        locationIcon: matchedProject?.locationIcon || 'desktop',
        location: matchedProject?.location || 'Global',
        totalPages: newRows.length,
        commercialPct: `0/${newRows.length}`,
        blogPages: 0,
        blogDir: 'up',
        keywords: 0,
        keywordsDir: null,
        updated: 'Just now',
        detailPages: newRows,
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

  const filterTabs = ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'];

  const ctaByTab = {
    Domain: { label: 'Create project', onClick: () => setShowCreate(true) },
    'KW Cluster': { label: 'Add Keywords', onClick: () => setShowAddKeywords(true) },
    Pages: { label: 'Add Pages', onClick: () => setShowAddPages(true) },
    Competitors: { label: 'Add Competitors', onClick: () => setShowAddCompetitors(true) },
    Outreach: { label: 'Add Outreach', onClick: () => {} },
    Connectors: { label: 'Connect', onClick: () => {} },
  };

  const cta = ctaByTab[activeTab];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Home</span><span>›</span><span>SEO</span><span>›</span><span style={{ color: 'var(--text-primary)' }}>Position Tracking</span>
      </div>

      {/* Page title */}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 20 }}>
        Project Setup
      </h1>

      {/* Horizontal tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => { setActiveTab(t); setSelectedPageProject(null); setSelectedCompetitor(null); setSelectedKwProject(null); setSearch(''); }}
            style={{
              padding: '10px 20px',
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
        ))}
      </div>

      {/* Main card */}
      <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', flex: '0 0 260px' }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={
                activeTab === 'Pages' && selectedPageProject !== null ? 'Page name or url'
                : activeTab === 'KW Cluster' && selectedKwProject !== null ? 'Search keywords'
                : 'Project name or domain'
              }
              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, fontFamily: 'var(--font-body)', color: 'var(--text-primary)', width: '100%' }}
            />
          </div>

          {/* Filter pills — Domain tab only */}
          {activeTab === 'Domain' && (
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {filterTabs.map(f => (
                <button key={f} onClick={() => setFilter(prev => prev === f ? null : f)} style={{
                  padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  fontFamily: 'var(--font-body)', transition: 'all 0.15s',
                  background: filter === f ? '#0f1523' : '#fff',
                  color: filter === f ? '#fff' : 'var(--text-secondary)',
                  borderRight: f !== 'Gemini' ? '1px solid var(--border)' : 'none',
                }}>{f}</button>
              ))}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* CTA */}
          {activeTab === 'Competitors' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowAddCompetitors(true)}
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
                Add Competitors
              </button>
              <button
                onClick={() => setShowAddPages(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#fff', color: '#0f1523', border: '1.5px solid #0f1523', borderRadius: 8,
                  padding: '8px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'var(--font-body)', transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <Plus size={15} />
                Add Pages
              </button>
            </div>
          ) : (
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
          )}
        </div>

        {/* Table */}
        {activeTab === 'KW Cluster' && selectedKwProject !== null ? (
          <KwClusterDetailView
            project={kwClusters[selectedKwProject]}
            search={search}
            onBack={() => { setSelectedKwProject(null); setSearch(''); }}
            onUpdateKeywords={(updated) => setKwClusters(prev => prev.map((p, i) => i === selectedKwProject ? { ...p, detailKeywords: updated } : p))}
          />
        ) : activeTab === 'Pages' && selectedPageProject !== null ? (
          <PageDetailView
            project={pages[selectedPageProject]}
            onBack={() => setSelectedPageProject(null)}
            onUpdatePages={(updated) => setPages(prev => prev.map((p, i) => i === selectedPageProject ? { ...p, detailPages: updated } : p))}
          />
        ) : activeTab === 'Competitors' && selectedCompetitor !== null ? (
          <CompetitorDetailView
            competitor={COMPETITOR_ROWS[selectedCompetitor]}
            onBack={() => setSelectedCompetitor(null)}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {activeTab === 'Domain' && <DomainTab projects={projects} filter={filter} onUpdateProject={handleUpdateProject} onDeleteProject={handleDeleteProject} loading={projectsLoading} error={projectsError} />}
            {activeTab === 'KW Cluster' && <PagesTab pages={kwClusters} onSelectProject={(i) => { setSelectedKwProject(i); setSearch(''); }} loading={kwClustersLoading} error={kwClustersError} />}
            {activeTab === 'Pages' && <PagesTab pages={pages} onSelectProject={setSelectedPageProject} />}
            {activeTab === 'Competitors' && <CompetitorsTab onSelectCompetitor={setSelectedCompetitor} />}
            {(activeTab === 'Outreach' || activeTab === 'Connectors') && (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                No {activeTab.toLowerCase()} configured yet. Click <strong>+ {cta.label}</strong> to get started.
              </div>
            )}
          </div>
        )}

        {/* Pagination — the KW Cluster detail view renders its own paginated footer */}
        {!(activeTab === 'KW Cluster' && selectedKwProject !== null) && (
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
        lockedProject={activeTab === 'Pages' && selectedPageProject !== null ? { index: selectedPageProject, name: pages[selectedPageProject].name, domain: pages[selectedPageProject].domain } : null}
      />
      <AddKeywordsModal
        open={showAddKeywords}
        onClose={() => setShowAddKeywords(false)}
        projects={projects}
        onImportKeywords={handleImportKeywords}
        lockedProject={activeTab === 'KW Cluster' && selectedKwProject !== null ? { index: selectedKwProject, slug: kwClusters[selectedKwProject].slug, name: kwClusters[selectedKwProject].name, domain: kwClusters[selectedKwProject].domain } : null}
      />
      <AddCompetitorsModal open={showAddCompetitors} onClose={() => setShowAddCompetitors(false)} />
    </div>
  );
}
