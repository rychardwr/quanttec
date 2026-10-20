import { randomUUID } from 'node:crypto';
import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { getOptions, listMessages, postMessage, startConversation } from '../src/modules/chat/chatController';
import { ChatService } from '../src/modules/chat/chatService';
import { InMemoryChatRepository } from '../src/modules/chat/inMemoryChatRepository';
import { PRIVACY_NOTICE } from '../src/modules/chat/privacyNotice';
import { CPF_MASK } from '../src/modules/privacy/cpfRedaction';
import { FieldCipher } from '../src/modules/privacy/fieldCipher';
import { parseServiceScope } from '../src/modules/routing/serviceScope';

const BASE = 'http://localhost/api/v1/chat';
const VALID_CPF = '52998224725';
const form = {
  departmentCode: 'FINANCEIRO',
  cityCode: 'ITARARE',
  fullName: 'Maria da Silva',
  phone: '15999990000',
  cpf: VALID_CPF,
  rg: '123456789',
  consentVersion: PRIVACY_NOTICE.version,
  firstMessage: `Preciso de um boleto, meu CPF é ${VALID_CPF}`,
};

function setup(now = () => new Date()) {
  const repository = new InMemoryChatRepository();
  const cipher = new FieldCipher(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
  const service = new ChatService({ repository, cipher, scope: parseServiceScope('FINANCEIRO:ITARARE'), clock: now });
  return { service, repository, cipher };
}

function jsonRequest(method: string, url: string, body?: unknown, token?: string): HttpRequest {
  return new HttpRequest({
    method,
    url,
    body: body === undefined ? undefined : { string: JSON.stringify(body) },
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

function messagesRequest(method: 'GET' | 'POST', ticketId: string, token?: string, body?: unknown, after?: number) {
  const query = after === undefined ? '' : `?after=${after}`;
  const request = jsonRequest(method, `${BASE}/tickets/${ticketId}/messages${query}`, body, token);
  (request.params as Record<string, string>).ticketId = ticketId;
  return request;
}

async function start(service: ChatService, body: unknown = form) {
  const response = await startConversation(jsonRequest('POST', `${BASE}/conversations`, body), service);
  return response as HttpResponseInit & {
    jsonBody: { sessionToken: string; ticketId: string; ticketNumber: number; error?: string; fields?: string[] };
  };
}

describe('chat API', () => {
  it('offers only the pilot options and the privacy notice', async () => {
    const { service } = setup();
    const response = await getOptions(service);

    expect(response.status).toBe(200);
    expect(response.jsonBody).toEqual({
      departments: [{ code: 'FINANCEIRO', name: 'Financeiro', cities: [{ code: 'ITARARE', name: 'Itararé' }] }],
      privacyNotice: PRIVACY_NOTICE,
    });
  });

  it('opens a ticket, masks the CPF in the text and keeps it encrypted', async () => {
    const { service } = setup();
    const started = await start(service);

    expect(started.status).toBe(201);
    expect(started.jsonBody.ticketNumber).toBe(1000);

    const listed = await listMessages(messagesRequest('GET', started.jsonBody.ticketId, started.jsonBody.sessionToken), service);
    const { ticket, messages } = listed.jsonBody as { ticket: unknown; messages: { sender: string; body: string }[] };
    expect(ticket).toEqual({ number: 1000, status: 'OPEN' });
    expect(messages.map((message) => message.sender)).toEqual(['SYSTEM', 'CUSTOMER']);
    expect(messages[0]!.body).toContain('protocolo 1000');
    expect(messages[1]!.body).toBe(`Preciso de um boleto, meu CPF é ${CPF_MASK}`);
    expect(JSON.stringify(listed.jsonBody)).not.toContain(VALID_CPF);
  });

  it('answers 400 naming only the invalid fields', async () => {
    const { service } = setup();
    const response = await start(service, { ...form, cpf: '11111111111', consentVersion: 'old' });

    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'invalid_request', fields: ['cpf', 'consent'] });
  });

  it('answers 422 for an option outside the pilot', async () => {
    const { service } = setup();
    const response = await start(service, { ...form, cityCode: 'SENGES' });

    expect(response.status).toBe(422);
    expect(response.jsonBody).toEqual({ error: 'option_unavailable' });
  });

  it('posts a message idempotently and pages with the cursor', async () => {
    const { service } = setup();
    const { jsonBody: started } = await start(service, { ...form, firstMessage: '' });
    const body = { clientMessageId: randomUUID(), text: `cpf ${VALID_CPF}` };

    const first = await postMessage(messagesRequest('POST', started.ticketId, started.sessionToken, body), service);
    const retry = await postMessage(messagesRequest('POST', started.ticketId, started.sessionToken, body), service);
    expect(first.status).toBe(201);
    expect(retry.jsonBody).toEqual(first.jsonBody);
    expect((first.jsonBody as { body: string }).body).toBe(`cpf ${CPF_MASK}`);

    const seq = (first.jsonBody as { seq: number }).seq;
    const after = await listMessages(messagesRequest('GET', started.ticketId, started.sessionToken, undefined, seq), service);
    expect((after.jsonBody as { messages: unknown[] }).messages).toEqual([]);
  });

  it.each([
    ['no token', undefined],
    ['a malformed token', 'abc'],
    ['an unknown token', 'A'.repeat(43)],
  ])('answers 401 with %s', async (_label, token) => {
    const { service } = setup();
    const { jsonBody: started } = await start(service);

    const response = await listMessages(messagesRequest('GET', started.ticketId, token), service);
    expect(response.status).toBe(401);
  });

  it('answers 401 once the session expired', async () => {
    let now = new Date('2026-10-20T12:00:00Z');
    const { service } = setup(() => now);
    const { jsonBody: started } = await start(service);

    now = new Date('2026-11-20T12:00:00Z');
    const response = await listMessages(messagesRequest('GET', started.ticketId, started.sessionToken), service);
    expect(response.status).toBe(401);
  });

  it("answers 404 for another customer's ticket or an invalid id", async () => {
    const { service } = setup();
    const { jsonBody: mine } = await start(service);
    const { jsonBody: theirs } = await start(service);

    expect((await listMessages(messagesRequest('GET', theirs.ticketId, mine.sessionToken), service)).status).toBe(404);
    expect((await listMessages(messagesRequest('GET', 'not-a-uuid', mine.sessionToken), service)).status).toBe(404);
  });

  it('answers 409 when posting to a resolved ticket', async () => {
    const { service, repository } = setup();
    const { jsonBody: started } = await start(service);
    repository.setTicketStatus(started.ticketId, 'RESOLVED');

    const body = { clientMessageId: randomUUID(), text: 'oi' };
    const response = await postMessage(messagesRequest('POST', started.ticketId, started.sessionToken, body), service);
    expect(response.status).toBe(409);
  });

  it('validates the message body', async () => {
    const { service } = setup();
    const { jsonBody: started } = await start(service);

    const response = await postMessage(
      messagesRequest('POST', started.ticketId, started.sessionToken, { clientMessageId: 'x', text: '   ' }),
      service,
    );
    expect(response.status).toBe(400);
    expect(response.jsonBody).toEqual({ error: 'invalid_request', fields: ['clientMessageId', 'text'] });
  });
});
