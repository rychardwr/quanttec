import { useState } from 'react';
import { ChatApi, chatApi, ChatSession } from '../api/chatApi';
import { Conversation } from './Conversation';
import { NewConversation } from './NewConversation';
import { clearSession, loadSession, saveSession } from './sessionStorage';

export function ChatPage({ api = chatApi }: { readonly api?: ChatApi }) {
  const [session, setSession] = useState<ChatSession | null>(loadSession);

  function start(newSession: ChatSession) {
    saveSession(newSession);
    setSession(newSession);
  }

  function startOver() {
    clearSession();
    setSession(null);
  }

  return (
    <div className="chat-shell">
      <header className="chat-shell__header">
        <h1>Quanttec Atendimento</h1>
      </header>
      <main className="chat-shell__body">
        {session ? (
          <Conversation key={session.ticketId} api={api} session={session} onStartOver={startOver} />
        ) : (
          <NewConversation api={api} onStarted={start} />
        )}
      </main>
    </div>
  );
}
