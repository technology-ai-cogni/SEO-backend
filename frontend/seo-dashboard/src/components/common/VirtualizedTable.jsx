import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * VirtualizedTable
 * =================
 * Renders thousands of table rows with 60fps performance and minimal memory footprint
 * using @tanstack/react-virtual windowing.
 *
 * Props:
 * - rows: Array of data items
 * - renderRow: (row, index) => ReactNode (typically <td>...</td> elements)
 * - header: ReactNode (typically <tr><th>...</th></tr> elements)
 * - estimateRowHeight: number (default: 48)
 * - overscan: number (default: 8)
 * - maxHeight: string | number (default: '680px')
 * - isLoading: boolean
 * - loadingRenderer: ReactNode
 * - emptyRenderer: ReactNode
 * - minWidth: string | number (default: '100%')
 */
export default function VirtualizedTable({
  rows = [],
  renderRow,
  header,
  estimateRowHeight = 48,
  overscan = 8,
  maxHeight = '680px',
  isLoading = false,
  loadingRenderer = null,
  emptyRenderer = null,
  minWidth = '100%',
  className = '',
  style = {},
}) {
  const parentRef = useRef(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  if (isLoading && loadingRenderer) {
    return <div className={`virtualized-table-loading ${className}`}>{loadingRenderer}</div>;
  }

  if (!isLoading && rows.length === 0 && emptyRenderer) {
    return <div className={`virtualized-table-empty ${className}`}>{emptyRenderer}</div>;
  }

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className={`virtualized-table-container ${className}`}
      style={{
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'auto',
        position: 'relative',
        borderRadius: 8,
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        ...style,
      }}
    >
      <div style={{ minWidth, display: 'inline-block', width: '100%' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'left',
            tableLayout: 'auto',
          }}
        >
          {header && (
            <thead
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 20,
                background: '#f8fafc',
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
              }}
            >
              {header}
            </thead>
          )}
        </table>

        <div
          style={{
            height: `${totalSize}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            return (
              <div
                key={row.id ?? virtualRow.index}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'flex',
                  alignItems: 'stretch',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                  <tbody>
                    <tr
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: '#ffffff',
                        display: 'table-row',
                        width: '100%',
                      }}
                    >
                      {renderRow(row, virtualRow.index)}
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
