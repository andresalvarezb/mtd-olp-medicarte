'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  REALTIME_TOPICS,
  realtimeInvalidationMessageSchema,
  type RealtimeTopic,
} from '@authorization/contracts';
import { useRole } from '@/components/layout/role-context';
import { API_BASE_URL } from '@/lib/config';
import { SESSION_EXPIRED_EVENT, clearSession, getAccessToken } from '@/lib/auth';

export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting';
type Revisions = Record<RealtimeTopic, number>;

type RealtimeContextValue = Readonly<{
  status: RealtimeConnectionStatus;
  revisions: Revisions;
}>;

const EMPTY_REVISIONS = Object.fromEntries(
  REALTIME_TOPICS.map((topic) => [topic, 0]),
) as Revisions;

const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'idle',
  revisions: EMPTY_REVISIONS,
});

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

type ParsedSseEvent = Readonly<{ event: string; data: string }>;

export function parseSseBlock(block: string): ParsedSseEvent | null {
  let event = 'message';
  const data: string[] = [];

  for (const rawLine of block.replace(/\r\n/g, '\n').split('\n')) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    if (rawLine.startsWith('event:')) event = rawLine.slice(6).trim();
    if (rawLine.startsWith('data:')) data.push(rawLine.slice(5).trimStart());
  }

  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

async function consumeSse(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: ParsedSseEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('REALTIME_STREAM_BODY_UNAVAILABLE');

  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseBlock(block);
      if (parsed) onEvent(parsed);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, organizationId } = useRole();
  const [status, setStatus] = useState<RealtimeConnectionStatus>('idle');
  const [revisions, setRevisions] = useState<Revisions>(EMPTY_REVISIONS);
  const seenIds = useRef<string[]>([]);
  const seenIdSet = useRef(new Set<string>());
  const pendingTopics = useRef(new Set<RealtimeTopic>());
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !organizationId) {
      setStatus('idle');
      return;
    }

    const lifecycle = new AbortController();
    let streamAbort: AbortController | null = null;
    let reconnectAttempt = 0;

    const flushPending = (): void => {
      flushTimer.current = null;
      if (pendingTopics.current.size === 0) return;

      const topics = [...pendingTopics.current];
      pendingTopics.current.clear();

      setRevisions((current) => {
        const next = { ...current };
        for (const topic of topics) {
          next[topic] = (next[topic] ?? 0) + 1;
        }
        return next;
      });
    };

    const invalidate = (topics: readonly RealtimeTopic[]): void => {
      for (const topic of topics) pendingTopics.current.add(topic);
      if (flushTimer.current !== null) return;
      flushTimer.current = window.setTimeout(flushPending, 120);
    };

    const rememberEvent = (eventId: string): boolean => {
      if (seenIdSet.current.has(eventId)) return false;
      seenIdSet.current.add(eventId);
      seenIds.current.push(eventId);

      while (seenIds.current.length > 500) {
        const removed = seenIds.current.shift();
        if (removed) seenIdSet.current.delete(removed);
      }

      return true;
    };

    const connect = async (): Promise<void> => {
      while (!lifecycle.signal.aborted) {
        const token = getAccessToken();
        if (!token) {
          setStatus('idle');
          return;
        }

        setStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
        streamAbort = new AbortController();

        try {
          const response = await fetch(`${API_BASE_URL}/realtime/stream`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
              'X-Organization-Id': organizationId,
              Accept: 'text/event-stream',
            },
            cache: 'no-store',
            signal: streamAbort.signal,
          });

          if (response.status === 401) {
            clearSession();
            window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
            setStatus('idle');
            return;
          }

          if (!response.ok || !response.body) {
            throw new Error(`REALTIME_STREAM_HTTP_${response.status}`);
          }

          await consumeSse(response, streamAbort.signal, (event) => {
            if (event.event === 'ready') {
              reconnectAttempt = 0;
              setStatus('connected');
              // Initial connection and every reconnection reconcile all mounted read models.
              invalidate(REALTIME_TOPICS);
              return;
            }

            if (event.event !== 'invalidate') return;

            let json: unknown;
            try {
              json = JSON.parse(event.data) as unknown;
            } catch {
              return;
            }

            const parsed = realtimeInvalidationMessageSchema.safeParse(json);
            if (!parsed.success) return;
            if (parsed.data.organizationId !== organizationId) return;
            if (!rememberEvent(parsed.data.eventId)) return;

            invalidate(parsed.data.topics);
          });

          if (!lifecycle.signal.aborted) throw new Error('REALTIME_STREAM_CLOSED');
        } catch (error) {
          if (lifecycle.signal.aborted) return;
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }

        setStatus('reconnecting');
        reconnectAttempt = Math.min(reconnectAttempt + 1, 5);

        try {
          await delay(Math.min(1_000 * 2 ** (reconnectAttempt - 1), 15_000), lifecycle.signal);
        } catch {
          return;
        }
      }
    };

    void connect();

    return () => {
      lifecycle.abort();
      streamAbort?.abort();
      if (flushTimer.current !== null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      pendingTopics.current.clear();
    };
  }, [authStatus, organizationId]);

  const value = useMemo<RealtimeContextValue>(() => ({ status, revisions }), [status, revisions]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): RealtimeConnectionStatus {
  return useContext(RealtimeContext).status;
}

export function useRealtimeRevision(topics: readonly RealtimeTopic[]): number {
  const { revisions } = useContext(RealtimeContext);
  return topics.reduce((total, topic) => total + revisions[topic], 0);
}
