import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, ChatApi, ChatMessage, ChatSession, TicketStatus } from '../api/chatApi';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { usePolling } from './usePolling';

export const POLL_INTERVAL_MS = 4000;
const MAX_MESSAGE_LENGTH = 2000;
const CLOSED: readonly TicketStatus[] = ['RESOLVED', 'CANCELLED'];

const SENDER_LABEL: Record<ChatMessage['sender'], string> = {
  CUSTOMER: 'Você',
  ATTENDANT: 'Atendente',
  SYSTEM: 'Quanttec',
};

interface PendingMessage {
  readonly clientMessageId: string;
  readonly text: string;
  readonly failed: boolean;
}

interface ConversationProps {
  readonly api: ChatApi;
  readonly session: ChatSession;
  /** The conversation can no longer continue here (closed, expired): start over. */
  readonly onStartOver: () => void;
}

export function Conversation({ api, session, onStartOver }: ConversationProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [status, setStatus] = useState<TicketStatus | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const [draft, setDraft] = useState('');
  const lastSeq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const addMessages = useCallback((incoming: readonly ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((message) => message.seq));
      return [...current, ...incoming.filter((message) => !known.has(message.seq))].sort((a, b) => a.seq - b.seq);
    });
    lastSeq.current = Math.max(lastSeq.current, ...incoming.map((message) => message.seq));
  }, []);

  const refresh = useCallback(async () => {
    if (sessionLost) return;
    try {
      const result = await api.listMessages(session, lastSeq.current);
      addMessages(result.messages);
      setStatus(result.ticket.status);
      setConnectionLost(false);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        setSessionLost(true);
      } else {
        setConnectionLost(true);
      }
    }
  }, [api, session, sessionLost, addMessages]);

  usePolling(refresh, POLL_INTERVAL_MS);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, pending.length]);

  async function send(message: PendingMessage) {
    setPending((current) => [
      ...current.filter((item) => item.clientMessageId !== message.clientMessageId),
      { ...message, failed: false },
    ]);
    try {
      const stored = await api.postMessage(session, message.clientMessageId, message.text);
      addMessages([stored]);
      setPending((current) => current.filter((item) => item.clientMessageId !== message.clientMessageId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setStatus('RESOLVED');
      setPending((current) =>
        current.map((item) => (item.clientMessageId === message.clientMessageId ? { ...item, failed: true } : item)),
      );
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void send({ clientMessageId: crypto.randomUUID(), text, failed: false });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  if (sessionLost) {
    return (
      <div className="step">
        <Alert tone="info">Não encontramos mais esta conversa neste navegador. Você pode abrir um novo atendimento.</Alert>
        <Button onClick={onStartOver}>Novo atendimento</Button>
      </div>
    );
  }

  const closed = status !== null && CLOSED.includes(status);

  return (
    <section className="conversation" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="conversation__title">
        Atendimento nº {session.ticketNumber}
      </h2>

      {connectionLost && <Alert tone="error">Sem conexão. Tentando de novo…</Alert>}

      <div className="conversation__messages" role="log" aria-live="polite" aria-label="Mensagens">
        {messages.length === 0 && status === null && <p className="conversation__empty">Carregando mensagens…</p>}
        {messages.map((message) => (
          <article key={message.seq} className={`message message--${message.sender.toLowerCase()}`}>
            <span className="message__sender">{SENDER_LABEL[message.sender]}</span>
            <p className="message__body">{message.body}</p>
            <time className="message__time" dateTime={message.createdAt}>
              {new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </time>
          </article>
        ))}
        {pending.map((message) => (
          <article key={message.clientMessageId} className="message message--customer message--pending">
            <span className="message__sender">Você</span>
            <p className="message__body">{message.text}</p>
            {message.failed ? (
              <span className="message__status message__status--failed">
                Não enviada.{' '}
                {!closed && (
                  <Button variant="link" onClick={() => void send(message)}>
                    Tentar de novo
                  </Button>
                )}
              </span>
            ) : (
              <span className="message__status">Enviando…</span>
            )}
          </article>
        ))}
        <div ref={endRef} />
      </div>

      {closed ? (
        <div className="conversation__closed">
          <Alert tone="info">Este atendimento foi encerrado.</Alert>
          <Button onClick={onStartOver}>Novo atendimento</Button>
        </div>
      ) : (
        <form className="composer" onSubmit={submit}>
          <label htmlFor="composer-input" className="visually-hidden">
            Sua mensagem
          </label>
          <textarea
            id="composer-input"
            className="composer__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Escreva sua mensagem"
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
          />
          <Button type="submit" disabled={!draft.trim()}>
            Enviar
          </Button>
        </form>
      )}
    </section>
  );
}
