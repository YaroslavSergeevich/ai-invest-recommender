import { ApiError, request } from './client';
import type { ActionBody, Feed, FeedbackBody, Push } from './types';

export const push = async (userId: string | number, operationId: string, signal?: AbortSignal) => {
  const result = await request<Push>(
    `/api/push?user_id=${encodeURIComponent(userId)}`,
    operationId,
    undefined,
    signal,
  );
  if (
    !result ||
    typeof result.push_flag !== 'boolean' ||
    typeof result.delivery_id !== 'string' ||
    (result.text !== null && typeof result.text !== 'string')
  )
    throw new ApiError('INVALID_RESPONSE', 'Некорректный ответ сервера', 502);
  return result;
};

export const feed = async (operationId: string, signal?: AbortSignal) => {
  const result = await request<Feed>(
    '/api/feed',
    operationId,
    { operation_id: operationId },
    signal,
  );
  if (
    !result ||
    !['ready', 'empty'].includes(result.status) ||
    !Array.isArray(result.items) ||
    typeof result.delivery_id !== 'string' ||
    (result.status === 'empty' && result.items.length > 0) ||
    result.items.some(
      (item) =>
        !item ||
        !Number.isInteger(item.position) ||
        item.position < 1 ||
        [
          'news_id',
          'recommendation_id',
          'title',
          'news_text',
          'interpretation',
          'recommendation',
        ].some((key) => typeof item[key as keyof typeof item] !== 'string') ||
        !Array.isArray(item.sources) ||
        item.sources.some(
          (source) =>
            typeof source.source_id !== 'string' ||
            typeof source.title !== 'string' ||
            typeof source.url !== 'string',
        ),
    )
  )
    throw new ApiError('INVALID_RESPONSE', 'Некорректный ответ сервера', 502);
  return result;
};

export const action = (body: ActionBody, operationId: string) =>
  request<{ request_id: string }>('/api/recommendation-actions', operationId, body);

export const feedback = (body: FeedbackBody, operationId: string) =>
  request<{ request_id: string }>('/api/feedback', operationId, body);

export const chat = (
  userId: string | number,
  query: string,
  operationId: string,
  signal?: AbortSignal,
) => request<{ text: string }>('/api/chat', operationId, { user_id: userId, query }, signal);
