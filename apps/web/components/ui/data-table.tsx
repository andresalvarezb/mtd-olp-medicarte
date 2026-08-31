import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';

interface Column {
  label: string;
}

interface DataTableProps {
  columns: Column[];
  rows?: ReactNode[][] | undefined;
  emptyIcon: string;
  emptyTitle: string;
  emptyDescription: string;
  'aria-label'?: string;
}

/**
 * Tabla operativa: encabezados uppercase, scroll horizontal y estado vacío
 * ocupando el ancho completo de columnas. Si se entregan filas, se renderizan
 * en lugar del estado vacío.
 */
export function DataTable({ columns, rows, emptyIcon, emptyTitle, emptyDescription, ...rest }: DataTableProps) {
  const hasRows = rows && rows.length > 0;
  return (
    <div className="table-wrap">
      <table {...rest}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasRows ? (
            rows.map((cells, rowIndex) => (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr className="empty-row">
              <td colSpan={columns.length}>
                <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
