import { describe, expect, it, vi } from 'vitest';
import { InboundMessageService, MAX_AUTO_TRIAGE_MESSAGES } from '../src/modules/conversation/inboundMessageService';
import { processInboundQueueItem } from '../src/modules/conversation/inboundQueueController';
import {
  ConversationClassifier,
  ConversationRepository,
  RecordedInbound,
  TriageMode,
} from '../src/modules/conversation/ports';
import { REPLIES } from '../src/modules/conversation/replies';
import { CPF_MASK } from '../src/modules/privacy/cpfRedaction';
import { FieldCipher } from '../src/modules/privacy/fieldCipher';
import { Classification } from '../src/modules/routing/routingPolicy';
import { DepartmentCity, parseServiceScope } from '../src/modules/routing/serviceScope';
import { InboundMessage } from '../src/modules/whatsapp/inboundPayload';

const WA_ID = '5515999990000';
const VALID_CPF = '52998224725';
const FINANCEIRO_ITARARE: DepartmentCity = { departmentCode: 'FINANCEIRO', cityCode: 'ITARARE' };

class InMemoryConversationRepository implements ConversationRepository {
  departmentCode: string | null = null;
  triageMode: TriageMode = 'AUTO';
  savedCpf: { encrypted: Buffer; hash: Buffer } | null = null;
  readonly messages = new Map<string, { id: string; text: string | null; processed: boolean }>();
  readonly coverage: DepartmentCity[] = [FINANCEIRO_ITARARE, { departmentCode: 'FINANCEIRO', cityCode: 'SENGES' }];

  async recordInbound(message: InboundMessage, redactedText: string | null): Promise<RecordedInbound> {
    let stored = this.messages.get(message.waMessageId);
    const alreadyRecorded = stored !== undefined;
    if (!stored) {
      stored = { id: `msg-${this.messages.size + 1}`, text: redactedText, processed: false };
      this.messages.set(message.waMessageId, stored);
    }
    return {
      messageId: stored.id,
      ticket: { id: 'ticket-1', departmentCode: this.departmentCode, triageMode: this.triageMode },
      alreadyProcessed: alreadyRecorded && stored.processed,
    };
  }
  async saveCustomerCpf(_waId: string, encrypted: Buffer, hash: Buffer) {
    this.savedCpf = { encrypted, hash };
  }
  async listInboundTexts() {
    return [...this.messages.values()].flatMap((message) => (message.text === null ? [] : [message.text]));
  }
  async loadCoverage() {
    return this.coverage;
  }
  async assignDepartment(_ticketId: string, target: DepartmentCity) {
    this.departmentCode = target.departmentCode;
  }
  async handToHuman() {
    this.triageMode = 'MANUAL';
  }
  async markProcessed(messageId: string) {
    for (const message of this.messages.values()) {
      if (message.id === messageId) message.processed = true;
    }
  }
}

let messageCounter = 0;
function textMessage(text: string | null, waMessageId = `wamid.${++messageCounter}`): InboundMessage {
  return { waMessageId, waId: WA_ID, profileName: null, sentAt: new Date(), type: text === null ? 'OTHER' : 'TEXT', text };
}

function classifierReturning(classification: Classification): ConversationClassifier {
  return { classify: vi.fn(async () => classification) };
}

function setup(classifier: ConversationClassifier = classifierReturning({ departmentCode: 'FINANCEIRO', cityCode: 'ITARARE' })) {
  const repository = new InMemoryConversationRepository();
  const replies: string[] = [];
  const replier = { reply: vi.fn(async (_ticketId: string, _waId: string, text: string) => void replies.push(text)) };
  const logger = { warn: vi.fn() };
  const cipher = new FieldCipher(Buffer.alloc(32, 1), Buffer.alloc(32, 2));
  const service = new InboundMessageService({
    repository,
    classifier,
    replier,
    cipher,
    scope: parseServiceScope('FINANCEIRO:ITARARE'),
    classifierTimeoutMs: 50,
    logger,
  });
  return { service, repository, replies, replier, logger, cipher, classifier };
}

