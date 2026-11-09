import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Lightbulb, TrendingUp } from 'lucide-react';
import type { News } from '../../api/types';
import { finishOp, setStep, startOp, track } from '../../telemetry/tracker';
import { uuid } from '../../telemetry/ids';
import { useExposure } from '../../telemetry/visibility';
import { RecommendationActions } from './RecommendationActions';

function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
export function NewsCard({
  item,
  deliveryId,
  onStudy,
  onEligible,
}: {
  item: News;
  deliveryId: string;
  onStudy: (id: string) => void;
  onEligible: (id: string, value: boolean) => void;
}) {
  const [newsOpen, setNewsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const newsRef = useRef<HTMLDivElement>(null),
    recRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ interaction: string; operationId?: string } | null>(null);
  useExposure(newsRef, {
    kind: 'news',
    contentId: item.news_id,
    deliveryId,
    newsId: item.news_id,
    position: item.position,
    text: `${item.title} ${item.news_text}`,
    expanded: newsOpen,
  });
  useExposure(recRef, {
    kind: 'recommendation',
    contentId: item.recommendation_id,
    deliveryId,
    newsId: item.news_id,
    recommendationId: item.recommendation_id,
    position: item.position,
    text: item.recommendation,
    expanded,
  });
  const common = {
    delivery_id: deliveryId,
    news_id: item.news_id,
    recommendation_id: item.recommendation_id,
  };
  useEffect(() => {
    const operation = pending.current;
    if (!operation) return;
    pending.current = null;
    track('content_interacted', {
      delivery_id: deliveryId,
      news_id: item.news_id,
      recommendation_id: operation.interaction.startsWith('news') ? null : item.recommendation_id,
      interaction: operation.interaction,
      source_id: null,
    });
    if (operation.operationId)
      finishOp(operation.operationId, 'success', { delivery_id: deliveryId });
  }, [newsOpen, expanded, deliveryId, item.news_id, item.recommendation_id]);
  const date =
    item.published_at && !Number.isNaN(Date.parse(item.published_at))
      ? new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(
          new Date(item.published_at),
        )
      : 'Дата не указана';
  return (
    <article
      className="news-card"
      data-testid="news-card"
      data-news-id={item.news_id}
      data-position={item.position}
    >
      <div className="news-content" ref={newsRef}>
        <div className="news-meta">
          <span className="news-position">{String(item.position).padStart(2, '0')}</span>
          <span>НОВОСТЬ ДЛЯ ВАС</span>
          <time dateTime={item.published_at || undefined}>{date}</time>
        </div>
        <h2 data-reading-text>{item.title}</h2>
        <div
          className={`news-body ${newsOpen ? '' : 'clamped'}`}
          data-testid="news-body"
          data-reading-text
        >
          {item.news_text}
        </div>
        <button
          className="text-button"
          data-testid="news-open"
          aria-label={newsOpen ? 'Свернуть новость' : 'Открыть новость'}
          aria-expanded={newsOpen}
          onClick={() => {
            setStep('news');
            const opId = newsOpen ? undefined : uuid();
            if (opId) startOp('news_open', opId);
            pending.current = {
              interaction: newsOpen ? 'news_close' : 'news_open',
              operationId: opId,
            };
            setNewsOpen(!newsOpen);
          }}
        >
          {newsOpen ? 'Свернуть новость' : 'Читать новость'}
          {newsOpen ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </button>
        <div className="news-sources">
          <span>Источники</span>
          {item.sources.map((source) => (
            <a
              key={source.source_id}
              href={safeUrl(source.url)}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="news-source"
              aria-label={`Открыть источник: ${source.title}`}
              onClick={() => {
                if (safeUrl(source.url))
                  track('content_interacted', {
                    ...common,
                    recommendation_id: null,
                    interaction: 'source_open',
                    source_id: source.source_id,
                  });
              }}
            >
              {source.title}
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      </div>
      <div className="interpretation-block">
        <span className="block-label">
          <TrendingUp size={16} />
          Что это значит для вас
        </span>
        <p>{item.interpretation}</p>
      </div>
      <div
        className="recommendation-block"
        ref={recRef}
        data-testid="recommendation"
        data-recommendation-id={item.recommendation_id}
      >
        <div className="recommendation-heading">
          <span className="block-label">
            <Lightbulb size={17} />
            Рекомендуемый шаг
          </span>
          <span className="personal-label">ПЕРСОНАЛЬНО</span>
        </div>
        <p className={expanded ? '' : 'clamped'} data-reading-text>
          {item.recommendation}
        </p>
        <button
          className="text-button"
          data-testid="recommendation-expand"
          aria-label={expanded ? 'Свернуть рекомендацию' : 'Развернуть рекомендацию'}
          aria-expanded={expanded}
          onClick={() => {
            setStep('recommendation');
            pending.current = {
              interaction: expanded ? 'recommendation_collapse' : 'recommendation_expand',
            };
            setExpanded(!expanded);
            if (!expanded) onStudy(item.recommendation_id);
          }}
        >
          {expanded ? 'Свернуть' : 'Подробнее о рекомендации'}
          {expanded ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
        </button>
      </div>
      <RecommendationActions
        item={item}
        deliveryId={deliveryId}
        onStudy={() => onStudy(item.recommendation_id)}
        onEligible={onEligible}
      />
    </article>
  );
}
