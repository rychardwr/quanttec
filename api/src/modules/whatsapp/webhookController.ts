import { HttpRequest, HttpResponseInit, InvocationContext, output } from '@azure/functions';
import { AppConfig } from '../../shared/config';
import { isValidMetaSignature } from './signature';

export const INBOUND_QUEUE_NAME = 'whatsapp-inbound';

/** Messages that fail `maxDequeueCount` times (host.json) land in `whatsapp-inbound-poison` (dead-letter). */
export const inboundQueueOutput = output.storageQueue({
  queueName: INBOUND_QUEUE_NAME,
  connection: 'AzureWebJobsStorage',
});

/** Handshake Meta performs when the webhook URL is registered. */
export function verifyWebhook(request: HttpRequest, config: AppConfig): HttpResponseInit {
  const isSubscription = request.query.get('hub.mode') === 'subscribe';
  const tokenMatches = request.query.get('hub.verify_token') === config.metaVerifyToken;
  if (isSubscription && tokenMatches) {
    return { status: 200, body: request.query.get('hub.challenge') ?? '' };
  }
  return { status: 403 };
}

/**
 * Accepts a notification only after verifying its signature, then enqueues the
 * raw payload and answers 200 right away. Processing (idempotency by
 * message_id, AI triage, ticket creation) happens in the queue consumer.
 * The body is never logged: it carries personal data.
 */
export async function receiveWebhook(
  request: HttpRequest,
  context: InvocationContext,
  config: AppConfig,
): Promise<HttpResponseInit> {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get('x-hub-signature-256');

  if (!isValidMetaSignature(rawBody, signature, config.metaAppSecret)) {
    context.warn('Rejected WhatsApp webhook: invalid signature');
    return { status: 401 };
  }

  context.extraOutputs.set(inboundQueueOutput, rawBody.toString('utf8'));
  return { status: 200 };
}
