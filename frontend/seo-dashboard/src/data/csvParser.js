function splitCsvRow(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function splitLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
}

export function parseKwDump(text) {
  const lines = splitLines(text);
  return lines.slice(1).map(line => {
    const v = splitCsvRow(line);
    return {
      keyword: (v[0] || '').replace(/​/g, '').trim(),
      intent: (v[1] || '').trim(),
      volume: parseInt(v[2]) || 0,
      kd: v[3] === 'n/a' || !v[3] ? null : parseInt(v[3]),
      category: (v[4] || '').trim(),
      cluster: (v[5] || '').trim(),
      target: ((t) => t === 'Blog' || t === 'Blogs' ? 'Topical Blog' : t)((v[6] || '').trim()),
      geo: (v[7] || '').trim(),
      topic: (v[8] || '').trim(),
    };
  }).filter(r => r.keyword);
}

export function parseBrandMentions(text) {
  const lines = splitLines(text);
  return lines.slice(1).map(line => {
    const v = splitCsvRow(line);
    return {
      keyword: (v[0] || '').replace(/​/g, '').trim(),
      siteName: (v[1] || '').trim(),
      pageUrl: (v[2] || '').trim(),
      position: (v[4] || '').trim(),
      source: (v[5] || '').replace('Chat GPT', 'ChatGPT').trim(),
      poc: (v[6] || '').trim(),
    };
  }).filter(r => r.keyword && r.source);
}
