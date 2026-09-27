'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RealtimeTopic } from '@authorization/contracts';
import { useRealtimeRevision } from '@/components/realtime/realtime-context';

interface UseApiDataResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Obtiene datos de la API y reconcilia en segundo plano tras invalidaciones realtime. */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  realtimeTopics: readonly RealtimeTopic[] = [],
): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const realtimeRevision = useRealtimeRevision(realtimeTopics);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === 'POINT_ACCESS_DENIED'
        ) {
          setData(null);
          setError(
            'No tienes acceso a este punto de dispensación. Actualiza para ver el alcance vigente.',
          );
          return;
        }
        setError(err instanceof Error ? err.message : 'Error inesperado al consultar la API.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, nonce]);

  useEffect(() => {
    if (realtimeRevision === 0) return;
    let cancelled = false;

    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === 'POINT_ACCESS_DENIED'
        ) {
          setData(null);
          setError(
            'No tienes acceso a este punto de dispensación. Actualiza para ver el alcance vigente.',
          );
          return;
        }
        setError(err instanceof Error ? err.message : 'Error inesperado al reconciliar la API.');
      });

    return () => {
      cancelled = true;
    };
  }, [realtimeRevision]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}
