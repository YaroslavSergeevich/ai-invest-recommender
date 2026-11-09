import { useState, useRef, useCallback } from 'react';
import type { RecommendationTarget } from '../api/types';
import { Newspaper, MessageCircle, Sparkles, Bookmark } from 'lucide-react';
import { FeedList } from '../components/Feed/FeedList';
import { ReadinessSurvey, DecisionFollowup } from '../components/Feed/Surveys';
import { ChatArea } from '../components/Chat/ChatArea';

function RecommendationsWorkspace() {
  const [tab, setTab] = useState<'feed' | 'chat'>('feed');
  const [studied, setStudied] = useState<RecommendationTarget | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [eligible, setEligible] = useState<RecommendationTarget[]>([]);
  const currentDelivery = useRef<string | null>(null);

  const onDelivery = useCallback((id: string | null) => {
    if (id !== currentDelivery.current) {
      currentDelivery.current = id;
      setStudied(null);
      setEligible([]);
      setDelivery(id);
    }
  }, []);

  const onStudy = useCallback((target: RecommendationTarget) => {
    if (target.delivery_id === currentDelivery.current) setStudied(target);
  }, []);

  const onEligible = useCallback((target: RecommendationTarget, value: boolean) => {
    if (target.delivery_id !== currentDelivery.current) return;
    setEligible((previous) => {
      const rest = previous.filter((item) => item.recommendation_id !== target.recommendation_id);
      return value ? [target, ...rest] : rest;
    });
  }, []);

  const activeStudy = studied?.delivery_id === delivery ? studied : null;
  const activeDecision = eligible.find((item) => item.delivery_id === delivery);

  return (
    <>
      <div className="recommendations-tabs" role="tablist" aria-label="Разделы рекомендаций">
        <button
          id="feed-tab"
          role="tab"
          aria-selected={tab === 'feed'}
          aria-controls="feed-panel"
          onClick={() => setTab('feed')}
          className={tab === 'feed' ? 'active' : ''}
        >
          <Newspaper size={17} />
          <span>Лента</span>
        </button>
        <button
          id="chat-tab"
          role="tab"
          aria-selected={tab === 'chat'}
          aria-controls="chat-panel"
          onClick={() => setTab('chat')}
          className={tab === 'chat' ? 'active' : ''}
        >
          <MessageCircle size={17} />
          <span>Чат</span>
        </button>
      </div>

      <div hidden={tab !== 'chat'} id="chat-panel" role="tabpanel" aria-labelledby="chat-tab">
        <ChatArea key={`chat-${Date.now()}`} />
      </div>

      <div hidden={tab !== 'feed'} id="feed-panel" role="tabpanel" aria-labelledby="feed-tab">
        <div className="feed-layout">
          <div className="feed-main">
            <div className="section-title">
              <h2>Рекомендации</h2>
              <span>Персональная подборка на основе ваших интересов</span>
            </div>
            <FeedList onStudy={onStudy} onEligible={onEligible} onDelivery={onDelivery} />
            {activeDecision && (
              <DecisionFollowup
                key={`${activeDecision.delivery_id}:${activeDecision.recommendation_id}`}
                deliveryId={activeDecision.delivery_id}
                recommendationId={activeDecision.recommendation_id}
                recommendationTitle={activeDecision.title}
              />
            )}
          </div>
          <aside className={`feed-aside ${activeStudy ? 'has-survey' : ''}`}>
            {activeStudy ? (
              <ReadinessSurvey
                key={`${activeStudy.delivery_id}:${activeStudy.recommendation_id}`}
                deliveryId={activeStudy.delivery_id}
                recommendationId={activeStudy.recommendation_id}
                recommendationTitle={activeStudy.title}
              />
            ) : (
              <section className="panel feed-guide">
                <span className="guide-icon">
                  <Sparkles size={23} />
                </span>
                <h3>
                  От события
                  <br />к решению
                </h3>
                <p>Читайте, что произошло, оценивайте влияние и выбирайте следующий шаг.</p>
                <div className="guide-steps">
                  <div>
                    <span>01</span>
                    <p>Событие и проверяемые источники</p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>Влияние на ваши интересы</p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>Конкретная рекомендация</p>
                  </div>
                </div>
                <span className="guide-footer">Всё важное — в одной ленте</span>
              </section>
            )}
            <div className="save-hint">
              <Bookmark size={18} />
              <p>Сохраняйте рекомендации, чтобы вернуться к ним при принятии решения.</p>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

export function RecommendationsPage() {
  return (
    <div className="recommendations-page" data-testid="recommendations-page">
      <div className="page-header">
        <div>
          <span className="eyebrow">AI INVEST RECOMMENDER</span>
          <h1>
            Рекомендации<span className="title-dot">.</span>
          </h1>
          <p>Умные инсайты для инвестиционных решений. На основе новостей и аналитики.</p>
        </div>
        <span className="page-title-icon">
          <Sparkles size={34} strokeWidth={1.3} />
        </span>
      </div>
      <RecommendationsWorkspace />
    </div>
  );
}
