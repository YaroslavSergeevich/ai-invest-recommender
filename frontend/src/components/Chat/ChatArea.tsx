import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageCircle, Sparkles } from 'lucide-react';
import { chat } from '../../api/endpoints';
import { useAppContext } from '../../context/SessionContext';
import { uuid } from '../../telemetry/ids';
import { useToast } from '../UI/Toast';
import { ChatInput } from './ChatInput';
import { MessageBubble, type Message } from './MessageBubble';

export function ChatArea() {
  const { dev, legacyUserId } = useAppContext();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages, loading]);
  const userId = dev ? legacyUserId : 'demo-user';
  async function send(text: string, retry = false) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(null);
    if (!retry) setMessages((previous) => [...previous, { id: uuid(), role: 'user', text }]);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await chat(userId, text.slice(0, 500), uuid(), controller.signal);
      setMessages((previous) => [
        ...previous,
        { id: uuid(), role: 'assistant', text: result.text },
      ]);
    } catch {
      if (!controller.signal.aborted) {
        toast();
        setFailed(text);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        busy.current = false;
        pending.current = null;
      }
    }
  }
  return (
    <section
      className="panel chat-area"
      id="chat-panel"
      role="tabpanel"
      aria-labelledby="chat-tab"
      data-testid="chat-area"
    >
      <div className="chat-header">
        <span className="assistant-avatar">
          <Sparkles size={20} />
        </span>
        <div>
          <h2>AI Ассистент</h2>
          <p>Обсудите рекомендации и их влияние на ваши решения</p>
        </div>
      </div>
      <div className="chat-messages" role="log" aria-live="polite" aria-label="История чата">
        {messages.length ? (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        ) : (
          <div className="chat-empty">
            <span className="empty-icon">
              <MessageCircle size={29} />
            </span>
            <h3>С чего начнём?</h3>
            <p>Спросите о событиях, которые могут повлиять на ваши инвестиции.</p>
            <div className="chat-suggestions">
              {['Что нового в технологиях?', 'Влияние ключевой ставки на рынки'].map((text) => (
                <button key={text} onClick={() => void send(text)} disabled={loading}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {loading && (
          <div className="chat-loading" role="status">
            <LoaderCircle size={16} className="spin" />
            Ассистент готовит ответ
          </div>
        )}
        {failed && (
          <div className="chat-failed">
            <span>Сервис недоступен, попробуйте позже</span>
            <button onClick={() => void send(failed, true)}>Повторить</button>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <ChatInput loading={loading} onSend={(text) => void send(text)} />
      <p className="chat-footnote">
        Ответы формирует сервер. История хранится только в текущем сеансе страницы.
      </p>
    </section>
  );
}
