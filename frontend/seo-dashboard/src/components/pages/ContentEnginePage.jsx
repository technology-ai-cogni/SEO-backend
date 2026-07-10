import { Card, CardHeader, Badge } from '../ui/Card';
import { SparkLine, BarChartComp } from '../ui/MiniChart';
import { visibilityData, trafficData } from '../../data/mockData';
import { FileText, TrendingUp, Calendar, Globe, Share2, Plus } from 'lucide-react';

const topBlogs = [
  { title: 'AI Strategy Guide for 2024', traffic: 842, growth: 12.4, keywords: 48, published: 'Jun 1, 2026' },
  { title: 'Management Consulting Explained', traffic: 621, growth: -3.2, keywords: 92, published: 'May 15, 2026' },
  { title: 'Digital Transformation Roadmap', traffic: 394, growth: 8.7, keywords: 31, published: 'May 2, 2026' },
  { title: 'Business Process Optimization', traffic: 287, growth: 5.1, keywords: 19, published: 'Apr 20, 2026' },
  { title: 'Enterprise AI Implementation', traffic: 203, growth: 22.3, keywords: 27, published: 'Apr 10, 2026' },
];

const trendTopics = [
  { topic: 'AI in consulting', volume: 8400, trend: '+142%', category: 'Technology' },
  { topic: 'Management frameworks 2026', volume: 3200, trend: '+67%', category: 'Strategy' },
  { topic: 'Digital transformation ROI', volume: 5600, trend: '+38%', category: 'Digital' },
  { topic: 'Agile for enterprises', volume: 2900, trend: '+29%', category: 'Operations' },
];

const calendarItems = [
  { date: 'Jun 25', title: 'AI Consulting Trends Q3', status: 'Draft', channel: 'Blog' },
  { date: 'Jun 28', title: 'Case Study: Digital Transformation', status: 'Scheduled', channel: 'Blog' },
  { date: 'Jul 2', title: 'LinkedIn: AI Strategy Tips', status: 'Planned', channel: 'Social' },
  { date: 'Jul 5', title: 'Top Consulting Tools 2026', status: 'Draft', channel: 'Blog' },
];

const statusColors = { Draft: 'warning', Scheduled: 'success', Planned: 'info' };
const channelColors = { Blog: 'accent', Social: 'default' };

export default function ContentEnginePage() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { icon: FileText, label: 'Published Posts', value: '47', color: 'var(--accent)' },
          { icon: TrendingUp, label: 'Total Blog Traffic', value: '2.3K', color: 'var(--green)' },
          { icon: Globe, label: 'Avg. Position', value: '18.4', color: 'var(--amber)' },
          { icon: Share2, label: 'Social Shares', value: '1.2K', color: 'var(--blue)' },
        ].map(s => (
          <Card key={s.label} style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <s.icon size={14} color={s.color} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{s.label}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800 }}>{s.value}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        {/* Top Blogs */}
        <Card>
          <CardHeader title="Top Blogs by Traffic" subtitle="Last 30 days" />
          <div style={{ padding: '4px 0' }}>
            {topBlogs.map((blog, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: i < topBlogs.length - 1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--border)', width: 24, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{blog.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{blog.keywords} keywords · {blog.published}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{blog.traffic.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: blog.growth > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {blog.growth > 0 ? '▲' : '▼'} {Math.abs(blog.growth)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Trend Spotting */}
        <Card>
          <CardHeader title="Trend Spotting" subtitle="Rising search topics for your niche"
            action={
              <button style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-light)', border: 'none', borderRadius: 99, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                <Plus size={11} /> Add to Calendar
              </button>
            }
          />
          <div style={{ padding: '8px 0' }}>
            {trendTopics.map((t, i) => (
              <div key={i} style={{ padding: '10px 20px', borderBottom: i < trendTopics.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.topic}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t.volume.toLocaleString()} searches/mo · {t.category}</div>
                </div>
                <Badge variant="success">{t.trend}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Content Calendar */}
      <Card>
        <CardHeader title="Content Calendar" subtitle="Upcoming content schedule"
          action={
            <button style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 12px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
              <Plus size={12} /> New Content
            </button>
          }
        />
        <div style={{ padding: '0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Content Title', 'Channel', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calendarItems.map((item, i) => (
                <tr key={i} style={{ borderBottom: i < calendarItems.length - 1 ? '1px solid var(--border)' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '12px 20px', fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 500 }}>{item.date}</td>
                  <td style={{ padding: '12px 20px', fontWeight: 600, fontSize: 13 }}>{item.title}</td>
                  <td style={{ padding: '12px 20px' }}><Badge variant={channelColors[item.channel]}>{item.channel}</Badge></td>
                  <td style={{ padding: '12px 20px' }}><Badge variant={statusColors[item.status]}>{item.status}</Badge></td>
                  <td style={{ padding: '12px 20px' }}>
                    <button style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 500 }}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
