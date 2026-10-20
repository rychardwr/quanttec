export type InboundMessageType = 'TEXT' | 'OTHER';

/** A customer message extracted from a Meta webhook notification. Carries personal data: never log it. */
export interface InboundMessage {
  readonly waMessageId: string;
  readonly waId: string;
  readonly profileName: string | null;
  readonly sentAt: Date;
  readonly type: InboundMessageType;
  readonly text: string | null;
}

export class InvalidPayloadError extends Error {}

type JsonObject = Record<string, unknown>;

/**
 * Extracts customer messages from a webhook payload (raw JSON string or the
 * object the queue trigger already parsed). Delivery statuses are ignored.
 */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const root = typeof payload === 'string' ? parseJson(payload) : payload;
  if (!isObject(root) || root.object !== 'whatsapp_business_account') {
    throw new InvalidPayloadError('Not a WhatsApp Business webhook payload');
  }

  return arrayOf(root.entry)
    .flatMap((entry) => (isObject(entry) ? arrayOf(entry.changes) : []))
    .flatMap((change) =>
      isObject(change) && change.field === 'messages' && isObject(change.value) ? parseChangeValue(change.value) : [],
    );
}

function parseChangeValue(value: JsonObject): InboundMessage[] {
  const profileNames = new Map<string, string>();
  for (const contact of arrayOf(value.contacts)) {
    if (isObject(contact) && typeof contact.wa_id === 'string' && isObject(contact.profile)) {
      const name = contact.profile.name;
      if (typeof name === 'string') profileNames.set(contact.wa_id, name);
    }
  }
  return arrayOf(value.messages).map((message) => parseMessage(message, profileNames));
}

function parseMessage(message: unknown, profileNames: ReadonlyMap<string, string>): InboundMessage {
  if (
    !isObject(message) ||
    typeof message.id !== 'string' ||
    typeof message.from !== 'string' ||
    typeof message.timestamp !== 'string'
  ) {
    throw new InvalidPayloadError('Message without id, from or timestamp');
  }

  const epochSeconds = Number(message.timestamp);
  if (!Number.isFinite(epochSeconds)) {
    throw new InvalidPayloadError('Message with invalid timestamp');
  }

  const text = message.type === 'text' && isObject(message.text) && typeof message.text.body === 'string'
    ? message.text.body
    : null;

  return {
    waMessageId: message.id,
    waId: message.from,
    profileName: profileNames.get(message.from) ?? null,
    sentAt: new Date(epochSeconds * 1000),
    type: text === null ? 'OTHER' : 'TEXT',
    text,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidPayloadError('Payload is not valid JSON');
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
