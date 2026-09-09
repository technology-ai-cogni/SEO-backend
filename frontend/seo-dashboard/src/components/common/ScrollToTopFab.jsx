import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp } from 'lucide-react';

/**
 * Floating "back to top" button. These pages don't always scroll the window --
 * the data table often scrolls inside its own sticky-header container -- so we
 * listen for scroll on ANY element (capture phase) and, on click, send every
 * plausible scroll container (the last-scrolled element, <main>, the document,
 * the window) back to the top.
 */
export default function ScrollToTopFab({ threshold = 160 }) {
  const [visible, setVisible] = useState(false);
  const lastElRef = useRef(null);

  useEffect(() => {
    const tops = () => {
      const arr = [window.scrollY || 0];
      const m = document.querySelector('main');
      if (m) arr.push(m.scrollTop || 0);
      if (document.scrollingElement) arr.push(document.scrollingElement.scrollTop || 0);
      if (lastElRef.current) arr.push(lastElRef.current.scrollTop || 0);
      return arr;
    };
    const check = () => setVisible(Math.max(0, ...tops()) > threshold);
    const onScroll = (e) => {
      const t = e.target;
      if (t && t.nodeType === 1 && typeof t.scrollTop === 'number') lastElRef.current = t;
      check();
    };
    // capture:true so scroll on inner containers (which don't bubble) still reaches us
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    check();
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('scroll', onScroll);
    };
  }, [threshold]);

  const toTop = () => {
    const els = new Set();
    if (lastElRef.current) els.add(lastElRef.current);
    const m = document.querySelector('main');
    if (m) els.add(m);
    if (document.scrollingElement) els.add(document.scrollingElement);
    els.forEach((el) => {
      try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { el.scrollTop = 0; }
    });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { /* noop */ }
  };

  if (!visible) return null;

  return createPortal(
    <button
      type="button"
      onClick={toTop}
      title="Back to top"
      aria-label="Back to top"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 2000,
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        color: '#ffffff',
        background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
        boxShadow: '0 8px 24px rgba(124, 58, 237, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(124, 58, 237, 0.55)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(124, 58, 237, 0.45)'; }}
    >
      <ChevronUp size={22} />
    </button>,
    document.body
  );
}
