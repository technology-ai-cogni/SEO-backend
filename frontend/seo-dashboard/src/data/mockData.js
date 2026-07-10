import { parseKwDump, parseBrandMentions } from './csvParser';
import kwDumpCsv from '../../datasets/Cognitute X GSG Schools - OWIS  Keyword Research Rough Sheet - KW Dump Filtered.csv?raw';
import brandMentionCsv from '../../datasets/Cognitute X GSG Schools - OWIS  Keyword Research Rough Sheet - Brand Mention .csv?raw';

// ── Parse CSVs ──────────────────────────────────────────────────────
const allKeywords = parseKwDump(kwDumpCsv);
const allBrandMentions = parseBrandMentions(brandMentionCsv);

// ── Keyword data (from KW Dump Filtered) ────────────────────────────
export const topKeywords = allKeywords
  .sort((a, b) => b.volume - a.volume)
  .map(kw => ({
    keyword: kw.keyword,
    intent: kw.intent,
    volume: kw.volume,
    kd: kw.kd,
    cluster: kw.cluster,
    target: kw.target,
    category: kw.category,
    topic: kw.topic,
  }));

export const totalKeywordCount = allKeywords.length;

// ── K/D difficulty distribution ─────────────────────────────────────
const kwWithKd = allKeywords.filter(k => k.kd !== null);
export const rankingsDistribution = [
  { range: 'Easy (1–20)', count: kwWithKd.filter(k => k.kd <= 20).length, color: '#16a34a' },
  { range: 'Medium (21–40)', count: kwWithKd.filter(k => k.kd > 20 && k.kd <= 40).length, color: '#3b82f6' },
  { range: 'Hard (41–60)', count: kwWithKd.filter(k => k.kd > 40 && k.kd <= 60).length, color: '#f59e0b' },
  { range: 'Very Hard (61+)', count: kwWithKd.filter(k => k.kd > 60).length, color: '#ef4444' },
  { range: 'N/A', count: allKeywords.filter(k => k.kd === null).length, color: '#94a3b8' },
];

