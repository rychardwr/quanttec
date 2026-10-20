import { ChatSession } from '../api/chatApi';

const STORAGE_KEY = 'quanttec.chat.session';

// The token lets the customer come back to the conversation from the same
// browser. Storage can be unavailable (private mode, blocked cookies): then the
// chat still works, only without coming back later.

export function loadSession(): ChatSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<ChatSession>;
    return typeof session.sessionToken === 'string' &&
      typeof session.ticketId === 'string' &&
      typeof session.ticketNumber === 'number'
      ? (session as ChatSession)
      : null;
  } catch {
    return null;
  }
}

export function saveSession(session: ChatSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Not persisted: the conversation lasts while the page is open.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
