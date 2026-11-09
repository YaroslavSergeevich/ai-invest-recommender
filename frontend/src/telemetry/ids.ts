export const uuid = () => crypto.randomUUID();
export function parseAssignmentSeed(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!raw.trim() || !Number.isSafeInteger(value)) {
    throw new Error('Параметр seed должен быть непустым безопасным целым числом');
  }
  return value;
}
const KEY = 'alpha.session.v1';
export const SESSION_TTL = 30 * 60 * 1000;
export type Identity = {
  session_id: string;
  journey_id: string;
  user_id: string | null;
  actor_kind: 'agent' | 'human';
  run_id: string | null;
  persona_id: string | null;
  seed: string | null;
  last_active: number;
};
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStorage(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* Storage is best effort. */
  }
}
function createIdentity(): Identity {
  const q = new URLSearchParams(location.search);
  const agent = q.get('agent') === 'true';
  return {
    session_id: uuid(),
    journey_id: uuid(),
    user_id: agent ? null : `user_${uuid()}`,
    actor_kind: agent ? 'agent' : 'human',
    run_id: agent ? q.get('run_id') : null,
    persona_id: agent ? q.get('persona_id') : null,
    seed: agent ? q.get('seed') : null,
    last_active: Date.now(),
  };
}
const stored = readStorage<Identity | null>(KEY, null);
const query = new URLSearchParams(location.search);
const contextChanged =
  query.has('agent') &&
  ((query.get('agent') === 'true' ? 'agent' : 'human') !== stored?.actor_kind ||
    (query.get('agent') === 'true' &&
      ['run_id', 'persona_id', 'seed'].some((key) => {
        return query.get(key) !== stored?.[key as keyof Identity];
      })));
let identity: Identity =
  stored?.session_id && Date.now() - stored.last_active < SESSION_TTL && !contextChanged
    ? stored
    : createIdentity();
writeStorage(KEY, identity);
export const getIdentity = () => identity;
export function setIdentity(next: Identity) {
  identity = next;
  writeStorage(KEY, next);
}
export function touchSession() {
  if (Date.now() - identity.last_active >= SESSION_TTL) {
    setIdentity(createIdentity());
    window.dispatchEvent(new Event('alpha-session-expired'));
  } else {
    identity.last_active = Date.now();
    writeStorage(KEY, identity);
  }
}
export function requestHeaders(operationId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Session-ID': identity.session_id,
    'X-Journey-ID': identity.journey_id,
    'X-Operation-ID': operationId,
    ...(identity.actor_kind === 'agent' && identity.run_id ? { 'X-Run-ID': identity.run_id } : {}),
  };
}
