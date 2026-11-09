import { requestHeaders } from '../telemetry/ids';
import { mockRequest, supportsMock } from './mock';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
    public retryable = false,
    public requestId: string | null = null,
  ) {
    super(message);
  }
}
export const apiBase = import.meta.env.VITE_API_BASE || '';
const mockMode = import.meta.env.VITE_USE_MOCK || 'auto';
let mockActive = false;
const listeners = new Set<() => void>();
export const mockSnapshot = () => mockActive;
export const subscribeMock = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function activateMock() {
  if (!mockActive) {
    mockActive = true;
    listeners.forEach((fn) => fn());
  }
}
export function operationStatus(error: unknown) {
  if (error instanceof ApiError)
    return error.code === 'TIMEOUT'
      ? 'timeout'
      : error.code === 'CANCELLED'
        ? 'cancelled'
        : error.status
          ? 'http_error'
          : 'network_error';
  return 'ui_error';
}
export async function request<T>(
  path: string,
  operationId: string,
  body?: unknown,
  signal?: AbortSignal,
  options: { keepalive?: boolean } = {},
): Promise<T> {
  const canMock = supportsMock(path);
  if (mockMode === 'true' && canMock && !path.startsWith('/api/push')) {
    activateMock();
    return mockRequest(path, body, operationId) as Promise<T>;
  }
  const abort = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, 15000);
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: requestHeaders(operationId),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
      keepalive: options.keepalive,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new ApiError(
        detail.error?.code || 'HTTP_ERROR',
        detail.error?.message || 'Сервис недоступен, попробуйте позже',
        response.status,
        detail.error?.retryable ?? response.status >= 500,
        detail.error?.request_id ?? null,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (timedOut) throw new ApiError('TIMEOUT', 'Время ожидания истекло', 0, true);
    if (signal?.aborted) throw new ApiError('CANCELLED', 'Запрос отменён');
    if (
      mockMode !== 'false' &&
      canMock &&
      ((error instanceof ApiError &&
        (error.status === 404 || error.code === 'PROXY_NETWORK_ERROR')) ||
        error instanceof TypeError)
    ) {
      activateMock();
      return mockRequest(path, body, operationId) as Promise<T>;
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK_ERROR', 'Сервис недоступен, попробуйте позже', 0, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
