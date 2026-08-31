'use client';

interface TablePaginationProps {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Controles Anterior/Siguiente para paginación por cursor. Se oculta cuando
 * la lista cabe en una sola página.
 */
export function TablePagination({ page, hasPrev, hasNext, onPrev, onNext }: TablePaginationProps) {
  if (!hasPrev && !hasNext) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 12,
        justifyContent: 'flex-end',
      }}
    >
      <span className="pill blue">Página {page}</span>
      <button type="button" className="btn" disabled={!hasPrev} onClick={onPrev}>
        Anterior
      </button>
      <button type="button" className="btn" disabled={!hasNext} onClick={onNext}>
        Siguiente
      </button>
    </div>
  );
}
