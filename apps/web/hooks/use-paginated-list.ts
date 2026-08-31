'use client';

import { useEffect, useRef, useState } from 'react';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UsePaginatedListResult<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
  reload: () => void;
  nextPage: () => void;
  prevPage: () => void;
}

/**
 * Paginación por cursor (keyset) sobre listas de la API. Conserva la pila de
 * cursores visitados para habilitar Anterior/Siguiente; cualquier cambio en
 * `deps` (filtros, organización) reinicia a la primera página. La API no
 * expone total de registros, por lo que la paginación es relativa.
 */
export function usePaginatedList<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  deps: unknown[],
): UsePaginatedListResult<T> {
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [position, setPosition] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const skipReset = useRef(true);
  useEffect(() => {
    if (skipReset.current) {
      skipReset.current = false;
      return;
    }
    setHistory([undefined]);
    setPosition(0);
    setNextCursor(null);
    setNonce((value) => value + 1);
  }, [...deps]);

  const cursor = history[position];
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(cursor)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error inesperado al consultar la API.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, nonce, ...deps]);

  const reload = () => setNonce((value) => value + 1);
  const nextPage = () => {
    if (!nextCursor || loading) return;
    setHistory((stack) => [...stack, nextCursor]);
    setPosition((value) => value + 1);
  };
  const prevPage = () => {
    if (position === 0 || loading) return;
    setPosition((value) => Math.max(0, value - 1));
  };

  return {
    items,
    loading,
    error,
    page: position + 1,
    hasNext: nextCursor !== null,
    hasPrev: position > 0,
    reload,
    nextPage,
    prevPage,
  };
}
