import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/api/client', () => ({ request: vi.fn() }));
import { request } from '../src/api/client';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.useFakeTimers();
  vi.mocked(request).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const ack = { accepted_ids: [], duplicate_ids: [], rejected: [] };

describe('telemetry ACK transport', () => {
  it('keeps event and operation IDs stable until ACK, and respects backoff', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('offline'));
    const tracker = await import('../src/telemetry/tracker');
    const id = tracker.track('content_interacted', { interaction: 'news_open' });
    await tracker.flush();
    expect(tracker.telemetrySnapshot()[0].event_id).toBe(id);
    const operationId = vi.mocked(request).mock.calls[0][1];
    await tracker.flush();
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    vi.mocked(request).mockResolvedValueOnce({ ...ack, accepted_ids: [id] });
    await tracker.flush();
    expect(vi.mocked(request).mock.calls[1][1]).toBe(operationId);
    expect(tracker.telemetrySnapshot()).toHaveLength(0);
  });
  it('removes duplicates, retries retryable rejections, quarantines permanent ones', async () => {
    const tracker = await import('../src/telemetry/tracker');
    const ids = [1, 2, 3].map(() => tracker.track('content_interacted', {}));
    vi.mocked(request).mockResolvedValue({
      accepted_ids: [],
      duplicate_ids: [ids[0]],
      rejected: [
        { event_id: ids[1], code: 'BUSY', retryable: true },
        { event_id: ids[2], code: 'BAD_SCHEMA', retryable: false },
      ],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await tracker.flush();
    expect(tracker.telemetrySnapshot().map((event) => event.event_id)).toEqual([ids[1]]);
    expect(JSON.parse(localStorage.getItem('alpha.telemetry.quarantine.v1')!)).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });
  it('keeps unacknowledged events during page exit and requests keepalive', async () => {
    vi.mocked(request).mockReturnValue(new Promise(() => {}));
    const tracker = await import('../src/telemetry/tracker');
    const id = tracker.track('content_interacted', {});
    tracker.flushOnExit();
    expect(vi.mocked(request).mock.calls[0][4]).toEqual({ keepalive: true });
    expect(JSON.parse(localStorage.getItem('alpha.telemetry.queue.v1')!)[0].event.event_id).toBe(
      id,
    );
  });
  it('limits a UTF-8 batch to 48 KiB and fifty events', async () => {
    vi.mocked(request).mockReturnValue(new Promise(() => {}));
    const tracker = await import('../src/telemetry/tracker');
    for (let index = 0; index < 50; index++)
      tracker.track('feedback_submitted', { answers: Array(16).fill('я'.repeat(400)) });
    const body = vi.mocked(request).mock.calls[0][2] as { events: unknown[] };
    expect(body.events.length).toBeLessThanOrEqual(50);
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(
      48 * 1024,
    );
    expect(tracker.telemetrySnapshot().length).toBe(50);
  });
  it('restores pending events on reload and drops events older than 24 hours', async () => {
    const tracker = await import('../src/telemetry/tracker');
    const id = tracker.track('content_interacted', {});
    const saved = JSON.parse(localStorage.getItem('alpha.telemetry.queue.v1')!);
    saved.push({
      ...saved[0],
      event: {
        ...saved[0].event,
        event_id: 'expired',
        client_timestamp: new Date(Date.now() - 25 * 3600000).toISOString(),
      },
    });
    localStorage.setItem('alpha.telemetry.queue.v1', JSON.stringify(saved));
    vi.resetModules();
    const reloaded = await import('../src/telemetry/tracker');
    expect(reloaded.telemetrySnapshot().map((event) => event.event_id)).toEqual([id]);
  });
  it('completes an operation exactly once and emits the required envelope', async () => {
    const tracker = await import('../src/telemetry/tracker');
    tracker.startOp('feed', 'operation-test');
    vi.advanceTimersByTime(350);
    tracker.finishOp('operation-test', 'empty');
    tracker.finishOp('operation-test', 'success');
    const events = tracker.telemetrySnapshot();
    expect(events).toHaveLength(2);
    expect(events[1].payload).toMatchObject({ status: 'empty', elapsed_ms: 350 });
    expect(events[0]).toMatchObject({
      schema_version: 'events-v1',
      event_code: 'E15',
      emitter: 'frontend',
      actor_kind: 'human',
      server_timestamp: null,
      run_id: null,
      persona_id: null,
      company_id: null,
    });
    expect(events[0].client_seq).toBe(1);
    expect(events[1].client_seq).toBe(2);
    expect(events[0].versions.frontend).toBeTruthy();
  });
  it('creates a visit on route and BFCache, and never on focus alone', async () => {
    const tracker = await import('../src/telemetry/tracker');
    tracker.initTracker();
    tracker.visitPage('recommendations', 'initial', 'home');
    const first = tracker.getPageViewId();
    tracker.visitPage('recommendations', 'route', 'feed');
    const second = tracker.getPageViewId();
    expect(second).not.toBe(first);
    window.dispatchEvent(new Event('focus'));
    expect(tracker.getPageViewId()).toBe(second);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(tracker.getPageViewId()).not.toBe(second);
    expect(tracker.telemetrySnapshot().filter((event) => event.event_code === 'E03')).toHaveLength(
      3,
    );
  });
});
