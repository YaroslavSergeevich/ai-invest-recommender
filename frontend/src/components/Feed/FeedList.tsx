import { useEffect, useLayoutEffect, useRef } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { useFeed } from '../../api/hooks';
import type { Feed, RecommendationTarget } from '../../api/types';
import { track } from '../../telemetry/tracker';
import { uuid } from '../../telemetry/ids';
import { NewsCard } from './NewsCard';
import { Button } from '../UI/Button';
import { Skeleton } from '../UI/Skeleton';
import { useToast } from '../UI/Toast';

function CommittedFeed({
  data,
  operationId,
  onStudy,
  onEligible,
}: {
  data: Feed;
  operationId?: string;
  onStudy: (target: RecommendationTarget) => void;
  onEligible: (target: RecommendationTarget, eligible: boolean) => void;
}) {
  const rendered = useRef<string | null>(null);
  useEffect(() => {
    const key = `${operationId}:${data.delivery_id}`;
    if (rendered.current === key) return;
    rendered.current = key;
    track('feed_rendered', {
      operation_id: operationId ?? data.operation_id,
      delivery_id: data.delivery_id,
      render_id: uuid(),
      status: data.status,
      items: data.items.map(({ news_id, recommendation_id, position }) => ({
        news_id,
        recommendation_id,
        position,
      })),
      page_index: 1,
    });
  }, [data, operationId]);
  if (data.status === 'empty')
    return (
      <div className="empty-panel panel" data-testid="feed-empty">
        <span className="empty-icon">
          <Inbox size={30} />
        </span>
        <h2>Вы в курсе главного</h2>
        <p>Сейчас для вашей компании нет новых рекомендаций.</p>
      </div>
    );
  return (
    <div className="feed-cards" data-testid="feed-ready">
      {data.items.map((item) => (
        <NewsCard
          key={`${data.delivery_id}:${item.news_id}`}
          item={item}
          deliveryId={data.delivery_id}
          onStudy={(id) =>
            onStudy({ delivery_id: data.delivery_id, recommendation_id: id, title: item.title })
          }
          onEligible={(id, value) =>
            onEligible(
              { delivery_id: data.delivery_id, recommendation_id: id, title: item.title },
              value,
            )
          }
        />
      ))}
    </div>
  );
}
export function FeedList({
  onStudy,
  onEligible,
  onDelivery,
}: {
  onStudy: (target: RecommendationTarget) => void;
  onEligible: (target: RecommendationTarget, value: boolean) => void;
  onDelivery: (id: string | null) => void;
}) {
  const query = useFeed();
  const toast = useToast();
  useEffect(() => {
    if (query.isError) toast();
  }, [query.isError, toast]);
  useLayoutEffect(() => {
    onDelivery(query.data && !query.isFetching && !query.isError ? query.data.delivery_id : null);
  }, [query.data, query.isFetching, query.isError, onDelivery]);
  const loading = query.isPending || query.isFetching;
  return (
    <section data-testid="news-feed" data-delivery-id={query.data?.delivery_id} aria-busy={loading}>
      {loading ? (
        <div
          data-testid="feed-loading"
          className="feed-skeletons"
          role="status"
          aria-label="Загрузка рекомендаций"
        >
          {[1, 2, 3].map((index) => (
            <div className="panel feed-skeleton" key={index}>
              <Skeleton className="short" />
              <Skeleton />
              <Skeleton />
              <Skeleton className="recommendation-skeleton" />
            </div>
          ))}
        </div>
      ) : query.isError || !query.data ? (
        <div className="empty-panel panel" data-testid="feed-error" role="alert">
          <h2>Не удалось загрузить ленту</h2>
          <p>Сервис недоступен, попробуйте позже</p>
          <Button onClick={() => void query.refetch()} aria-label="Повторить загрузку ленты">
            <RefreshCw size={16} />
            Повторить
          </Button>
        </div>
      ) : (
        <CommittedFeed
          data={query.data}
          operationId={query.operationId}
          onStudy={onStudy}
          onEligible={onEligible}
        />
      )}
    </section>
  );
}