describe('InboundMessageService', () => {
  it('routes a ticket the AI classifies within the pilot', async () => {
    const { service, repository, replies } = setup();

    await service.handle(textMessage('Preciso de uma segunda via de boleto, sou de Itararé'));

    expect(repository.departmentCode).toBe('FINANCEIRO');
    expect(replies).toEqual([REPLIES.routed]);
    expect([...repository.messages.values()][0]!.processed).toBe(true);
  });

  it('stores the text with the CPF masked and the CPF itself encrypted', async () => {
    const { service, repository, cipher, classifier } = setup();

    await service.handle(textMessage(`meu cpf é ${VALID_CPF}`));

    const storedText = [...repository.messages.values()][0]!.text;
    expect(storedText).toBe(`meu cpf é ${CPF_MASK}`);
    expect(classifier.classify).toHaveBeenCalledWith([`meu cpf é ${CPF_MASK}`]);
    expect(cipher.decrypt(repository.savedCpf!.encrypted)).toBe(VALID_CPF);
    expect(repository.savedCpf!.hash.equals(cipher.hash(VALID_CPF))).toBe(true);
  });

  it('ignores a re-delivery of a processed message', async () => {
    const { service, replies, classifier } = setup();
    const message = textMessage('Boleto, Itararé');

    await service.handle(message);
    await service.handle(message);

    expect(replies).toHaveLength(1);
    expect(classifier.classify).toHaveBeenCalledTimes(1);
  });

  it('resumes a message whose processing failed midway', async () => {
    const { service, replies, replier } = setup();
    const message = textMessage('Boleto, Itararé');
    replier.reply.mockRejectedValueOnce(new Error('Meta unavailable'));

    await expect(service.handle(message)).rejects.toThrow('Meta unavailable');
    await service.handle(message);

    expect(replies).toEqual([REPLIES.routed]);
  });

  it('hands the ticket to a human when the AI fails, without logging its message', async () => {
    const failing = { classify: vi.fn(async () => Promise.reject(new Error(`echo: ${VALID_CPF}`))) };
    const { service, repository, replies, logger } = setup(failing);

    await service.handle(textMessage('Olá'));

    expect(repository.triageMode).toBe('MANUAL');
    expect(replies).toEqual([REPLIES.handedToHuman]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).not.toContain(VALID_CPF);
  });

  it('hands the ticket to a human when the AI times out', async () => {
    const hanging = { classify: vi.fn(() => new Promise<Classification>(() => {})) };
    const { service, repository, replies } = setup(hanging);

    await service.handle(textMessage('Olá'));

    expect(repository.triageMode).toBe('MANUAL');
    expect(replies).toEqual([REPLIES.handedToHuman]);
  });

  it('asks for the missing city and keeps triaging automatically', async () => {
    const { service, repository, replies } = setup(classifierReturning({ departmentCode: 'FINANCEIRO', cityCode: null }));

    await service.handle(textMessage('Preciso de um boleto'));

    expect(replies).toEqual([REPLIES.askCity]);
    expect(repository.triageMode).toBe('AUTO');
    expect(repository.departmentCode).toBeNull();
  });

  it('asks for the subject without calling the AI when the message has no text', async () => {
    const { service, replies, classifier } = setup();

    await service.handle(textMessage(null));

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(replies).toEqual([REPLIES.askDepartmentAndCity]);
  });

  it.each([
    ['outside the pilot', { departmentCode: 'FINANCEIRO', cityCode: 'SENGES' }],
    ['not served', { departmentCode: 'MEDICINA', cityCode: 'TAQUARITUBA' }],
  ])('hands a ticket %s to a human', async (_label, classification) => {
    const { service, repository, replies } = setup(classifierReturning(classification));

    await service.handle(textMessage('Olá'));

    expect(repository.triageMode).toBe('MANUAL');
    expect(repository.departmentCode).toBeNull();
    expect(replies).toEqual([REPLIES.handedToHuman]);
  });

  it(`hands to a human after ${MAX_AUTO_TRIAGE_MESSAGES} messages without classification`, async () => {
    const { service, repository, replies, classifier } = setup(classifierReturning({ departmentCode: null, cityCode: null }));

    for (let i = 0; i <= MAX_AUTO_TRIAGE_MESSAGES; i++) {
      await service.handle(textMessage(`mensagem ${i}`));
    }

    expect(classifier.classify).toHaveBeenCalledTimes(MAX_AUTO_TRIAGE_MESSAGES);
    expect(repository.triageMode).toBe('MANUAL');
    expect(replies.at(-1)).toBe(REPLIES.handedToHuman);
  });

  it.each([
    ['already routed', { departmentCode: 'FINANCEIRO', triageMode: 'AUTO' as const }],
    ['handed to a human', { departmentCode: null, triageMode: 'MANUAL' as const }],
  ])('does not reply automatically on a ticket %s', async (_label, state) => {
    const { service, repository, replies, classifier } = setup();
    repository.departmentCode = state.departmentCode;
    repository.triageMode = state.triageMode;

    await service.handle(textMessage('Alguma novidade?'));

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
    expect([...repository.messages.values()][0]!.processed).toBe(true);
  });
});

describe('processInboundQueueItem', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                { from: WA_ID, id: 'wamid.a', timestamp: '1760000000', type: 'text', text: { body: 'primeira' } },
                { from: WA_ID, id: 'wamid.b', timestamp: '1760000001', type: 'text', text: { body: 'segunda' } },
              ],
            },
          },
        ],
      },
    ],
  };

  it('handles every message in order', async () => {
    const handled: string[] = [];
    const handler = { handle: async (message: InboundMessage) => void handled.push(message.waMessageId) };

    await processInboundQueueItem(payload, handler, { warn: vi.fn() });

    expect(handled).toEqual(['wamid.a', 'wamid.b']);
  });

  it('discards a malformed payload instead of retrying it', async () => {
    const handler = { handle: vi.fn() };
    const logger = { warn: vi.fn() };

    await expect(processInboundQueueItem('{oops', handler, logger)).resolves.toBeUndefined();

    expect(handler.handle).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('lets handler errors propagate so the queue retries', async () => {
    const handler = { handle: vi.fn(async () => Promise.reject(new Error('database down'))) };

    await expect(processInboundQueueItem(payload, handler, { warn: vi.fn() })).rejects.toThrow('database down');
  });
});
