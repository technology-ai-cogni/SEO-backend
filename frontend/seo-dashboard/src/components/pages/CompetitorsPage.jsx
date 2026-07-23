import { useState } from 'react';
import { Card, Badge } from '../ui/Card';
import { Search, Plus, Pencil, Monitor, Globe, Smartphone } from 'lucide-react';

const COMPETITORS = [
  {
    id: 1,
    name: 'OWIS Singapore',
    domain: 'owis.org',
    device: 'Desktop',
    location: 'Singapore',
    da: 44,
    commonKw: 44.29,
    commonKwChange: -0.47,
    totalKw: 139,
    totalKwChange: 139,
    aiCompLevel: 137,
    aiCompLevelChange: -137,
    serpCompLevel: 757,
    compLevel: 82,
    dated: '20h ago',
    targetPlatforms: ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'],
  },
  {
    id: 2,
    name: 'owis.org',
    domain: 'owis.org',
    device: 'Web',
    location: 'Singapore',
    da: 44,
    commonKw: 24.44,
    commonKwChange: 2.40,
    totalKw: 90,
    totalKwChange: 1,
    aiCompLevel: 0,
    aiCompLevelChange: 0,
    serpCompLevel: 4,
    compLevel: 12,
    dated: '19h ago',
    targetPlatforms: ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'],
  },
  {
    id: 3,
    name: 'Google',
    domain: 'google.com',
    device: 'Search',
    location: 'Singapore',
    da: 98,
    commonKw: 5.56,
    commonKwChange: 10.44,
    totalKw: 190,
    totalKwChange: 3,
    aiCompLevel: 0,
    aiCompLevelChange: 0,
    serpCompLevel: 3,
    compLevel: 95,
    dated: '18h ago',
    targetPlatforms: ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'],
  },
  {
    id: 4,
    name: 'ISS International School',
    domain: 'iss.edu.sg',
    device: 'Desktop',
    location: 'Singapore',
    da: 38,
    commonKw: 31.12,
    commonKwChange: 1.23,
    totalKw: 87,
    totalKwChange: 87,
    aiCompLevel: 42,
    aiCompLevelChange: -12,
    serpCompLevel: 412,
    compLevel: 67,
    dated: '16h ago',
    targetPlatforms: ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'],
  },
  {
    id: 5,
    name: 'Chatsworth International',
    domain: 'chatsworth.com.sg',
    device: 'Web',
    location: 'Singapore',
    da: 35,
    commonKw: 18.76,
    commonKwChange: -2.10,
    totalKw: 52,
    totalKwChange: 52,
    aiCompLevel: 28,
    aiCompLevelChange: 5,
    serpCompLevel: 289,
    compLevel: 54,
    dated: '14h ago',
    targetPlatforms: ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'],
  },
];

const TABS = ['AI Mode', 'AI Overview', 'Google', 'ChatGPT', 'Gemini'];

const PLATFORM_STYLES = {
  'AI Mode':     { bg: '#ede9fe', color: '#7c3aed' },
  'AI Overview': { bg: '#dbeafe', color: '#1d4ed8' },
  'Google':      { bg: '#fef9c3', color: '#854d0e' },
  'ChatGPT':     { bg: '#dcfce7', color: '#166534' },
  'Gemini':      { bg: '#fce7f3', color: '#9d174d' },
};

const PlatformBadge = ({ platform }) => {
  const style = PLATFORM_STYLES[platform] || { bg: '#f3f4f6', color: '#374151' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 600,
      background: style.bg,
      color: style.color,
      whiteSpace: 'nowrap',
    }}>
      {platform}
    </span>
  );
};

const DeviceIcon = ({ device }) => {
  if (device === 'Desktop') return <Monitor size={14} color="var(--text-muted)" />;
  if (device === 'Web') return <Globe size={14} color="var(--text-muted)" />;
  if (device === 'Search') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    );
  }
  return <Globe size={14} color="var(--text-muted)" />;
};

const ChangeIndicator = ({ value, showSign = true }) => {
  if (value === 0) return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>0</span>;
  const isPositive = value > 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: isPositive ? 'var(--green)' : 'var(--red)' }}>
      {isPositive ? '↑' : '↓'}{Math.abs(value)}
    </span>
  );
};

export default function CompetitorsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('AI Mode');

  const filtered = COMPETITORS.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.domain.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSearch;
  });

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        {/* Toolbar */}
        <div style={{
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            {/* Search */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 12px',
              minWidth: 220,
            }}>
              <Search size={13} color="var(--text-muted)" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Project name or domain"
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: 13,
                  fontFamily: 'var(--font-body)',
                  flex: 1,
                  color: 'var(--text-primary)',
                }}
              />
            </div>

          </div>

          {/* Add button */}
          <button style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: '#fff',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 16px',
            cursor: 'pointer',
            fontFamily: 'var(--font-body)',
            whiteSpace: 'nowrap',
            transition: 'background 0.15s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
          >
            <Plus size={14} />
            Choose Project
          </button>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Project', 'Device & Location', 'Target Platforms', 'PA', "Common KW's", '', "Tot. KW's", 'AI Comp. Level', 'SERP Comp Level', 'Comp Level', 'dated', ''].map((h, i) => (
                  <th key={i} style={{
                    padding: '10px 16px',
                    textAlign: i === 0 || i === 1 || i === 2 ? 'left' : 'right',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((comp, ri) => (
                <tr
                  key={comp.id}
                  style={{ borderBottom: ri < filtered.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {/* Competitor name & domain */}
                  <td style={{ padding: '14px 16px' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{comp.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{comp.domain}</div>
                    </div>
                  </td>

                  {/* Device & Location */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <DeviceIcon device={comp.device} />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{comp.location}</span>
                    </div>
                  </td>

                  {/* Target Platforms */}
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {comp.targetPlatforms.map(p => <PlatformBadge key={p} platform={p} />)}
                    </div>
                  </td>

                  {/* PA */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700 }}>{comp.da || ''}</span>
                  </td>

                  {/* Common KW's % */}
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 600, color:'var(--text-primary)' }}>
                      {Math.round((comp.commonKw / 100) * comp.totalKw)}<span style={{ fontSize: 18, fontWeight: 300, margin: '0 1px' }}>/</span>{comp.totalKw}
                  
                  </td>

                  {/* Common KW's change */}
                  <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: comp.commonKwChange > 0 ? 'var(--green)' : comp.commonKwChange < 0 ? 'var(--red)' : 'var(--text-muted)',
                    }}>
                      {comp.commonKwChange > 0 ? '+' : ''}{comp.commonKwChange.toFixed(2)}
                    </span>
                  </td>

                  {/* Total KW's */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <ChangeIndicator value={comp.totalKwChange} />
                  </td>

                  {/* AI Comp Level */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {Math.min(comp.aiCompLevel, 100)}%
                    </span>
                  </td>

                  {/* SERP Comp Level */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {Math.min(comp.serpCompLevel, 100)}%
                    </span>
                  </td>

                  {/* Comp Level */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                      {Math.min(comp.compLevel, 100)}%
                    </span>
                  </td>

                  {/* Dated */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{comp.dated}</span>
                  </td>

                  {/* Edit */}
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '5px 8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      <Pencil size={13} color="var(--text-muted)" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No competitors found matching your search.
          </div>
        )}
      </Card>
    </div>
  );
}
