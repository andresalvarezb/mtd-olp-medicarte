import { describe, expect, it } from 'vitest';
import { parseSseBlock } from './realtime-context';

describe('realtime SSE parser', () => {
  it('parses invalidate events', () => {
    expect(
      parseSseBlock('id: 1\nevent: invalidate\ndata: {"topics":["DASHBOARD"]}'),
    ).toEqual({
      event: 'invalidate',
      data: '{"topics":["DASHBOARD"]}',
    });
  });

  it('ignores heartbeat-only blocks', () => {
    expect(parseSseBlock(': heartbeat 123')).toBeNull();
  });
});
