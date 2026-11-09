import type { Feed, News, Push } from '../src/api/types';

export const news: News = {
  news_id: 'news-server-42',
  recommendation_id: 'rec-server-91',
  position: 7,
  title: 'Заголовок от сервера',
  news_text: 'Новость от сервера. Продолжение новости.',
  interpretation: 'Трактовка от сервера.',
  recommendation: 'Рекомендуемый шаг от сервера.',
  published_at: null,
  published_at_status: 'unknown',
  sources: [
    { source_id: 'source-server', title: 'Официальный источник', url: 'https://www.cbr.ru/' },
  ],
};

export const readyFeed: Feed = {
  request_id: 'request-feed',
  operation_id: 'operation-feed',
  delivery_id: 'delivery-feed',
  status: 'ready',
  versions: {},
  items: [news],
};

export const notification: Push = {
  request_id: 'request-push',
  operation_id: 'operation-push',
  delivery_id: 'delivery-push',
  notification_id: 'notification-server',
  push_flag: true,
  text: 'Точный текст сервера: «Подробнее».',
  event_y: 'event',
  action_x: 'action',
  conditions: [],
  news_ids: [news.news_id],
  versions: {},
};
