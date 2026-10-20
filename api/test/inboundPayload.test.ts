import { describe, expect, it } from 'vitest';
import { InvalidPayloadError, parseInboundMessages } from '../src/modules/whatsapp/inboundPayload';

function payloadWith(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'messages', value }] }],
  };
}

const textMessage = {
  from: '5515999990000',
  id: 'wamid.1',
  timestamp: '1760000000',
  type: 'text',
  text: { body: 'Olá, preciso de ajuda' },
};

describe('parseInboundMessages', () => {
  it('extracts a text message with the contact profile name', () => {
    const payload = payloadWith({
      contacts: [{ wa_id: '5515999990000', profile: { name: 'Cliente Teste' } }],
      messages: [textMessage],
    });

    expect(parseInboundMessages(payload)).toEqual([
      {
        waMessageId: 'wamid.1',
        waId: '5515999990000',
        profileName: 'Cliente Teste',
        sentAt: new Date(1760000000 * 1000),
        type: 'TEXT',
        text: 'Olá, preciso de ajuda',
      },
    ]);
  });

  it('accepts the raw JSON string', () => {
    const raw = JSON.stringify(payloadWith({ messages: [textMessage] }));
    expect(parseInboundMessages(raw)).toHaveLength(1);
  });

  it('maps non-text messages to OTHER without text', () => {
    const audio = { from: '5515999990000', id: 'wamid.2', timestamp: '1760000000', type: 'audio', audio: { id: 'm' } };
    const [message] = parseInboundMessages(payloadWith({ messages: [audio] }));
    expect(message).toMatchObject({ type: 'OTHER', text: null, profileName: null });
  });

  it('ignores delivery status notifications', () => {
    const payload = payloadWith({ statuses: [{ id: 'wamid.9', status: 'delivered' }] });
    expect(parseInboundMessages(payload)).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['another object type', { object: 'page', entry: [] }],
    ['message without id', payloadWith({ messages: [{ ...textMessage, id: undefined }] })],
    ['invalid timestamp', payloadWith({ messages: [{ ...textMessage, timestamp: 'ontem' }] })],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseInboundMessages(payload)).toThrow(InvalidPayloadError);
  });
});
