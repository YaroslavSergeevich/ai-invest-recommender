import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../src/api/endpoints', () => ({
  action: vi.fn(),
  feedback: vi.fn(),
  chat: vi.fn(),
}));
vi.mock('../src/api/hooks', () => ({ useFeed: vi.fn(), usePush: vi.fn() }));
vi.mock('../src/telemetry/tracker', () => ({
  track: vi.fn(() => 'event-id'),
  startOp: vi.fn(),
  finishOp: vi.fn(),
  setStep: vi.fn(),
}));
vi.mock('../src/telemetry/visibility', () => ({ useExposure: vi.fn(() => ({ current: null })) }));

import { action, feedback, chat } from '../src/api/endpoints';
import { useFeed } from '../src/api/hooks';
import { track } from '../src/telemetry/tracker';
import { getIdentity, setIdentity } from '../src/telemetry/ids';
import { AppProvider } from '../src/context/SessionContext';
import { ToastProvider } from '../src/components/UI/Toast';
import { RecommendationActions } from '../src/components/Feed/RecommendationActions';
import { FeedList } from '../src/components/Feed/FeedList';
import { ReadinessSurvey, DecisionFollowup } from '../src/components/Feed/Surveys';
import { RecommendationsPage } from '../src/pages/RecommendationsPage';
import { news, readyFeed } from './fixtures';

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AppProvider>
        <ToastProvider>{children}</ToastProvider>
      </AppProvider>
    </MemoryRouter>
  );
}

function actions() {
  return render(
    <RecommendationActions
      item={news}
      deliveryId="delivery-server"
      onStudy={vi.fn()}
      onEligible={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setIdentity({ ...getIdentity(), actor_kind: 'human', seed: null });
  vi.mocked(track).mockImplementation(() => 'event-id');
  vi.mocked(action).mockResolvedValue({ request_id: 'request-action' });
  vi.mocked(feedback).mockResolvedValue({ request_id: 'request-feedback' });
  vi.mocked(chat).mockResolvedValue({ text: 'response' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('real UI handlers', () => {
  it('does not emit E11 before the server confirms an action', async () => {
    let resolve!: (value: { request_id: string }) => void;
    vi.mocked(action).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    actions();
    fireEvent.click(screen.getByTestId('recommendation-save'));
    expect(track).not.toHaveBeenCalled();
    expect(screen.getByTestId('recommendation-save')).toBeDisabled();
    await act(async () => resolve({ request_id: 'confirmed' }));
    expect(track).toHaveBeenCalledWith(
      'recommendation_action',
      expect.objectContaining({
        action: 'save',
        news_id: news.news_id,
        recommendation_id: news.recommendation_id,
        status: 'success',
      }),
    );
    expect(screen.getByTestId('recommendation-save')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps actions unchanged on HTTP failure and never emits E11', async () => {
    vi.mocked(action).mockRejectedValue(new Error('failed'));
    actions();
    fireEvent.click(screen.getByTestId('recommendation-save'));
    await screen.findByRole('alert');
    expect(track).not.toHaveBeenCalled();
    expect(screen.getByTestId('recommendation-save')).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits copy only on clipboard success and never includes clipboard contents', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    actions();
    fireEvent.click(screen.getByTestId('recommendation-copy'));
    await screen.findByRole('alert');
    expect(track).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('recommendation-copy'));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'recommendation_action',
        expect.objectContaining({ action: 'copy' }),
      ),
    );
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain(news.recommendation);
    expect(action).not.toHaveBeenCalled();
  });

  it('requires an explicit rejection reason and supports intent withdrawal', async () => {
    actions();
    fireEvent.click(screen.getByTestId('recommendation-reject'));
    expect(action).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Причина отклонения'), {
      target: { value: 'wrong_geography' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Отклонить$/ }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'reject', reason_code: 'wrong_geography' }),
        expect.any(String),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('recommendation-apply')).toBeEnabled());
    fireEvent.click(screen.getByTestId('recommendation-apply'));
    await waitFor(() =>
      expect(screen.getByTestId('recommendation-apply')).toHaveTextContent('Отменить'),
    );
    fireEvent.click(screen.getByTestId('recommendation-apply'));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'recommendation_action',
        expect.objectContaining({ action: 'withdraw_intent' }),
      ),
    );
    expect(vi.mocked(track).mock.calls.every(([name]) => name === 'recommendation_action')).toBe(
      true,
    );
  });
});

