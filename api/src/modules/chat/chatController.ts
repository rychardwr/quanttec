import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { ChatError, ChatErrorCode, ChatService } from './chatService';
import { validateIntake, validateMessageText } from './intake';
import { ChatMessage } from './ports';
import { PRIVACY_NOTICE } from './privacyNotice';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER_PREFIX = 'Bearer ';

const STATUS_BY_ERROR: Record<ChatErrorCode, number> = {
  option_unavailable: 422,
  session_invalid: 401,
  ticket_not_found: 404,
  ticket_closed: 409,
};

/** Wire format of a message (v1). */
export interface ChatMessageDto {
  readonly seq: number;
  readonly sender: ChatMessage['sender'];
  readonly body: string;
  readonly createdAt: string;
}

export async function getOptions(service: ChatService): Promise<HttpResponseInit> {
  return { status: 200, jsonBody: await service.getOptions() };
}

export async function startConversation(request: HttpRequest, service: ChatService): Promise<HttpResponseInit> {
  const intake = validateIntake(await readJson(request), PRIVACY_NOTICE.version);
  if (!intake.ok) {
    return invalidRequest(intake.invalidFields);
  }
  return handleChatErrors(async () => ({ status: 201, jsonBody: await service.startConversation(intake.value) }));
}

export async function listMessages(request: HttpRequest, service: ChatService): Promise<HttpResponseInit> {
  const ticketId = request.params.ticketId ?? '';
  const afterSeq = Number(request.query.get('after') ?? '0');
  if (!UUID_PATTERN.test(ticketId)) return errorResponse('ticket_not_found');
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) return invalidRequest(['after']);

  return handleChatErrors(async () => {
    const result = await service.listMessages(sessionTokenOf(request), ticketId, afterSeq);
    return { status: 200, jsonBody: { ticket: result.ticket, messages: result.messages.map(toDto) } };
  });
}

export async function postMessage(request: HttpRequest, service: ChatService): Promise<HttpResponseInit> {
  const ticketId = request.params.ticketId ?? '';
  if (!UUID_PATTERN.test(ticketId)) return errorResponse('ticket_not_found');

  const body = await readJson(request);
  const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId : '';
  const text = validateMessageText(body?.text);
  const invalidFields: string[] = [];
  if (!UUID_PATTERN.test(clientMessageId)) invalidFields.push('clientMessageId');
  if (!text.ok || text.value === null) invalidFields.push('text');
  if (invalidFields.length > 0 || !text.ok || text.value === null) return invalidRequest(invalidFields);
  const messageText = text.value;

  return handleChatErrors(async () => {
    const message = await service.postMessage(sessionTokenOf(request), ticketId, clientMessageId, messageText);
    return { status: 201, jsonBody: toDto(message) };
  });
}

async function handleChatErrors(action: () => Promise<HttpResponseInit>): Promise<HttpResponseInit> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ChatError) return errorResponse(error.code);
    throw error;
  }
}

function sessionTokenOf(request: HttpRequest): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : '';
}

async function readJson(request: HttpRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toDto(message: ChatMessage): ChatMessageDto {
  return { seq: message.seq, sender: message.sender, body: message.body, createdAt: message.createdAt.toISOString() };
}

function invalidRequest(fields: readonly string[]): HttpResponseInit {
  return { status: 400, jsonBody: { error: 'invalid_request', fields } };
}

function errorResponse(code: ChatErrorCode): HttpResponseInit {
  return { status: STATUS_BY_ERROR[code], jsonBody: { error: code } };
}
