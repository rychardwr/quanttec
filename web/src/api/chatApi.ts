// Client of the chat API (v1). Types mirror the API DTOs, never the database.

export interface OfferedCity {
  readonly code: string;
  readonly name: string;
}

export interface OfferedDepartment {
  readonly code: string;
  readonly name: string;
  readonly cities: readonly OfferedCity[];
}

export interface ChatOptions {
  readonly departments: readonly OfferedDepartment[];
  readonly privacyNotice: { readonly version: string; readonly text: string };
}

export interface IntakeForm {
  readonly departmentCode: string;
  readonly cityCode: string;
  readonly fullName: string;
  readonly phone: string;
  readonly cpf: string;
  readonly rg: string;
  readonly consentVersion: string;
  readonly firstMessage: string;
}

/** What the browser keeps to come back to the conversation. */
export interface ChatSession {
  readonly sessionToken: string;
  readonly ticketId: string;
  readonly ticketNumber: number;
}

export type MessageSender = 'CUSTOMER' | 'ATTENDANT' | 'SYSTEM';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';

export interface ChatMessage {
  readonly seq: number;
  readonly sender: MessageSender;
  readonly body: string;
  readonly createdAt: string;
}

export interface TicketMessages {
  readonly ticket: { readonly number: number; readonly status: TicketStatus };
  readonly messages: readonly ChatMessage[];
}

export interface ChatApi {
  getOptions(): Promise<ChatOptions>;
  startConversation(form: IntakeForm): Promise<ChatSession>;
  listMessages(session: ChatSession, afterSeq: number): Promise<TicketMessages>;
  postMessage(session: ChatSession, clientMessageId: string, text: string): Promise<ChatMessage>;
}

/** status 0 means the request did not reach the server. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: readonly string[] = [],
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:7071/api').replace(/\/$/, '');
const CHAT_URL = `${API_BASE_URL}/v1/chat`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CHAT_URL}${path}`, init);
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: string[] };
    throw new ApiError(response.status, body.error ?? 'unknown', body.fields ?? []);
  }
  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown, session?: ChatSession): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.sessionToken}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

export const chatApi: ChatApi = {
  getOptions: () => request<ChatOptions>('/options'),

  startConversation: (form) => request<ChatSession>('/conversations', jsonInit('POST', form)),

  listMessages: (session, afterSeq) =>
    request<TicketMessages>(`/tickets/${encodeURIComponent(session.ticketId)}/messages?after=${afterSeq}`, {
      headers: { authorization: `Bearer ${session.sessionToken}` },
    }),

  postMessage: (session, clientMessageId, text) =>
    request<ChatMessage>(
      `/tickets/${encodeURIComponent(session.ticketId)}/messages`,
      jsonInit('POST', { clientMessageId, text }, session),
    ),
};
