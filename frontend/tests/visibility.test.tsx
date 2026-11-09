import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  clock: new Set<(reason: string) => void>(),
  pages: new Set<() => void>(),
  view: 'page-one',
}));
vi.mock('../src/telemetry/tracker', () => ({
  track: vi.fn(() => crypto.randomUUID()),
  getPageViewId: () => state.view,
  isActive: () =>
    document.visibilityState === 'visible' &&
    document.hasFocus() &&
    !document.querySelector('[aria-modal="true"]'),
  subscribeClock: (fn: (reason: string) => void) => {
    state.clock.add(fn);
    return () => state.clock.delete(fn);
  },
  subscribePageView: (fn: () => void) => {
    state.pages.add(fn);
    return () => state.pages.delete(fn);
  },
}));
import { track } from '../src/telemetry/tracker';
import { useExposure, measureVisibility } from '../src/telemetry/visibility';
const bounds = (height = 200, top = 0) => ({
  x: 0,
  y: top,
  left: 0,
  top,
  right: 300,
  bottom: top + height,
  width: 300,
  height,
  toJSON: () => ({}),
});
function Content({
  kind = 'news',
  id = crypto.randomUUID(),
}: {
  kind?: 'notification' | 'news';
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useExposure(ref, {
    kind,
    contentId: id,
    deliveryId: 'delivery',
    notificationId: id,
    newsId: id,
    position: 4,
    text: 'Один два три',
  });
  return (
    <div ref={ref}>
      <p data-reading-text>Один два три</p>
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(track).mockClear();
  state.view = crypto.randomUUID();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => bounds());
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('visibility-v1', () => {
  it('requires one continuous second, and deduplicates within a page view', () => {
    const id = crypto.randomUUID();
    const first = render(<Content kind="notification" id={id} />);
    act(() => vi.advanceTimersByTime(999));
    expect(track).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(101));
    expect(track).toHaveBeenCalledWith(
      'notification_impression',
      expect.objectContaining({
        visible_ms: expect.any(Number),
        notification_id: id,
        measurement_policy_version: 'visibility-v1',
      }),
    );
    first.unmount();
    render(<Content kind="notification" id={id} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name === 'notification_impression'),
    ).toHaveLength(1);
  });
  it('pauses immediately while hidden and never credits the hidden interval', () => {
    render(<Content />);
    act(() => vi.advanceTimersByTime(500));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => state.clock.forEach((fn) => fn('hidden')));
    act(() => vi.advanceTimersByTime(20000));
    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name === 'content_impression'),
    ).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => state.clock.forEach((fn) => fn('visible')));
    act(() => vi.advanceTimersByTime(600));
    expect(
      vi.mocked(track).mock.calls.filter(([name]) => name === 'content_impression'),
    ).toHaveLength(0);
    act(() => vi.advanceTimersByTime(500));
    const engagement = vi
      .mocked(track)
      .mock.calls.filter(([name]) => name === 'content_engagement');
    expect(engagement[0][1].active_visible_ms_total).toBe(500);
    expect(engagement[0][1].llm_wait_ms_total).toBe(0);
  });
  it('does not qualify without focus or behind a known overlay', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    render(<Content />);
    act(() => vi.advanceTimersByTime(2000));
    expect(track).not.toHaveBeenCalled();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    act(() => vi.advanceTimersByTime(2000));
    expect(track).not.toHaveBeenCalled();
    modal.remove();
  });
  it('normalizes oversized content against viewport area instead of element area', () => {
    const element = document.createElement('div');
    document.body.append(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      ...bounds(2000),
      width: innerWidth,
      right: innerWidth,
    });
    const result = measureVisibility(element);
    expect(result.visibleRatio).toBeLessThan(0.5);
    expect(result.viewportRatio).toBe(1);
    element.remove();
  });
  it('creates fresh impressions and exposure IDs after BFCache', () => {
    render(<Content id="same-content" />);
    act(() => vi.advanceTimersByTime(1100));
    const first = vi.mocked(track).mock.calls.find(([name]) => name === 'content_impression')![1]
      .exposure_id;
    act(() => state.clock.forEach((fn) => fn('pagehide')));
    state.view = 'bfcache-page';
    act(() => state.pages.forEach((fn) => fn()));
    act(() => vi.advanceTimersByTime(1100));
    const calls = vi.mocked(track).mock.calls.filter(([name]) => name === 'content_impression');
    expect(calls).toHaveLength(2);
    expect(calls[1][1].exposure_id).not.toBe(first);
  });
});
