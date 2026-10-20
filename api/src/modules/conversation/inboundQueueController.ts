import { InboundMessage, InvalidPayloadError, parseInboundMessages } from '../whatsapp/inboundPayload';
import { Logger } from './ports';

export interface InboundMessageHandler {
  handle(message: InboundMessage): Promise<void>;
}

/**
 * Consumes one queued webhook payload. A malformed payload is discarded, since
 * retrying cannot fix it. Any other error propagates so the queue retries,
 * and after maxDequeueCount the payload lands in the poison queue.
 * Messages run in order; already processed ones are skipped by the handler.
 */
export async function processInboundQueueItem(
  queueItem: unknown,
  handler: InboundMessageHandler,
  logger: Logger,
): Promise<void> {
  let messages: InboundMessage[];
  try {
    messages = parseInboundMessages(queueItem);
  } catch (error) {
    if (error instanceof InvalidPayloadError) {
      logger.warn(`Discarded inbound WhatsApp payload: ${error.message}`);
      return;
    }
    throw error;
  }

  for (const message of messages) {
    await handler.handle(message);
  }
}
