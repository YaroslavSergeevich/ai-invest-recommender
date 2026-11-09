import { useEffect, useRef, type RefObject } from 'react';
import { getIdentity, uuid } from './ids';
import { getPageViewId, isActive, subscribeClock, subscribePageView, track } from './tracker';

type Content = {
  kind: 'notification' | 'news' | 'recommendation';
  contentId: string;
  deliveryId: string;
  notificationId?: string;
  newsId?: string;
  recommendationId?: string;
  position?: number;
  text?: string;
  expanded?: boolean;
};
export type AgentPhase = 'llm_wait' | 'modeled_read' | 'interaction' | 'idle';
declare global {
  interface Window {
    __agentTiming?: { setPhase: (phase: AgentPhase) => void };
  }
}
let phase: AgentPhase = 'idle';
const phaseListeners = new Set<() => void>();
export function installAgentTiming() {
  const i = getIdentity();
  if (i.actor_kind === 'agent' && i.run_id && i.persona_id)
    window.__agentTiming = {
      setPhase(next) {
        if (['llm_wait', 'modeled_read', 'interaction', 'idle'].includes(next)) {
          phaseListeners.forEach((fn) => fn());
          phase = next;
        }
      },
    };
  else delete window.__agentTiming;
}
const impressions = new Map<string, string>();
export function measureVisibility(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  let left = Math.max(0, rect.left),
    top = Math.max(0, rect.top);
  let right = Math.min(innerWidth, rect.right),
    bottom = Math.min(innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  const clipped = Math.max(0, right - left) * Math.max(0, bottom - top);
  const normalizedArea = Math.min(area, innerWidth * innerHeight);
  const style = getComputedStyle(element);
  const shown =
    style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  return {
    visibleRatio: area > 0 && shown ? clipped / area : 0,
    viewportRatio: normalizedArea > 0 && shown ? clipped / normalizedArea : 0,
    top,
    bottom,
    left,
    right,
    rect,
  };
}
export function useExposure(ref: RefObject<HTMLElement>, content: Content | null) {
  const impressionEvent = useRef<string | null>(null);
  const current = useRef(content);
  current.current = content;
  const key = content ? `${content.kind}:${content.deliveryId}:${content.contentId}` : '';
  useEffect(() => {
    const element = ref.current;
    const initialConfig = current.current;
    impressionEvent.current = null;
    if (!element || !initialConfig) return;
    const config: Content = initialConfig;
    let view = getPageViewId();
    let exposureId = uuid();
    let last = performance.now();
    let eligible = false;
    let continuous = 0,
      active = 0,
      modeled = 0,
      llm = 0;
    let checkpointSeq = 0,
      lastCheckpoint = 0,
      checkpointActive = -1;
    let maxScroll = 0;
    let stopped = false;
    const covered = new Set<number>();
    let coverageAt = -Infinity;
    const text = config.text || '';
    const wordCount = text.trim() ? text.trim().split(/\s+/u).length : 0;
    const dedupeKey = () => `${view}:${config.deliveryId}:${config.kind}:${config.contentId}`;
    impressionEvent.current = impressions.get(dedupeKey()) ?? null;
    function coverage() {
      return wordCount ? Math.min(1, covered.size / wordCount) : 0;
    }
    function sampleTextCoverage(now: number) {
      if (now - coverageAt < 300) return;
      coverageAt = now;
      let wordIndex = 0;
      for (const target of element!.querySelectorAll<HTMLElement>('[data-reading-text]')) {
        const clip = measureVisibility(target);
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const match of (node.textContent || '').matchAll(/\S+/gu)) {
            const index = wordIndex++;
            if (!clip.visibleRatio || covered.has(index)) continue;
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            if (typeof range.getBoundingClientRect !== 'function') continue;
            const bounds = range.getBoundingClientRect();
            const area = bounds.width * bounds.height;
            const intersection =
              Math.max(0, Math.min(clip.right, bounds.right) - Math.max(clip.left, bounds.left)) *
              Math.max(0, Math.min(clip.bottom, bounds.bottom) - Math.max(clip.top, bounds.top));
            if (area > 0 && intersection / area >= 0.5) covered.add(index);
          }
        }
      }
    }
    const common = () => ({
      exposure_id: exposureId,
      delivery_id: config.deliveryId,
      news_id: config.newsId ?? null,
      recommendation_id:
        config.kind === 'recommendation' ? (config.recommendationId ?? null) : null,
      content_type: config.kind,
      position: config.position ?? null,
    });
    function checkpoint(reason: string) {
      if (
        config.kind === 'notification' ||
        active <= 0 ||
        active === checkpointActive ||
        view !== getPageViewId()
      )
        return;
      checkpointActive = active;
      track('content_engagement', {
        ...common(),
        active_visible_ms_total: Math.round(active),
        modeled_read_ms_total: Math.round(modeled),
        llm_wait_ms_total: Math.round(llm),
        covered_text_fraction_total: Number(coverage().toFixed(4)),
        max_feed_scroll_fraction: maxScroll,
        word_count: wordCount,
        interaction_mode: current.current?.expanded ? 'expanded' : 'collapsed',
        checkpoint_seq: ++checkpointSeq,
        flush_reason: reason,
        pacing_policy_version:
          getIdentity().actor_kind === 'agent' && window.__agentTiming ? 'agent-timing-v1' : null,
        measurement_policy_version: 'visibility-v1',
      });
    }
    function tick(reason = 'timer') {
      if (stopped) return;
      const now = performance.now();
      const delta = Math.max(0, now - last);
      last = now;
      if (eligible) {
        active += delta;
        continuous += delta;
        if (getIdentity().actor_kind === 'agent') {
          if (phase === 'llm_wait') llm += delta;
          if (phase === 'modeled_read') modeled += delta;
        }
      }
      const m = measureVisibility(element!);
      const nextEligible = isActive() && m.viewportRatio >= 0.5;
      if (eligible && continuous >= 1000 && !impressions.has(dedupeKey())) {
        const visibility = {
          visible_ratio: m.visibleRatio,
          viewport_visible_ratio: m.viewportRatio,
          visible_ms: Math.round(continuous),
          measurement_policy_version: 'visibility-v1',
        };
        if (nextEligible) {
          const event =
            config.kind === 'notification'
              ? track('notification_impression', {
                  notification_id: config.notificationId,
                  delivery_id: config.deliveryId,
                  exposure_id: exposureId,
                  ...visibility,
                  is_document_visible: true,
                  is_focused: true,
                })
              : track('content_impression', { ...common(), ...visibility });
          impressions.set(dedupeKey(), event);
          impressionEvent.current = event;
          if (impressions.size > 2000) impressions.delete(impressions.keys().next().value!);
        }
      }
      if (nextEligible) {
        sampleTextCoverage(now);
        const scrollRange = document.documentElement.scrollHeight - innerHeight;
        maxScroll = Math.max(maxScroll, scrollRange > 0 ? Math.min(1, scrollY / scrollRange) : 0);
      }
      if (!nextEligible) {
        if (eligible)
          checkpoint(
            ['hidden', 'pagehide', 'route_exit'].includes(reason) ? reason : 'out_of_view',
          );
        continuous = 0;
      }
      eligible = nextEligible;
      if (active - lastCheckpoint >= 10000) {
        checkpoint('timer');
        lastCheckpoint = active;
      }
      if (['hidden', 'route_exit', 'pagehide'].includes(reason)) {
        checkpoint(reason);
        eligible = false;
        continuous = 0;
      }
    }
    function close(reason: string) {
      tick(reason);
      checkpoint(reason);
      stopped = true;
      eligible = false;
    }
    const unsubscribeClock = subscribeClock((reason) => {
      if (reason === 'route_exit' || reason === 'pagehide') close(reason);
      else tick(reason);
    });
    const unsubscribePage = subscribePageView(() => {
      // BFCache restoration keeps the same DOM but opens a fresh exposure.
      view = getPageViewId();
      exposureId = uuid();
      active = 0;
      continuous = 0;
      modeled = 0;
      llm = 0;
      last = performance.now();
      checkpointSeq = 0;
      lastCheckpoint = 0;
      checkpointActive = -1;
      maxScroll = 0;
      covered.clear();
      coverageAt = -Infinity;
      stopped = false;
      eligible = false;
      impressionEvent.current = null;
      tick();
    });
    const onPhase = () => tick();
    phaseListeners.add(onPhase);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(() => tick(), {
            threshold: Array.from({ length: 21 }, (_, i) => i / 20),
          });
    observer?.observe(element);
    const mutation = new MutationObserver(() => tick());
    mutation.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'data-telemetry-overlay', 'hidden'],
    });
    const onScroll = () => tick();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const interval = setInterval(tick, 100);
    tick();
    return () => {
      if (!stopped) close('route_exit');
      clearInterval(interval);
      observer?.disconnect();
      mutation.disconnect();
      unsubscribeClock();
      unsubscribePage();
      phaseListeners.delete(onPhase);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [key, ref]);
  return impressionEvent;
}
