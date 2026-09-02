import React, { useState } from 'react';
import {
  Bell,
  Users,
  Trash2,
  FileText,
  Settings as SettingsIcon,
  HelpCircle,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import UsersPage from './UsersPage';
import RecycleBinPage from './RecycleBinPage';
import LogsPage from './LogsPage';
import ProfilePage from './ProfilePage';
import { canAccessRoute } from '../../lib/permissions';

export default function GeneralSettingsPage({ initialTab = 'settings', user, onNavigate, onUserUpdate }) {
  const canSeeUsers = canAccessRoute(user, 'users');
  const canSeeRecycleBin = canAccessRoute(user, 'recycle-bin');
  const canSeeLogs = canAccessRoute(user, 'logs');

  const tabs = [
    { id: 'settings', label: 'Account Settings', icon: SettingsIcon },
    ...(canSeeUsers ? [{ id: 'users', label: 'Users', icon: Users }] : []),
    ...(canSeeRecycleBin ? [{ id: 'recycle-bin', label: 'Recycle Bin', icon: Trash2 }] : []),
    ...(canSeeLogs ? [{ id: 'logs', label: 'Logs', icon: FileText }] : []),
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'help', label: 'Help', icon: HelpCircle },
  ];

  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === 'users' && !canSeeUsers) return 'settings';
    if (initialTab === 'recycle-bin' && !canSeeRecycleBin) return 'settings';
    if (initialTab === 'logs' && !canSeeLogs) return 'settings';
    return initialTab;
  });

  return (
    <div style={{ padding: '24px 32px', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Top Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>
          General Settings
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0 0' }}>
          {canSeeUsers || canSeeRecycleBin || canSeeLogs
            ? 'Manage user permissions, account configurations, system notifications, logs, and recycle bin.'
            : 'Manage account configurations, security, and system notifications.'}
        </p>
      </div>

      {/* Multi-Tab Navigation Bar */}
      <div style={{
        background: '#ffffff',
        borderRadius: 14,
        border: '1px solid #e2e8f0',
        padding: '6px',
        marginBottom: 24,
        display: 'flex',
        gap: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        overflowX: 'auto'
      }}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 18px',
                borderRadius: 9,
                border: isActive ? '1.5px solid #09060E' : '1.5px solid transparent',
                background: isActive ? 'linear-gradient(135deg, #4A1A8C 0%, #7B2FBE 45%, #C8196B 80%, #D4007A 100%)' : 'transparent',
                color: isActive ? '#ffffff' : '#64748b',
                fontSize: 13,
                fontWeight: isActive ? 700 : 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
                boxShadow: isActive ? '0 4px 14px rgba(121, 40, 202, 0.28)' : 'none'
              }}
            >
              <Icon size={16} color={isActive ? '#ffffff' : '#64748b'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Panels */}
      <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {activeTab === 'settings' && (
          <ProfilePage user={user} onUserUpdate={onUserUpdate} onNavigate={onNavigate} />
        )}

        {activeTab === 'users' && (
          <UsersPage user={user} onNavigate={onNavigate} />
        )}

        {activeTab === 'recycle-bin' && (
          <RecycleBinPage user={user} onNavigate={onNavigate} />
        )}

        {activeTab === 'logs' && (
          <LogsPage user={user} onNavigate={onNavigate} />
        )}

        {activeTab === 'notifications' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>System Notifications</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>Recent system alerts, rank check updates, and automated notifications.</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                <CheckCircle size={20} color="#10b981" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>SE Ranking Traffic Sync Completed</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>Dynamic top 3 regional traffic data successfully updated across active projects.</div>
                </div>
                <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>Just now</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                <Bell size={20} color="var(--accent)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>Off-Page Activity Calendar Updated</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>New activities created under Saved & Scheduled status.</div>
                </div>
                <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>1 hour ago</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                <AlertCircle size={20} color="#f59e0b" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>AI Mode Model Check</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>GPT-4o mini and Gemini API models are online and responsive.</div>
                </div>
                <span style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>Today, 09:30 AM</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'help' && (
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>Help & Documentation</h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Find answers to common questions and guide documentation for hariba.ai platform.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div style={{ padding: 18, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Brand Discovery & AI Visibility</h4>
                <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>Learn how multi-engine AI search rankings (ChatGPT, Gemini, Google AIO) are calculated.</p>
              </div>
              <div style={{ padding: 18, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Off-Page Activity Calendar</h4>
                <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>Guide on AI vs Manual scheduling for guest posts, niche edits, and press releases.</p>
              </div>
              <div style={{ padding: 18, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' }}>
                <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Domain & Traffic Metrics</h4>
                <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>How RapidAPI & SE Ranking fetch Domain Authority (DA) and dynamic Top 3 Country Traffic.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
