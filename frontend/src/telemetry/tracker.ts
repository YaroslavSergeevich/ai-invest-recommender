import { request } from '../api/client';
import type { Ack } from '../api/types';
import { getIdentity, readStorage, uuid, writeStorage } from './ids';

const codes = {
  account_entry_requested: 'E01',
  page_visited: 'E03',
  notification_impression: 'E04',
  notification_details_clicked: 'E05',
  feed_rendered: 'E07',
  content_impression: 'E08',
  content_engagement: 'E09',
  content_interacted: 'E10',
  recommendation_action: 'E11',
  page_lifecycle: 'E12',
  feedback_submitted: 'E13',
  ui_operation: 'E15',
} as const;
type EventName = keyof typeof codes;
export type Step =
  | 'entry'
  | 'recommendations'
  | 'settings'
  | 'feed'
  | 'news'
  | 'recommendation'
  | 'feedback'
  | 'exit';
export type TelemetryEvent = {
  schema_version: 'events-v1';
  event_id: string;
  event_name: EventName;
  event_code: string;
  session_id: string;
  run_id: string | null;
  user_id: string | null;
  persona_id: string | null;
  company_id: string | number | null;
  assignment_id: string | null;
  journey_id: string;
  page_view_id: string;
  client_timestamp: string;
  server_timestamp: null;
  client_seq: number;
  client_elapsed_ms: number;
  step: Step;
  actor_kind: 'agent' | 'human';
  emitter: 'frontend';
  environment: string;
  versions: Record<string, string | null>;
  payload: Record<string, unknown>;
};
type Queued = { event: TelemetryEvent; attempts: number; nextAt: number; transportOp?: string };
const QUEUE_KEY = 'alpha.telemetry.queue.v1';
const QUARANTINE_KEY = 'alpha.telemetry.quarantine.v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_BYTES = 48 * 1024;
const encoder = new TextEncoder();
let queue = readStorage<Queued[]>(QUEUE_KEY, [])
  .filter(
    (item) =>
      item.event?.event_id && Date.now() - Date.parse(item.event.client_timestamp) < MAX_AGE,
  )
  .slice(-500);
let pageViewId = uuid();
let seq = 0;
let step: Step = 'entry';
let activeSince: number | null =
  document.visibilityState === 'visible' && document.hasFocus() ? performance.now() : null;
let activeTotal = 0;
let sending = false;
let currentPage: 'recommendations' | 'settings' | 'feed' | 'news' = 'recommendations';
let routeStarted = false;
let currentLocationKey: string | null = null;
const clockListeners = new Set<(reason: string) => void>();
const pageListeners = new Set<() => void>();
const operations = new Map<string, { operation: string; started: number }>();
export const getPageViewId = () => pageViewId;
export const getStep = () => step;
export const setStep = (value: Step) => {
  step = value;
};
export const subscribePageView = (fn: () => void) => {
  pageListeners.add(fn);
  return () => {
    pageListeners.delete(fn);
  };
};
export const subscribeClock = (fn: (reason: string) => void) => {
  clockListeners.add(fn);
  return () => {
    clockListeners.delete(fn);
  };
};
export const isActive = () =>
  document.visibilityState === 'visible' &&
  document.hasFocus() &&
  !document.querySelector('[aria-modal="true"], [data-telemetry-overlay="true"]');
