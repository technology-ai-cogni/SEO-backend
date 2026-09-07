// Single source of truth for "top 2 keywords per category, by search volume".
//
// Group the project's keywords by CATEGORY (cluster as fallback), sort each
// group by search volume (desc), take literally the top 2 of each group, then
// de-duplicate across the whole set. NO back-filling: if a category's top 2 are
// also the top of another category, that keyword is simply counted once -- so
// 20 categories yield AT MOST 40 keywords, and the returned count is the number
// of UNIQUE keywords among those.
//
// This drives BOTH which keywords get sent to the AI and every "Total Search
// Terms" / analyzed-keyword count in the UI, so Brand Discovery and Top Pages AI
// always agree.

function parseSv(k) {
  const raw = k.sv ?? k.search_volume ?? k.kw_volume ?? k.volume ?? k.searchVolume ?? 0;
  const n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function kwString(k) {
  if (typeof k === 'string') return k.trim();
  return String(k.kw || k.keyword || k.name || '').trim();
}

export function getTop2KeywordsPerCategory(kws) {
  if (!kws || !Array.isArray(kws) || kws.length === 0) return [];

  const groups = {};
  kws.forEach((k) => {
    const cat = String(k.category || k.cluster || 'General').trim();
    (groups[cat] = groups[cat] || []).push(k);
  });

  const selected = [];
  const seen = new Set();

  // Alphabetical category order -> stable result regardless of row order.
  Object.keys(groups).sort().forEach((cat) => {
    const sorted = [...groups[cat]].sort((a, b) => parseSv(b) - parseSv(a));
    // Literally the top 2 of this category -- no walking further down the list.
    sorted.slice(0, 2).forEach((k) => {
      const t = kwString(k).toLowerCase();
      if (t && !seen.has(t)) {
        seen.add(t);
        selected.push(k);
      }
    });
  });

  return selected;
}

// Same selection, returned as plain keyword strings.
export function getTop2KeywordStrings(kws) {
  return getTop2KeywordsPerCategory(kws).map(kwString).filter(Boolean);
}