// ── Intent distribution ─────────────────────────────────────────────
export const intentDistribution = (() => {
  const counts = {};
  allKeywords.forEach(k => {
    const intent = k.intent || 'Unknown';
    counts[intent] = (counts[intent] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);
})();

// ── Cluster distribution ────────────────────────────────────────────
export const clusterDistribution = (() => {
  const counts = {};
  allKeywords.forEach(k => {
    const cluster = k.cluster || 'Unknown';
    counts[cluster] = (counts[cluster] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([cluster, count]) => ({ cluster, count }))
    .sort((a, b) => b.count - a.count);
})();

// ── Brand Mention data ──────────────────────────────────────────────
export const brandMentions = allBrandMentions;

export const mentionsBySource = (() => {
  const counts = { SERP: 0, 'AI Overview': 0, ChatGPT: 0 };
  allBrandMentions.forEach(m => {
    if (counts[m.source] !== undefined) counts[m.source]++;
    else counts[m.source] = 1;
  });
  return counts;
})();

export const brandMentionKeywords = [...new Set(allBrandMentions.map(m => m.keyword))];

export const mentionedSites = (() => {
  const siteCounts = {};
  allBrandMentions.forEach(m => {
    if (m.siteName) {
      const domain = m.siteName.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
      siteCounts[domain] = (siteCounts[domain] || 0) + 1;
    }
  });
  return Object.entries(siteCounts)
    .map(([site, count]) => ({ site, count }))
    .sort((a, b) => b.count - a.count);
})();

// ── Competitor data (from brand mentions) ───────────────────────────
export const competitorData = (() => {
  const siteData = {};
  allBrandMentions.forEach(m => {
    if (!m.siteName) return;
    const domain = m.siteName.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    if (!siteData[domain]) {
      siteData[domain] = { total: 0, ai: 0, serp: 0, lowPosition: 0 };
    }
    siteData[domain].total++;
    if (m.source === 'AI Overview' || m.source === 'ChatGPT') siteData[domain].ai++;
    if (m.source === 'SERP') siteData[domain].serp++;
    if (m.position === 'Low') siteData[domain].lowPosition++;
  });

  return Object.entries(siteData)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([name, data]) => ({
      name,
      mentions: data.total,
      aiMentions: data.ai,
      serpMentions: data.serp,
      aiVisibility: Math.round((data.ai / Math.max(data.total, 1)) * 100),
    }));
})();

// ── AI source breakdown for AI Visibility page ──────────────────────
export const aiSources = [
  { name: 'SERP', mentions: mentionsBySource.SERP || 0, color: '#3b82f6' },
  { name: 'AI Overview', mentions: mentionsBySource['AI Overview'] || 0, color: '#10b981' },
  { name: 'ChatGPT', mentions: mentionsBySource.ChatGPT || 0, color: '#6366f1' },
].map(s => {
  const total = allBrandMentions.length || 1;
  return { ...s, share: Math.round((s.mentions / total) * 100) };
});

// ── Time-series data (static — no temporal data in CSVs) ────────────
export const visibilityData = [
  { date: 'Jun 8', value: 1.89 },
  { date: 'Jun 10', value: 1.72 },
  { date: 'Jun 12', value: 1.95 },
  { date: 'Jun 14', value: 1.81 },
  { date: 'Jun 16', value: 1.63 },
  { date: 'Jun 18', value: 1.44 },
  { date: 'Jun 20', value: 1.44 },
  { date: 'Jun 22', value: 1.44 },
];

export const trafficData = [
  { date: 'Jun 8', value: 20.1 },
  { date: 'Jun 10', value: 22.4 },
  { date: 'Jun 12', value: 24.8 },
  { date: 'Jun 14', value: 23.2 },
  { date: 'Jun 16', value: 24.1 },
  { date: 'Jun 18', value: 25.87 },
  { date: 'Jun 20', value: 25.87 },
  { date: 'Jun 22', value: 25.87 },
];

export const positionData = [
  { date: 'Jun 8', value: 91.2 },
  { date: 'Jun 10', value: 89.5 },
  { date: 'Jun 12', value: 88.1 },
  { date: 'Jun 14', value: 87.4 },
  { date: 'Jun 16', value: 86.9 },
  { date: 'Jun 18', value: 86.38 },
  { date: 'Jun 20', value: 86.38 },
  { date: 'Jun 22', value: 86.38 },
];

export const aiVisibilityData = [
  { date: 'May', value: 8 },
  { date: 'May 2', value: 10 },
  { date: 'May 3', value: 9 },
  { date: 'Jun', value: 11 },
  { date: 'Jun 2', value: 13 },
  { date: 'Jun 3', value: 14 },
];

// ── Top Pages (static — no page-level data in CSVs) ─────────────────
export const topPages = [
  { page: '/blog/ai-strategy-2024', traffic: 842, keywords: 48, position: 6.2 },
  { page: '/services/consulting', traffic: 621, keywords: 92, position: 14.1 },
  { page: '/blog/management-consulting-guide', traffic: 394, keywords: 31, position: 18.7 },
  { page: '/about', traffic: 287, keywords: 19, position: 22.4 },
  { page: '/blog/digital-transformation', traffic: 203, keywords: 27, position: 28.3 },
];

// ── Project Setup derived data ───────────────────────────────────────
const landingKws = allKeywords.filter(k => k.target === 'Landing Page');
const blogKws = allKeywords.filter(k => k.target === 'Topical Blog');

// Join Brand Mention (Site Name, Page URL) with KW Dump (Cluster, Intent, Target)
// Shows ALL entries from Brand Mention CSV — each keyword × source combination
export const derivedPages = (() => {
  const kwLookup = {};
  allKeywords.forEach(kw => {
    const key = kw.keyword.toLowerCase().replace(/​/g, '').trim();
    if (!kwLookup[key]) kwLookup[key] = kw;
  });

  return allBrandMentions
    .filter(m => m.pageUrl)
    .map(m => {
      const kwKey = m.keyword.toLowerCase().replace(/​/g, '').trim();
      const kwData = kwLookup[kwKey];

      return {
        pageName: m.siteName.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''),
        url: m.pageUrl,
        cluster: kwData?.cluster || '',
        category: kwData?.category || '',
        targetCategory: kwData?.target || '',
        targetType: kwData?.intent || '',
        source: m.source,
        keyword: m.keyword,
      };
    });
})();

// ── KW Cluster detail rows (from KW Dump) ────────────────────────────
export const derivedKeywordClusters = allKeywords.map(k => ({
  kw: k.keyword,
  sv: k.volume,
  kwDiff: k.kd,
  type: 'Organic',
  cluster: k.cluster,
  category: k.category,
  targetType: k.target === 'Topical Blog' ? 'Topical Blogs' : (k.target === 'Landing Page' ? 'Landing Page' : 'Blogs'),
  targetSubtype: k.intent.toLowerCase().includes('commercial') ? 'Commercial' : 'Informational',
  targetGeo: k.geo,
  priority: '',
  landingPage: '',
}));

export const projectSetupData = {
  totalKeywords: allKeywords.length,
  landingPageCount: landingKws.length,
  blogPageCount: blogKws.length,
  clusters: [...new Set(allKeywords.map(k => k.cluster))].length,
  totalVolume: allKeywords.reduce((s, k) => s + k.volume, 0),
  brandMentionCount: allBrandMentions.length,
  aiMentionCount: allBrandMentions.filter(m => m.source === 'AI Overview' || m.source === 'ChatGPT').length,
};

// ── Summary alerts (derived from real data) ─────────────────────────
const totalVolume = allKeywords.reduce((sum, k) => sum + k.volume, 0);
const avgKd = kwWithKd.length ? Math.round(kwWithKd.reduce((s, k) => s + k.kd, 0) / kwWithKd.length) : 0;
const commercialCount = allKeywords.filter(k => k.intent.toLowerCase().includes('commercial')).length;
const informationalCount = allKeywords.filter(k => k.intent.toLowerCase().includes('informational')).length;

export const summaryAlerts = [
  { type: 'info', message: `Tracking ${allKeywords.length} keywords across ${[...new Set(allKeywords.map(k => k.cluster))].length} clusters with a combined search volume of ${totalVolume.toLocaleString()}.` },
  { type: 'success', message: `${commercialCount} commercial-intent keywords identified — high conversion potential for landing pages and blog content.` },
  { type: 'warning', message: `Average keyword difficulty is ${avgKd}. Focus on the ${kwWithKd.filter(k => k.kd <= 20).length} easy-difficulty keywords (K/D ≤ 20) for quick wins.` },
  { type: 'tip', message: `${brandMentionKeywords.length} keywords tracked for brand mentions across ${allBrandMentions.length} competitor citations in SERP, AI Overview, and ChatGPT.` },
];
