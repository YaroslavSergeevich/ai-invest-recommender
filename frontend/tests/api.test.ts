import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.stubEnv('VITE_USE_MOCK', 'auto');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('API contracts', () => {
  it('includes correlation headers on every request, including GET health', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ status: 'ok' }));
    vi.stubGlobal('fetch', fetcher);
    const { request } = await import('../src/api/client');
    const { getIdentity } = await import('../src/telemetry/ids');
    await request('/health', 'user-operation');
    expect(fetcher).toHaveBeenCalledWith(
      '/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Session-ID': getIdentity().session_id,
          'X-Journey-ID': getIdentity().journey_id,
          'X-Operation-ID': 'user-operation',
        }),
      }),
    );
  });
  it('falls back for a missing route and visibly marks mock mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: { code: 'NOT_FOUND' } }, 404)),
    );
    const { request, mockSnapshot } = await import('../src/api/client');
    const result = await request<{ status: string }>('/api/feed', 'operation', {});
    expect(result.status).toBe('ready');
    expect(mockSnapshot()).toBe(true);
  });
  it('does not mask actual backend HTTP 500 or authorization failures with mock success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ error: { code: 'INTERNAL_ERROR' } }, 500))
        .mockResolvedValueOnce(response({ error: { code: 'UNAUTHORIZED' } }, 401)),
    );
    const { request, mockSnapshot } = await import('../src/api/client');
    await expect(request('/api/feed', 'one', {})).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });
    await expect(request('/api/feed', 'two', {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(mockSnapshot()).toBe(false);
  });
  it('handles a dev proxy connection failure as network fallback for feed, but chat returns mock', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ error: { code: 'PROXY_NETWORK_ERROR' } }, 502))
        .mockResolvedValueOnce(response({ error: { code: 'PROXY_NETWORK_ERROR' } }, 502)),
    );
    const { request } = await import('../src/api/client');
    // Feed falls back to mock
    expect(await request('/api/feed', 'one', {})).toMatchObject({
      status: 'ready',
      items: expect.any(Array),
    });
    // Chat also falls back to mock (not NETWORK_ERROR)
    expect(await request('/api/chat', 'two', { user_id: 'demo', query: 'test' })).toMatchObject({
      text: expect.stringContaining('AI-ответ'),
    });
  });
  it('ends a stalled request at 15 seconds without mock success', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const { request } = await import('../src/api/client');
    const promise = request('/api/feed', 'op', {});
    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
  it('forwards agent run_id via X-Run-ID header for agent mode', async () => {
    window.history.replaceState(
      {},
      '',
      '/?agent=true&run_id=run-test&persona_id=persona-test&seed=9',
    );
    const fetcher = vi.fn().mockResolvedValue(response({ text: 'response' }));
    vi.stubGlobal('fetch', fetcher);
    const { chat } = await import('../src/api/endpoints');
    await chat('demo-user', 'test query', 'agent-operation');
    const options = fetcher.mock.calls[0][1];
    expect(options.headers['X-Run-ID']).toBe('run-test');
    // Only X-Run-ID is sent as extra header, not X-Persona-ID
    expect(options.headers['X-Persona-ID']).toBeUndefined();
    // Body contains only user_id and query, not seed
    expect(JSON.parse(options.body)).toMatchObject({
      user_id: 'demo-user',
      query: 'test query',
    });
  });
  it('preserves identity across reload but rotates it after inactivity expires', async () => {
    const ids = await import('../src/telemetry/ids');
    const before = ids.getIdentity();
    vi.resetModules();
    const reloaded = await import('../src/telemetry/ids');
    expect(reloaded.getIdentity().session_id).toBe(before.session_id);
    reloaded.setIdentity({
      ...reloaded.getIdentity(),
      last_active: Date.now() - reloaded.SESSION_TTL - 1,
    });
    reloaded.touchSession();
    expect(reloaded.getIdentity().session_id).not.toBe(before.session_id);
  });
});
