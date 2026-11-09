import { Sparkles } from 'lucide-react';
export type Message = { id: string; role: 'user' | 'assistant'; text: string };
export function MessageBubble({ message }: { message: Message }) {
  return (
    <div className={`message-row ${message.role}`}>
      {message.role === 'assistant' && (
        <span className="assistant-avatar">
          <Sparkles size={17} />
        </span>
      )}
      <div className="message-bubble">
        <span>{message.role === 'user' ? 'Вы' : 'AI Ассистент'}</span>
        <p>{message.text}</p>
      </div>
    </div>
  );
}
