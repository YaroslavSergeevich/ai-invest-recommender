export type Versions = { frontend?: string | null; [key: string]: string | null | undefined };

export type News = {
  news_id: string;
  recommendation_id: string;
  position: number;
  title: string;
  news_text: string;
  interpretation: string;
  recommendation: string;
  published_at: string | null;
  published_at_status: string;
  sources: { source_id: string; title: string; url: string }[];
};

export type RecommendationTarget = {
  delivery_id: string;
  recommendation_id: string;
  title: string;
};

export type Feed = {
  request_id: string;
  operation_id: string;
  delivery_id: string;
  status: 'ready' | 'empty';
  versions: Versions;
  items: News[];
};

export type Push = {
  request_id: string;
  operation_id: string;
  delivery_id: string;
  notification_id: string | null;
  push_flag: boolean;
  text: string | null;
  event_y: string;
  action_x: string;
  conditions: string[];
  news_ids: string[];
  versions: Versions;
};

export type Action =
  'save' | 'unsave' | 'reject' | 'useful' | 'not_useful' | 'intend_apply' | 'withdraw_intent';
export type Reason =
  'not_relevant' | 'wrong_geography' | 'already_done' | 'no_authority' | 'too_generic' | 'other';
export type ActionBody = {
  action_id: string;
  delivery_id: string;
  news_id: string;
  recommendation_id: string;
  action: Action;
  reason_code: Reason | null;
};
export type FeedbackBody = {
  response_id: string;
  version: number;
  event_id: string;
  questionnaire_version: string;
  survey_type: 'notification' | 'recommendation' | 'decision_followup';
  delivery_id: string | null;
  notification_id: string | null;
  recommendation_id: string | null;
  answers: Record<string, string | number | boolean | null>;
  brief_reason: string | null;
};
export type Ack = {
  accepted_ids: string[];
  duplicate_ids: string[];
  rejected: { event_id: string; code: string; retryable: boolean }[];
};
