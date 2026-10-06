import { createHmac } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../src/shared/config';
import { parseServiceScope } from '../src/modules/routing/serviceScope';
import { inboundQueueOutput, receiveWebhook, verifyWebhook } from '../src/modules/whatsapp/webhookController';

const config: AppConfig = {
  metaAppSecret: 'test-secret',
  metaVerifyToken: 'test-verify-token',
  serviceScope: parseServiceScope('FINANCEIRO:ITARARE'),
};
const URL_BASE = 'http://localhost/api/v1/whatsapp/webhook';

function sign(body: string, secret = config.metaAppSecret): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function postRequest(body: string, signature?: string): HttpRequest {
  return new HttpRequest({
    method: 'POST',
    url: URL_BASE,
    body: { string: body },
    headers: signature ? { 'x-hub-signature-256': signature } : {},
  });
}

describe('verifyWebhook', () => {
  it('echoes the challenge when the token matches', () => {
    const request = new HttpRequest({
      method: 'GET',
      url: `${URL_BASE}?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345`,
    });
    expect(verifyWebhook(request, config)).toEqual({ status: 200, body: '12345' });
  });

  it('refuses a wrong token', () => {
    const request = new HttpRequest({
      method: 'GET',
      url: `${URL_BASE}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`,
    });
    expect(verifyWebhook(request, config).status).toBe(403);
  });
});

describe('receiveWebhook', () => {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('enqueues a correctly signed payload', async () => {
    const context = new InvocationContext();
    const response = await receiveWebhook(postRequest(payload, sign(payload)), context, config);

    expect(response.status).toBe(200);
    expect(context.extraOutputs.get(inboundQueueOutput)).toBe(payload);
  });

  it.each([
    ['missing signature', undefined],
    ['signature with another secret', sign(payload, 'other-secret')],
    ['malformed signature', 'sha256=zz'],
    ['signature without prefix', sign(payload).slice('sha256='.length)],
  ])('rejects %s without enqueuing', async (_label, signature) => {
    const context = new InvocationContext();
    const response = await receiveWebhook(postRequest(payload, signature), context, config);

    expect(response.status).toBe(401);
    expect(context.extraOutputs.get(inboundQueueOutput)).toBeUndefined();
  });

  it('rejects a payload altered after signing', async () => {
    const context = new InvocationContext();
    const tampered = payload.replace('[]', '[{}]');
    const response = await receiveWebhook(postRequest(tampered, sign(payload)), context, config);

    expect(response.status).toBe(401);
  });
});
