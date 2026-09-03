import React from 'react';

export default function BrandInfinityLoader({
  label = 'Loading data…',
  size = 'md', // 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  showBar = false,
  fullPage = false,
  minHeight = fullPage ? 'calc(100vh - 70px)' : '300px',
  style = {}
}) {
  // Dimensions for SVG & stroke
  const sizeConfig = {
    xs: { width: 44, height: 22, strokeWidth: 2.2, fontSize: 12, barWidth: 120, barHeight: 2, dash: 50 },
    sm: { width: 68, height: 34, strokeWidth: 2.2, fontSize: 13, barWidth: 160, barHeight: 2.5, dash: 60 },
    md: { width: 96, height: 48, strokeWidth: 2.2, fontSize: 13.5, barWidth: 200, barHeight: 3, dash: 80 },
    lg: { width: 116, height: 58, strokeWidth: 2.2, fontSize: 14.5, barWidth: 240, barHeight: 3.5, dash: 90 },
    xl: { width: 136, height: 68, strokeWidth: 2.4, fontSize: 15, barWidth: 260, barHeight: 3.5, dash: 100 }
  };

  const cfg = sizeConfig[size] || sizeConfig.md;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        margin: '0 auto',
        gap: size === 'xs' ? 8 : 14,
        minHeight,
        width: '100%',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        ...style
      }}
    >
      <style>{`
        @keyframes bd-infinity-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.92;
          }
          50% {
            transform: scale(1.06);
            opacity: 1;
          }
        }
        @keyframes bd-infinity-dash {
          0%   { stroke-dashoffset: ${cfg.dash}; }
          50%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -${cfg.dash}; }
        }
        @keyframes bd-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>

      {/* Hariba Logo Infinity Icon */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'bd-infinity-pulse 2s ease-in-out infinite'
        }}
      >
        <svg
          width={cfg.width}
          height={cfg.height}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ filter: 'drop-shadow(0 4px 16px rgba(123, 47, 190, 0.4))' }}
        >
          <defs>
            <linearGradient id="haribaInfinityGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4A1A8C" />
              <stop offset="45%" stopColor="#7B2FBE" />
              <stop offset="80%" stopColor="#C8196B" />
              <stop offset="100%" stopColor="#D4007A" />
            </linearGradient>
          </defs>
          <path
            d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.267-8-12.356-8-5.096 0-5.096 8 0 8 5.09 0 7.261-8 12.356-8Z"
            stroke="url(#haribaInfinityGrad)"
            strokeWidth={cfg.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: `${cfg.dash}`,
              animation: 'bd-infinity-dash 2.4s ease-in-out infinite'
            }}
          />
        </svg>
      </div>

      {/* Label */}
      {label && (
        <span
          style={{
            fontSize: cfg.fontSize,
            color: '#64748B',
            fontWeight: 600,
            letterSpacing: '0.015em'
          }}
        >
          {label}
        </span>
      )}

      {/* Shimmer Bar (Only shown when showBar is true) */}
      {showBar && (
        <div
          style={{
            width: cfg.barWidth,
            height: cfg.barHeight,
            background: '#EDE9F7',
            borderRadius: 99,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              height: '100%',
              width: '50%',
              background: 'linear-gradient(90deg, transparent, #7B2FBE, #D4007A, transparent)',
              animation: 'bd-sweep 1.4s ease-in-out infinite'
            }}
          />
        </div>
      )}
    </div>
  );
}
