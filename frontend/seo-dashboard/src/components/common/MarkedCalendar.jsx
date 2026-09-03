import { useEffect, useRef, useState } from 'react';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Local "today" as YYYY-MM-DD (matches <input type="date"> output; avoids the
// UTC off-by-one that new Date().toISOString() can cause near midnight).
export function getLocalTodayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Any timestamp (ISO string / Date) -> local YYYY-MM-DD. Use it to bucket
// dated DB rows (created_at, rank_checked_at, ...) into calendar days.
export function tsToLocalDateStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Small date-picker popover: green dot = today, red dot = a "marked" day
 * (e.g. a day that has stored data). Clicking a day calls onChange(ds).
 *
 *  value        selected date, 'YYYY-MM-DD'
 *  onChange     (ds: 'YYYY-MM-DD') => void
 *  markedDates  Set<string> | string[] of 'YYYY-MM-DD' to red-dot
 *  markLabel    legend label for the red dot (default "Analyzed")
 *  allowFuture  allow selecting future days (default false)
 */
export default function MarkedCalendar({ value, onChange, markedDates, markLabel = 'Analyzed', allowFuture = false }) {
  const todayStr = getLocalTodayStr();
  const selected = value || todayStr;
  const marked = markedDates instanceof Set ? markedDates : new Set(markedDates || []);

  const [open, setOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const p = (selected || todayStr).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, 1);
  });
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const label = (() => {
    try {
      const [y, m, d] = selected.split('-');
      return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return selected; }
  })();

  const goToToday = () => {
    const t = getLocalTodayStr();
    onChange && onChange(t);
    const tn = new Date();
    setCalMonth(new Date(tn.getFullYear(), tn.getMonth(), 1));
    setOpen(false);
  };

  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => {
          setOpen(v => {
            const next = !v;
            if (next) {
              const p = (selected || todayStr).split('-');
              setCalMonth(new Date(Number(p[0]), Number(p[1]) - 1, 1));
            }
            return next;
          });
        }}
        title="Select date"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: 'none', padding: 0, margin: 0,
          fontSize: 13, fontWeight: 600, color: '#2563eb', cursor: 'pointer',
          outline: 'none', whiteSpace: 'nowrap'
        }}
      >
        <span style={{ fontSize: 14 }}>📅</span>
        <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{label}</span>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 12, boxShadow: '0 12px 30px -8px rgba(0,0,0,0.18)', zIndex: 4000, width: 264, padding: 12, color: '#0f172a', fontWeight: 500 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <button onClick={() => setCalMonth(mm => new Date(mm.getFullYear(), mm.getMonth() - 1, 1))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: '#475569', lineHeight: 1, padding: '2px 6px' }}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{MONTH_NAMES[m]} {y}</span>
            <button
              onClick={() => {
                const nm = new Date(y, m + 1, 1);
                const cur = new Date();
                if (allowFuture || nm <= new Date(cur.getFullYear(), cur.getMonth(), 1)) setCalMonth(nm);
              }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: '#475569', lineHeight: 1, padding: '2px 6px' }}
            >›</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: '#94a3b8', padding: '2px 0' }}>{w}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((d, idx) => {
              if (d === null) return <div key={`e${idx}`} />;
              const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const isToday = ds === todayStr;
              const isMark = marked.has(ds);
              const isSelected = ds === selected;
              const isFuture = !allowFuture && ds > todayStr;
              return (
                <button
                  key={ds}
                  disabled={isFuture}
                  onClick={() => { onChange && onChange(ds); setOpen(false); }}
                  title={isMark ? `Data recorded on this day — click to view` : (isToday ? 'Today' : '')}
                  style={{
                    position: 'relative', height: 30,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: isSelected ? 800 : 500,
                    color: isFuture ? '#cbd5e1' : (isSelected ? '#2563eb' : '#0f172a'),
                    background: 'transparent',
                    border: isSelected ? '2px solid #2563eb' : '2px solid transparent',
                    borderRadius: 7,
                    cursor: isFuture ? 'default' : 'pointer'
                  }}
                >
                  {d}
                  {(isToday || isMark) && (
                    <span style={{
                      position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                      width: 5, height: 5, borderRadius: '50%',
                      background: isToday ? '#16a34a' : '#dc2626'
                    }} />
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#64748b', fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} /> Today
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }} /> {markLabel}
              </span>
            </div>
            <button onClick={goToToday} style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: 'transparent', border: 'none', cursor: 'pointer' }}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
