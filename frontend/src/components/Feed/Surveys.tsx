import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, MessageSquareText } from 'lucide-react';
import { feedback } from '../../api/endpoints';
import type { FeedbackBody } from '../../api/types';
import { uuid } from '../../telemetry/ids';
import { setStep, track } from '../../telemetry/tracker';
import { Button } from '../UI/Button';
import { useToast } from '../UI/Toast';

function useFeedback(
  surveyType: FeedbackBody['survey_type'],
  deliveryId: string,
  recommendationId: string,
) {
  const responseId = useRef(uuid());
  const version = useRef(0);
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const toast = useToast();
  async function submit(answers: FeedbackBody['answers'], reason: string | null) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setStep('feedback');
    const eventId = uuid();
    const body: FeedbackBody = {
      response_id: responseId.current,
      version: ++version.current,
      event_id: eventId,
      questionnaire_version: 'readiness-decision-v1',
      survey_type: surveyType,
      delivery_id: deliveryId,
      notification_id: null,
      recommendation_id: recommendationId,
      answers,
      brief_reason: reason?.slice(0, 500) || null,
    };
    try {
      await feedback(body, uuid());
      track(
        'feedback_submitted',
        {
          questionnaire_version: body.questionnaire_version,
          survey_type: surveyType,
          delivery_id: deliveryId,
          notification_id: null,
          recommendation_id: recommendationId,
          answers,
          brief_reason: body.brief_reason,
        },
        eventId,
      );
      setSubmitted(true);
    } catch {
      toast();
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return { submit, loading, submitted };
}
function Scale({
  name,
  value,
  onChange,
  testId,
}: {
  name: string;
  value: number | null;
  onChange: (value: number) => void;
  testId?: string;
}) {
  return (
    <div className="survey-scale" role="radiogroup" aria-label="Оценка от 1 до 5">
      {[1, 2, 3, 4, 5].map((number) => (
        <label key={number} className={value === number ? 'checked' : ''}>
          <input
            type="radio"
            name={name}
            value={number}
            checked={value === number}
            onChange={() => onChange(number)}
            required
            data-testid={testId}
            aria-label={`${number} из 5`}
          />
          <span>{number}</span>
        </label>
      ))}
    </div>
  );
}
export function ReadinessSurvey({
  deliveryId,
  recommendationId,
  recommendationTitle,
}: {
  deliveryId: string;
  recommendationId: string;
  recommendationTitle?: string;
}) {
  const [value, setValue] = useState<number | null>(null);
  const [barrier, setBarrier] = useState('');
  const [reason, setReason] = useState('');
  const [skipped, setSkipped] = useState(false);
  const state = useFeedback('recommendation', deliveryId, recommendationId);
  if (skipped) return null;
  return (
    <form
      className="panel survey-panel"
      data-testid="readiness-survey"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (value !== null)
          void state.submit({ readiness: value, barrier: barrier || null }, reason);
      }}
    >
      <div className="survey-heading">
        <MessageSquareText size={19} />
        <span>ВАШЕ МНЕНИЕ</span>
      </div>
      <h3>Насколько вы готовы начать следующий шаг?</h3>
      <p>К рекомендации: {recommendationTitle || recommendationId}</p>
      <p>Оцените готовность от 1 до 5. Ответ необязателен.</p>
      <Scale name="readiness" value={value} onChange={setValue} testId="readiness-value" />
      <div className="scale-labels">
        <span>Пока не готов</span>
        <span>Готов начать</span>
      </div>
      <label className="form-label">
        Что мешает начать?
        <select
          value={barrier}
          onChange={(event) => setBarrier(event.target.value)}
          aria-label="Барьер для следующего шага"
        >
          <option value="">Ничего / не указывать</option>
          <option value="approval_required">Нужно согласование</option>
          <option value="no_authority">Нет полномочий</option>
          <option value="no_budget">Нет бюджета</option>
          <option value="not_relevant">Неактуально</option>
          <option value="other">Другое</option>
        </select>
      </label>
      <label className="form-label">
        Комментарий, если хотите
        <textarea
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="До 500 символов"
        />
      </label>
      {state.submitted && (
        <p className="survey-success" role="status">
          <CheckCircle2 size={16} />
          Ответ сохранён. Вы можете обновить его.
        </p>
      )}
      <div className="survey-buttons">
        <Button
          variant="primary"
          type="submit"
          data-testid="feedback-submit"
          loading={state.loading}
          disabled={value === null}
        >
          {state.submitted ? 'Обновить ответ' : 'Отправить'}
        </Button>
        <Button
          variant="ghost"
          data-testid="feedback-skip"
          disabled={state.loading}
          onClick={() => setSkipped(true)}
        >
          Пропустить
        </Button>
      </div>
    </form>
  );
}
export function DecisionFollowup({
  deliveryId,
  recommendationId,
  recommendationTitle,
}: {
  deliveryId: string;
  recommendationId: string;
  recommendationTitle?: string;
}) {
  const state = useFeedback('decision_followup', deliveryId, recommendationId);
  const [taken, setTaken] = useState('');
  const [helped, setHelped] = useState('');
  const [usefulness, setUsefulness] = useState<number | null>(null);
  const [decisionType, setDecisionType] = useState('');
  const [summary, setSummary] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  return (
    <form
      className="panel survey-panel decision-panel"
      data-testid="decision-followup"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (
          !taken ||
          !helped ||
          usefulness === null ||
          !summary.trim() ||
          !decisionType ||
          !occurredAt
        )
          return;
        void state.submit(
          {
            decision_taken: taken === 'yes',
            helped_by_service: helped === 'yes',
            usefulness,
            decision_type: decisionType,
            decision_summary: summary.trim().slice(0, 500),
            occurred_at: new Date(occurredAt).toISOString(),
          },
          null,
        );
      }}
    >
      <div className="survey-heading">
        <CheckCircle2 size={19} />
        <span>ОТ РЕКОМЕНДАЦИИ К РЕШЕНИЮ</span>
      </div>
      <h3>Помогла ли рекомендация принять решение?</h3>
      <p>К рекомендации: {recommendationTitle || recommendationId}</p>
      <p>Расскажите о принятом решении, когда сможете оценить результат.</p>
      <div className="decision-form-grid">
        <label className="form-label">
          Решение принято?
          <select
            required
            aria-label="Решение принято"
            value={taken}
            onChange={(event) => setTaken(event.target.value)}
          >
            <option value="">Выберите ответ</option>
            <option value="yes">Да</option>
            <option value="no">Пока нет</option>
          </select>
        </label>
        <label className="form-label">
          Рекомендация помогла?
          <select
            required
            aria-label="Рекомендация помогла"
            value={helped}
            onChange={(event) => setHelped(event.target.value)}
          >
            <option value="">Выберите ответ</option>
            <option value="yes">Да</option>
            <option value="no">Нет</option>
          </select>
        </label>
      </div>
      <fieldset className="survey-fieldset" data-testid="decision-usefulness">
        <legend>Насколько рекомендация была полезна?</legend>
        <Scale name="decision-usefulness" value={usefulness} onChange={setUsefulness} />
      </fieldset>
      <label className="form-label">
        Какое решение?
        <select
          required
          value={decisionType}
          onChange={(event) => setDecisionType(event.target.value)}
          aria-label="Тип решения"
        >
          <option value="">Выберите тип</option>
          <option value="apply">Начать действие</option>
          <option value="plan">Включить в план</option>
          <option value="postpone">Отложить</option>
          <option value="decline">Отказаться</option>
          <option value="other">Другое</option>
        </select>
      </label>
      <label className="form-label">
        Опишите решение
        <textarea
          required
          maxLength={500}
          data-testid="decision-summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Какое решение вы приняли? До 500 символов"
        />
      </label>
      <label className="form-label">
        Когда это произошло?
        <input
          className="text-input"
          type="datetime-local"
          required
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
          aria-label="Дата и время решения"
        />
      </label>
      {state.submitted && (
        <p className="survey-success" role="status">
          <CheckCircle2 size={16} />
          Решение сохранено. Ответ можно обновить.
        </p>
      )}
      <Button
        variant="primary"
        type="submit"
        data-testid="decision-submit"
        loading={state.loading}
        disabled={usefulness === null}
      >
        {state.submitted ? 'Обновить решение' : 'Отправить ответ'}
      </Button>
    </form>
  );
}
