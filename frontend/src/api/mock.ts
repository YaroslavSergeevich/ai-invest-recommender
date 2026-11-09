import { uuid } from '../telemetry/ids';
import type { Feed, News } from './types';

export const supportsMock = (path: string) =>
  [
    '/api/feed',
    '/api/recommendation-actions',
    '/api/feedback',
    '/api/telemetry/events',
    '/api/chat',
  ].includes(path);

const articles: News[] = [
  {
    news_id: 'demo-news-101',
    recommendation_id: 'demo-rec-101',
    position: 1,
    title: 'AI-инвестиции: рост финансирования технологических стартапов',
    news_text:
      'Глобальные инвестиции в AI-стартапы достигли рекордных значений за квартал. Крупные фонды увеличивают ставки на генеративный ИИ и инфраструктурные решения.',
    interpretation:
      'Рост капиталовложений в AI-сектор сигнализирует о долгосрочном тренде. Компании, внедряющие ИИ в процессы, могут получить конкурентное преимущество.',
    recommendation:
      'Рассмотрите диверсификацию портфеля в сторону AI-тематики. Оцените фонды с фокусом на semiconducors, cloud и прикладной ИИ.',
    published_at: null,
    published_at_status: 'unknown',
    sources: [
      { source_id: 'demo-source-techcrunch', title: 'TechCrunch', url: 'https://techcrunch.com/' },
    ],
  },
  {
    news_id: 'demo-news-102',
    recommendation_id: 'demo-rec-102',
    position: 2,
    title: 'Ключевая ставка: влияние на облигационный рынок',
    news_text:
      'Центральные банки ведущих экономик сохраняют жесткую риторику по ставкам. Долгосрочные облигации демонстрируют повышенную волатильность доходности.',
    interpretation:
      'Среда высоких ставок благоприятствует краткосрочным инструментам и плавающим купоном. Длительные фиксированные доходные активы несут риск переоценки.',
    recommendation:
      'Пересмотрите duration портфеля. Рассмотрите увеличение доли краткосрочных облигаций и флатеров до стабилизации ставок.',
    published_at: null,
    published_at_status: 'unknown',
    sources: [
      {
        source_id: 'demo-source-bloomberg',
        title: 'Bloomberg',
        url: 'https://www.bloomberg.com/',
      },
    ],
  },
  {
    news_id: 'demo-news-103',
    recommendation_id: 'demo-rec-103',
    position: 3,
    title: 'Зелёная энергетика: новые пакеты стимулирования в ЕС и США',
    news_text:
      'Правительства крупнейших экономик анонсировали расширенные программы поддержки возобновляемой энергетики и энергоэффективности на 2025-2027 гг.',
    interpretation:
      'Политическая поддержка создаёт структурный попрос на зелёные технологии. Секторы солнечной, ветровой энергетики и сетей передачи получают долгосрочный хвостовой ветер.',
    recommendation:
      'Оцените экспозицию на чистую энергетику через тематические ETF или прямые позиции в лидерах отрасли.',
    published_at: null,
    published_at_status: 'unknown',
    sources: [{ source_id: 'demo-source-iea', title: 'IEA', url: 'https://www.iea.org/' }],
  },
];

export async function mockRequest(
  path: string,
  raw: unknown,
  operationId: string,
): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const body = (raw ?? {}) as Record<string, unknown>;
  const common = {
    request_id: uuid(),
    operation_id: operationId,
    versions: { backend: 'mock-v1', model: null, profile: null },
  };

  if (path === '/api/feed')
    return {
      ...common,
      delivery_id: `demo-feed-${Date.now()}`,
      status: 'ready',
      items: articles,
    } satisfies Feed;

  if (path === '/api/chat') {
    const userText = (body.query as string) || '';
    return {
      ...common,
      text: `AI-ответ на ваш запрос: "${userText.slice(0, 100)}". В демо-режиме это заглушка. Реальный ответ придёт от бэкенда через /api/chat.`,
    };
  }

  if (path === '/api/telemetry/events')
    return {
      accepted_ids: ((body.events ?? []) as { event_id: string }[]).map((event) => event.event_id),
      duplicate_ids: [],
      rejected: [],
    };

  return {
    ...common,
    status: 'ok',
    action_id: body.action_id,
    response_id: body.response_id,
    version: body.version,
  };
}