describe('feed and notification commits', () => {
  const base = {
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    operationId: 'op',
  };

  it('emits E07 after usable DOM exists, with server IDs and positions', () => {
    vi.mocked(useFeed).mockReturnValue({ ...base, data: readyFeed } as unknown as ReturnType<
      typeof useFeed
    >);
    vi.mocked(track).mockImplementation((name) => {
      if (name === 'feed_rendered') expect(screen.getByTestId('feed-ready')).toBeInTheDocument();
      return 'event-id';
    });
    render(<FeedList onStudy={vi.fn()} onEligible={vi.fn()} onDelivery={vi.fn()} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('news-card')).toHaveAttribute('data-news-id', news.news_id);
    expect(screen.getByTestId('news-card')).toHaveAttribute('data-position', '7');
    expect(track).toHaveBeenCalledWith(
      'feed_rendered',
      expect.objectContaining({
        status: 'ready',
        items: [{ news_id: news.news_id, recommendation_id: news.recommendation_id, position: 7 }],
      }),
    );
  });

  it.each(['loading', 'empty', 'error'] as const)('renders only the %s state', (state) => {
    vi.mocked(useFeed).mockReturnValue({
      ...base,
      isPending: state === 'loading',
      isError: state === 'error',
      data: state === 'empty' ? { ...readyFeed, status: 'empty', items: [] } : undefined,
    } as unknown as ReturnType<typeof useFeed>);
    render(<FeedList onStudy={vi.fn()} onEligible={vi.fn()} onDelivery={vi.fn()} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId(`feed-${state}`)).toBeInTheDocument();
    for (const other of ['loading', 'ready', 'empty', 'error'])
      if (other !== state) expect(screen.queryByTestId(`feed-${other}`)).toBeNull();
  });
});

describe('explicit feedback', () => {
  it('does not submit on skip and versions repeated answers under the same response_id', async () => {
    const first = render(
      <ReadinessSurvey deliveryId="delivery" recommendationId="recommendation" />,
      { wrapper: Wrapper },
    );
    fireEvent.click(screen.getByTestId('feedback-skip'));
    expect(feedback).not.toHaveBeenCalled();
    first.unmount();
    render(<ReadinessSurvey deliveryId="delivery" recommendationId="recommendation" />, {
      wrapper: Wrapper,
    });
    fireEvent.click(screen.getByRole('radio', { name: '4 из 5' }));
    fireEvent.click(screen.getByTestId('feedback-submit'));
    await waitFor(() => expect(feedback).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('feedback-submit')).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: '5 из 5' }));
    fireEvent.click(screen.getByTestId('feedback-submit'));
    await waitFor(() => expect(feedback).toHaveBeenCalledTimes(2));
    const a = vi.mocked(feedback).mock.calls[0][0],
      b = vi.mocked(feedback).mock.calls[1][0];
    expect(b.response_id).toBe(a.response_id);
    expect(b.version).toBe(a.version + 1);
    expect(b.event_id).not.toBe(a.event_id);
    expect(track).toHaveBeenCalledWith(
      'feedback_submitted',
      expect.objectContaining({ survey_type: 'recommendation' }),
      expect.any(String),
    );
  });

  it('records B decision feedback only after a completed explicit submit', async () => {
    render(<DecisionFollowup deliveryId="delivery" recommendationId="rec" />, { wrapper: Wrapper });
    expect(feedback).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Решение принято'), { target: { value: 'yes' } });
    fireEvent.change(screen.getByLabelText('Рекомендация помогла'), { target: { value: 'yes' } });
    fireEvent.click(
      within(screen.getByTestId('decision-usefulness')).getByRole('radio', { name: '5 из 5' }),
    );
    fireEvent.change(screen.getByLabelText('Тип решения'), { target: { value: 'plan' } });
    fireEvent.change(screen.getByTestId('decision-summary'), {
      target: { value: 'Включили проверку договора в план' },
    });
    fireEvent.change(screen.getByLabelText('Дата и время решения'), {
      target: { value: '2026-10-26T15:00' },
    });
    fireEvent.click(screen.getByTestId('decision-submit'));
    await waitFor(() =>
      expect(feedback).toHaveBeenCalledWith(
        expect.objectContaining({
          survey_type: 'decision_followup',
          answers: expect.objectContaining({
            decision_taken: true,
            helped_by_service: true,
            usefulness: 5,
            decision_type: 'plan',
          }),
        }),
        expect.any(String),
      ),
    );
  });
});

