import { app } from '@azure/functions';
import { getConfig } from '../shared/config';
import { inboundQueueOutput, receiveWebhook, verifyWebhook } from '../modules/whatsapp/webhookController';

const WEBHOOK_ROUTE = 'v1/whatsapp/webhook';

app.http('whatsappWebhookVerify', {
  methods: ['GET'],
  route: WEBHOOK_ROUTE,
  authLevel: 'anonymous',
  handler: async (request) => verifyWebhook(request, getConfig()),
});

app.http('whatsappWebhookReceive', {
  methods: ['POST'],
  route: WEBHOOK_ROUTE,
  authLevel: 'anonymous',
  extraOutputs: [inboundQueueOutput],
  handler: (request, context) => receiveWebhook(request, context, getConfig()),
});
