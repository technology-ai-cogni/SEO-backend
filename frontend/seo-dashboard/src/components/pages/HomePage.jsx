import { useState } from 'react';
import { Search, ArrowRight, Activity, FolderOpen } from 'lucide-react';

export default function HomePage({ onNavigate, projects = [], activeProject, setActiveProject, onStartAudit, loadingProjects = false }) {
  const [urlInput, setUrlInput] = useState('');
  const [errorText, setErrorText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorText('');
    const cleanUrl = urlInput.trim();
    if (!cleanUrl) {
      setErrorText('Please enter a valid website domain.');
      return;
    }

    // Basic domain validation
    const domainRegex = /^(https?:\/\/)?([a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5})(:[0-9]{1,5})?(\/.*)?$/i;
    if (!domainRegex.test(cleanUrl)) {
      setErrorText('Please enter a valid domain (e.g. example.com).');
      return;
    }

    // Extract domain name (host name)
    let domainName = cleanUrl.replace(/^(https?:\/\/)?(www\.)?/i, '').split('/')[0];
    
    setLoading(true);
    try {
      if (onStartAudit) {
        await onStartAudit(domainName);
      }
    } catch (err) {
      setErrorText(err.message || 'Failed to start audit.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSaved = async (slug) => {
    if (!slug) return;
    const project = projects.find(p => p.slug === slug);
    if (project) {
      setActiveProject(project);
      setLoading(true);
      try {
        if (onStartAudit) {
          await onStartAudit(project.domain);
        }
      } catch (err) {
        setErrorText(err.message || 'Failed to load project audit.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div style={{
      minHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '40px 24px',
      maxWidth: 900,
      margin: '0 auto',
      textAlign: 'center'
    }}>
      {/* Title */}
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: '2.5rem',
        fontWeight: 800,
        color: 'var(--text-primary)',
        lineHeight: 1.2,
        marginBottom: '32px',
        letterSpacing: '-0.8px',
        maxWidth: 700
      }}>
        Start optimizing your online presence
      </h1>

      {/* Form Container */}
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        gap: 12,
        width: '100%',
        maxWidth: 600,
        marginBottom: 16
      }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--surface)',
          border: errorText ? '1px solid var(--red)' : '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '6px 16px',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
          transition: 'border-color 0.2s'
        }}
        onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--accent)'}
        onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}>
          <Search size={18} color="var(--text-muted)" />
          <input
            value={urlInput}
            onChange={e => {
              setUrlInput(e.target.value);
              setErrorText('');
            }}
            placeholder="Enter a website"
            disabled={loading}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 15,
              fontFamily: 'var(--font-body)',
              color: 'var(--text-primary)',
              flex: 1,
              padding: '8px 0'
            }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 15,
            fontWeight: 700,
            color: '#000000',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 'var(--radius)',
            padding: '0 28px',
            cursor: 'pointer',
            transition: 'background 0.2s, transform 0.1s',
            fontFamily: 'var(--font-body)',
            boxShadow: '0 4px 12px rgba(250, 204, 21, 0.2)'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
          onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
          onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}>
          {loading ? (
            <>
              <Activity size={16} className="animate-spin" />
              Auditing...
            </>
          ) : (
            <>
              Start now
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>

      {/* Error Text */}
      {errorText && (
        <div style={{ color: 'var(--red)', fontSize: 13.5, fontWeight: 500, marginBottom: 16 }}>
          {errorText}
        </div>
      )}

      {/* Saved Projects Dropdown Selector */}
      {projects.length > 0 && (
        <div style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 20px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)'
        }}>
          <FolderOpen size={14} color="var(--text-muted)" />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
            Or load a saved project:
          </span>
          <select
            onChange={(e) => handleSelectSaved(e.target.value)}
            defaultValue=""
            disabled={loading}
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              fontSize: 13,
              fontFamily: 'var(--font-body)',
              color: 'var(--accent)',
              fontWeight: 600,
              cursor: 'pointer',
              outline: 'none'
            }}
          >
            <option value="" disabled style={{ color: 'var(--text-muted)' }}>Select project...</option>
            {projects.map(p => (
              <option key={p.slug} value={p.slug} style={{ color: 'var(--text-primary)' }}>
                {p.domain || p.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