describe('RecommendationsPage tabs', () => {
  const baseFeed = {
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    operationId: 'op',
    data: readyFeed,
  };

  it('renders feed tab by default with FeedList', () => {
    vi.mocked(useFeed).mockReturnValue(baseFeed as unknown as ReturnType<typeof useFeed>);
    render(<RecommendationsPage />, { wrapper: Wrapper });
    expect(screen.getByTestId('recommendations-page')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Лента/i })).toHaveAttribute('aria-selected', 'true');
    // The tabpanel is a div with role="tabpanel" - use the one with aria-labelledby
    const feedPanel = screen.getByRole('tabpanel', { name: /Лента/i });
    expect(feedPanel).toBeVisible();
  });

  it('switches to chat tab and renders ChatArea', () => {
    vi.mocked(useFeed).mockReturnValue(baseFeed as unknown as ReturnType<typeof useFeed>);
    render(<RecommendationsPage />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('tab', { name: /Чат/i }));
    expect(screen.getByRole('tab', { name: /Чат/i })).toHaveAttribute('aria-selected', 'true');
    // There are two elements with role="tabpanel" and name "Чат" - the outer div (hidden) and inner section
    // Use the section which is the actual ChatArea and has class "panel chat-area"
    const chatArea = screen.getByTestId('chat-area');
    expect(chatArea).toBeInTheDocument();
    expect(screen.getByText('AI Ассистент')).toBeInTheDocument();
  });

  it('renders feed guide when no study is active', () => {
    vi.mocked(useFeed).mockReturnValue(baseFeed as unknown as ReturnType<typeof useFeed>);
    render(<RecommendationsPage />, { wrapper: Wrapper });
    // Check the feed tab is active and section title is visible
    expect(screen.getByRole('tab', { name: /Лента/i })).toHaveAttribute('aria-selected', 'true');
    // Use the h2 in the feed panel (not the h1 in page header)
    expect(screen.getByRole('heading', { name: 'Рекомендации', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Персональная подборка на основе ваших интересов')).toBeInTheDocument();
  });
});

describe('ChatArea integration', () => {
  const baseFeed = {
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
    operationId: 'op',
    data: readyFeed,
  };

  it('sends chat message and renders response', async () => {
    vi.mocked(useFeed).mockReturnValue(baseFeed as unknown as ReturnType<typeof useFeed>);
    vi.mocked(chat).mockResolvedValue({ text: 'AI response' });
    render(<RecommendationsPage />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('tab', { name: /Чат/i }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('Спросите о новостях для вашего бизнеса'),
      ).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('Спросите о новостях для вашего бизнеса'), {
      target: { value: 'Test query' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Отправить/i }));

    await waitFor(() =>
      expect(chat).toHaveBeenCalledWith(
        'demo-user',
        'Test query',
        expect.any(String),
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(screen.getByText('AI response')).toBeInTheDocument());
  });

  it('shows suggestions when no messages', () => {
    vi.mocked(useFeed).mockReturnValue(baseFeed as unknown as ReturnType<typeof useFeed>);
    render(<RecommendationsPage />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('tab', { name: /Чат/i }));
    expect(screen.getByText('Что нового в технологиях?')).toBeInTheDocument();
    expect(screen.getByText('Влияние ключевой ставки на рынки')).toBeInTheDocument();
  });
});
