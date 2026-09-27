'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeTopic } from '@authorization/contracts';
import { useRealtimeRevision } from '@/components/realtime/realtime-context';

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
 * Paginación por cursor. Realtime reconcilia la página actual sin alterar
 * cursor, filtros ni navegación del usuario.
 */
export function usePaginatedList<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  deps: unknown[],
  realtimeTopics: readonly RealtimeTopic[] = [],
): UsePaginatedListResult<T> {
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [position, setPosition] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const realtimeRevision = useRealtimeRevision(realtimeTopics);

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

  useEffect(() => {
    if (realtimeRevision === 0) return;
    let cancelled = false;

    fetchPage(cursor)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error inesperado al reconciliar la API.');
      });

    return () => {
      cancelled = true;
    };
  }, [realtimeRevision]);

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
