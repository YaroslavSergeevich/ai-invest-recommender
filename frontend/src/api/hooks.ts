import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { feed, push } from './endpoints';
import { ApiError, operationStatus } from './client';
import { useAppContext } from '../context/SessionContext';
import { uuid } from '../telemetry/ids';
import { finishOp, startOp } from '../telemetry/tracker';
import type { Feed, Push } from './types';

function useResource<T extends { request_id: string; delivery_id: string }>(
  name: 'feed' | 'notification',
  queryFn: (op: string, signal: AbortSignal) => Promise<T>,
  key: string[],
  enabled: boolean,
) {
  const operation = useRef<string | null>(null);
  const query = useQuery({
    queryKey: [name, ...key],
    enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const opId = uuid();
      operation.current = opId;
      startOp(name, opId);
      try {
        return { value: await queryFn(opId, signal), operationId: opId };
      } catch (cause) {
        if (signal.aborted) finishOp(opId, 'cancelled');
        throw cause;
      }
    },
  });
  useEffect(() => {
    if (query.isFetching) return;
    if (query.data && operation.current === query.data.operationId) {
      const value = query.data.value;
      finishOp(
        query.data.operationId,
        ('status' in value && value.status === 'empty') ||
          ('push_flag' in value && !value.push_flag)
          ? 'empty'
          : 'success',
        { request_id: value.request_id, delivery_id: value.delivery_id },
      );
      operation.current = null;
    } else if (query.error && operation.current) {
      finishOp(operation.current, operationStatus(query.error), {
        error_code: query.error instanceof ApiError ? query.error.code : 'UI_ERROR',
        request_id: query.error instanceof ApiError ? query.error.requestId : null,
      });
      operation.current = null;
    }
  }, [query.isFetching, query.data, query.error]);
  return { ...query, data: query.data?.value, operationId: query.data?.operationId };
}
export function useFeed() {
  return useResource<Feed>('feed', feed, ['demo'], true);
}
export function usePush() {
  const { dev, legacyUserId } = useAppContext();
  const userId = dev ? legacyUserId : 'demo-user';
  return useResource<Push>(
    'notification',
    (op, signal) => push(userId, op, signal),
    ['demo', String(userId)],
    true,
  );
}
