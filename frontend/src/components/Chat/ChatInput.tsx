import { useState, type FormEvent } from 'react';
import { ArrowUp, LoaderCircle } from 'lucide-react';
export function ChatInput({
  loading,
  onSend,
}: {
  loading: boolean;
  onSend: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text || loading) return;
    onSend(text);
    setQuery('');
  };
  return (
    <form className="chat-input" onSubmit={submit}>
      <input
        aria-label="Сообщение помощнику"
        placeholder="Спросите о новостях для вашего бизнеса"
        value={query}
        maxLength={500}
        disabled={loading}
        onChange={(event) => setQuery(event.target.value)}
      />
      <button type="submit" aria-label="Отправить сообщение" disabled={loading || !query.trim()}>
        {loading ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}
      </button>
    </form>
  );
}
