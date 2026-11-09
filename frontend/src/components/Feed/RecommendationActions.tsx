import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Copy, LoaderCircle, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { action as sendAction } from '../../api/endpoints';
import { ApiError, operationStatus } from '../../api/client';
import type { Action, News, Reason } from '../../api/types';
import { uuid } from '../../telemetry/ids';
import { finishOp, setStep, startOp, track } from '../../telemetry/tracker';
import { useToast } from '../UI/Toast';
import { Button } from '../UI/Button';

const reasons: { value: Reason; label: string }[] = [
  { value: 'not_relevant', label: 'Не относится к моему бизнесу' },
  { value: 'wrong_geography', label: 'Другой регион' },
  { value: 'already_done', label: 'Уже сделано' },
  { value: 'no_authority', label: 'Не в моей зоне ответственности' },
  { value: 'too_generic', label: 'Слишком общая рекомендация' },
  { value: 'other', label: 'Другое' },
];
export function RecommendationActions({
  item,
  deliveryId,
  onStudy,
  onEligible,
}: {
  item: News;
  deliveryId: string;
  onStudy: () => void;
  onEligible: (id: string, eligible: boolean) => void;
}) {
  const toast = useToast();
  const busy = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [intended, setIntended] = useState(false);
  const [rating, setRating] = useState<'useful' | 'not_useful' | null>(null);
  const [showReasons, setShowReasons] = useState(false);
  const [reason, setReason] = useState<Reason>('not_relevant');
  const [rejected, setRejected] = useState(false);
  const completion = useRef<{
    operationId: string;
    status: string;
    details: Record<string, unknown>;
  } | null>(null);
  const [completionVersion, setCompletionVersion] = useState(0);
  useEffect(() => {
    if (!pending && completion.current) {
      const result = completion.current;
      completion.current = null;
      finishOp(result.operationId, result.status, result.details);
    }
  }, [pending, saved, intended, rating, rejected, completionVersion]);
  async function perform(kind: Action | 'copy', reasonCode: Reason | null = null) {
    if (busy.current) return;
    busy.current = true;
    setPending(kind);
    setStep('recommendation');
    const opId = uuid(),
      actionId = uuid();
    startOp('recommendation_action', opId);
    const common = {
      delivery_id: deliveryId,
      news_id: item.news_id,
      recommendation_id: item.recommendation_id,
      action: kind,
      action_id: actionId,
      reason_code: reasonCode,
    };
    try {
      let requestId: string | null = null;
      if (kind === 'copy') await navigator.clipboard.writeText(item.recommendation);
      else {
        const result = await sendAction({ ...common, action: kind }, opId);
        requestId = result.request_id;
      }
      if (kind === 'save' || kind === 'unsave') {
        const next = kind === 'save';
        setSaved(next);
        onEligible(item.recommendation_id, next || intended);
      }
      if (kind === 'intend_apply' || kind === 'withdraw_intent') {
        const next = kind === 'intend_apply';
        setIntended(next);
        onEligible(item.recommendation_id, next || saved);
      }
      if (kind === 'useful' || kind === 'not_useful') setRating(kind);
      if (kind === 'reject') {
        setRejected(true);
        setShowReasons(false);
      }
      track('recommendation_action', { ...common, operation_id: opId, status: 'success' });
      // Resolve E15 after the usable button state commits, without waiting on analytics.
      completion.current = {
        operationId: opId,
        status: 'success',
        details: { request_id: requestId, delivery_id: deliveryId },
      };
      onStudy();
      if (kind === 'copy') toast('Рекомендация скопирована', true);
    } catch (cause) {
      toast();
      completion.current = {
        operationId: opId,
        status: operationStatus(cause),
        details: {
          delivery_id: deliveryId,
          error_code:
            cause instanceof ApiError
              ? cause.code
              : kind === 'copy'
                ? 'CLIPBOARD_ERROR'
                : 'UI_ERROR',
        },
      };
    } finally {
      busy.current = false;
      setPending(null);
      setCompletionVersion((value) => value + 1);
    }
  }
  return (
    <div className="recommendation-actions">
      <div className="action-main-row">
        <button
          className={`action-button ${saved ? 'selected' : ''}`}
          data-testid="recommendation-save"
          aria-label={saved ? 'Убрать из сохранённого' : 'Сохранить рекомендацию'}
          aria-pressed={saved}
          disabled={!!pending}
          onClick={() => void perform(saved ? 'unsave' : 'save')}
        >
          {pending === 'save' || pending === 'unsave' ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
          )}
          <span>{saved ? 'Сохранено' : 'Сохранить'}</span>
        </button>
        <button
          className={`action-button apply-button ${intended ? 'selected' : ''}`}
          data-testid="recommendation-apply"
          aria-label={intended ? 'Отменить намерение применить' : 'Применю рекомендацию'}
          aria-pressed={intended}
          disabled={!!pending}
          onClick={() => void perform(intended ? 'withdraw_intent' : 'intend_apply')}
        >
          <Check size={16} />
          <span>{intended ? 'Отменить' : 'Применю'}</span>
        </button>
        <div className="action-spacer" />
        <button
          className={`icon-button ${rating === 'useful' ? 'selected' : ''}`}
          data-testid="recommendation-useful"
          aria-label="Рекомендация полезна"
          aria-pressed={rating === 'useful'}
          disabled={!!pending}
          onClick={() => void perform('useful')}
        >
          <ThumbsUp size={17} />
        </button>
        <button
          className={`icon-button ${rating === 'not_useful' ? 'selected' : ''}`}
          data-testid="recommendation-not-useful"
          aria-label="Рекомендация не полезна"
          aria-pressed={rating === 'not_useful'}
          disabled={!!pending}
          onClick={() => void perform('not_useful')}
        >
          <ThumbsDown size={17} />
        </button>
        <span className="action-divider" />
        <button
          className="icon-button"
          data-testid="recommendation-copy"
          aria-label="Скопировать рекомендацию"
          disabled={!!pending}
          onClick={() => void perform('copy')}
        >
          <Copy size={17} />
        </button>
        <button
          className={`icon-button ${rejected ? 'selected' : ''}`}
          data-testid="recommendation-reject"
          aria-label="Отклонить рекомендацию"
          aria-expanded={showReasons}
          disabled={!!pending}
          onClick={() => setShowReasons((value) => !value)}
        >
          <X size={18} />
        </button>
      </div>
      {showReasons && (
        <div className="reject-reasons">
          <label>
            Почему рекомендация не подходит?
            <select
              aria-label="Причина отклонения"
              value={reason}
              onChange={(event) => setReason(event.target.value as Reason)}
            >
              {reasons.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            loading={pending === 'reject'}
            disabled={!!pending}
            onClick={() => void perform('reject', reason)}
          >
            Отклонить
          </Button>
        </div>
      )}
      {rejected && <p className="action-note">Спасибо, ваша оценка сохранена.</p>}
      {intended && <p className="action-note">Вы отметили намерение применить рекомендацию.</p>}
    </div>
  );
}