function persist() {
  queue = queue
    .filter((item) => Date.now() - Date.parse(item.event.client_timestamp) < MAX_AGE)
    .slice(-500);
  writeStorage(QUEUE_KEY, queue);
}
function quarantine(item: Queued, code: string) {
  const stored = readStorage<unknown[]>(QUARANTINE_KEY, []);
  writeStorage(QUARANTINE_KEY, [...stored, { ...item, code }].slice(-100));
  console.warn('Telemetry event quarantined', item.event.event_id, code);
}
function truncate(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.map(truncate);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncate(item)]));
  return value;
}
export function track(name: EventName, payload: Record<string, unknown>, eventId = uuid()): string {
  const i = getIdentity();
  const environment = import.meta.env.VITE_ENVIRONMENT || 'local';
  const event: TelemetryEvent = {
    schema_version: 'events-v1',
    event_id: eventId,
    event_name: name,
    event_code: codes[name],
    session_id: i.session_id,
    run_id: i.run_id,
    user_id: i.user_id,
    persona_id: i.persona_id,
    company_id: null,
    assignment_id: null,
    journey_id: i.journey_id,
    page_view_id: pageViewId,
    client_timestamp: new Date().toISOString(),
    server_timestamp: null,
    client_seq: ++seq,
    client_elapsed_ms: Math.round(performance.now()),
    step,
    actor_kind: i.actor_kind,
    emitter: 'frontend',
    environment: ['local', 'integration', 'production'].includes(environment)
      ? environment
      : 'local',
    versions: {
      backend: null,
      analyser: null,
      model_a: null,
      model_b: null,
      profile: null,
      frontend: import.meta.env.VITE_FRONTEND_VERSION || '1.0.0',
    },
    payload: truncate(payload) as Record<string, unknown>,
  };
  queue.push({ event, attempts: 0, nextAt: 0 });
  persist();
  if (
    queue.length >= 50 ||
    encoder.encode(
      JSON.stringify({ schema_version: 'events-v1', events: queue.map((item) => item.event) }),
    ).byteLength >= MAX_BYTES
  )
    void flush();
  return eventId;
}
export function startOp(operation: string, opId: string) {
  if (operations.has(opId)) return;
  operations.set(opId, { operation, started: performance.now() });
  track('ui_operation', {
    operation_id: opId,
    operation,
    state: 'start',
    status: 'pending',
    elapsed_ms: null,
    request_id: null,
    delivery_id: null,
    error_code: null,
  });
}
export function finishOp(opId: string, status: string, details: Record<string, unknown> = {}) {
  const op = operations.get(opId);
  if (!op) return;
  operations.delete(opId);
  track('ui_operation', {
    operation_id: opId,
    operation: op.operation,
    state: 'finish',
    status,
    elapsed_ms: Math.round(performance.now() - op.started),
    request_id: null,
    delivery_id: null,
    error_code: null,
    ...details,
  });
}
export async function flush(keepalive = false) {
  persist();
  if (sending || !queue.length) return;
  sending = true;
  const batch: Queued[] = [];
  let operationId: string | undefined;
  for (const item of queue) {
    if (item.nextAt > Date.now()) continue;
    if (operationId && item.transportOp && item.transportOp !== operationId) continue;
    const candidate = {
      schema_version: 'events-v1',
      events: [...batch, item].map((entry) => entry.event),
    };
    if (encoder.encode(JSON.stringify(candidate)).byteLength > MAX_BYTES) {
      if (!batch.length) {
        quarantine(item, 'EVENT_TOO_LARGE');
        queue = queue.filter((entry) => entry !== item);
      }
      break;
    }
    operationId ??= item.transportOp ?? uuid();
    item.transportOp = operationId;
    batch.push(item);
    if (batch.length === 50) break;
  }
  if (!batch.length) {
    sending = false;
    persist();
    return;
  }
  try {
    persist();
    const ack = await request<Ack>(
      '/api/telemetry/events',
      operationId!,
      {
        schema_version: 'events-v1',
        events: batch.map((item) => item.event),
      },
      undefined,
      { keepalive },
    );
    if (
      !Array.isArray(ack.accepted_ids) ||
      !Array.isArray(ack.duplicate_ids) ||
      !Array.isArray(ack.rejected)
    )
      throw new Error('Invalid telemetry ACK');
    const sent = new Set(batch.map((item) => item.event.event_id));
    const removed = new Set(
      [...ack.accepted_ids, ...ack.duplicate_ids].filter((id) => sent.has(id)),
    );
    for (const rejection of ack.rejected) {
      if (!rejection.retryable && sent.has(rejection.event_id)) {
        const item = batch.find((entry) => entry.event.event_id === rejection.event_id);
        if (item) quarantine(item, rejection.code);
        removed.add(rejection.event_id);
      }
    }
    queue = queue.filter((item) => !removed.has(item.event.event_id));
  } catch {
    /* Collector availability never changes UI state. */
  } finally {
    for (const item of batch) {
      if (queue.includes(item)) {
        item.attempts++;
        item.nextAt = Date.now() + Math.min(60000, 1000 * 2 ** Math.min(item.attempts, 6));
      }
    }
    persist();
    sending = false;
  }
}
// Fetch keepalive supports the required custom headers; Beacon does not.
export function flushOnExit() {
  persist();
  void flush(true);
}
function updateActiveClock() {
  const now = performance.now();
  if (activeSince !== null) activeTotal += now - activeSince;
  activeSince = isActive() ? now : null;
}
function lifecycle(state: string, persisted = false) {
  updateActiveClock();
  track('page_lifecycle', {
    page_view_id: pageViewId,
    state,
    last_step: step,
    elapsed_active_ms: Math.round(activeTotal),
    persisted,
  });
}
export function visitPage(
  page: 'recommendations' | 'settings' | 'feed' | 'news',
  navigationKind: string,
  locationKey: string,
) {
  if (currentLocationKey === locationKey && navigationKind !== 'bfcache') return;
  const previous = routeStarted ? pageViewId : null;
  if (routeStarted) {
    clockListeners.forEach((fn) => fn('route_exit'));
    lifecycle('route_exit');
  }
  pageViewId = uuid();
  seq = 0;
  activeTotal = 0;
  activeSince = isActive() ? performance.now() : null;
  currentPage = page;
  currentLocationKey = locationKey;
  routeStarted = true;
  step = page;
  pageListeners.forEach((fn) => fn());
  track('page_visited', {
    page_view_id: pageViewId,
    page,
    navigation_kind: navigationKind,
    previous_page_view_id: previous,
  });
}
let initialized = false;
export function initTracker() {
  if (initialized) return;
  initialized = true;
  setInterval(() => void flush(), 2000);
  let visible = document.visibilityState;
  let focused = document.hasFocus();
  document.addEventListener('visibilitychange', () => {
    if (visible === document.visibilityState) return;
    visible = document.visibilityState;
    clockListeners.forEach((fn) => fn(visible === 'hidden' ? 'hidden' : 'visible'));
    lifecycle(visible === 'hidden' ? 'hidden' : 'visible');
    if (visible === 'hidden') flushOnExit();
  });
  for (const name of ['focus', 'blur'] as const)
    window.addEventListener(name, () => {
      const next = name === 'focus';
      if (focused === next) return;
      focused = next;
      clockListeners.forEach((fn) => fn(name === 'blur' ? 'hidden' : 'visible'));
      lifecycle(name);
    });
  window.addEventListener('pagehide', (event) => {
    clockListeners.forEach((fn) => fn('pagehide'));
    lifecycle('pagehide', event.persisted);
    activeSince = null;
    flushOnExit();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted)
      visitPage(currentPage, 'bfcache', `${currentLocationKey}:bfcache:${uuid()}`);
  });
}
export const telemetrySnapshot = () => queue.map((item) => item.event);
