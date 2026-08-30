import { EmptyState } from '@/components/ui/empty-state';

interface Column {
  label: string;
}

interface DataTableProps {
  columns: Column[];
  emptyIcon: string;
  emptyTitle: string;
  emptyDescription: string;
  'aria-label'?: string;
}

/**
 * Tabla operativa del prototipo: encabezados uppercase, scroll horizontal y
 * estado vacío ocupando el ancho completo de columnas.
 */
export function DataTable({ columns, emptyIcon, emptyTitle, emptyDescription, ...rest }: DataTableProps) {
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
          <tr className="empty-row">
            <td colSpan={columns.length}>
              <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
