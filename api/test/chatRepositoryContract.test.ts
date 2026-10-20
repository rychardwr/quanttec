import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { InMemoryChatRepository } from '../src/modules/chat/inMemoryChatRepository';
import { ChatRepository, NewConversation } from '../src/modules/chat/ports';
import { SqlChatRepository } from '../src/modules/chat/sqlChatRepository';

// The same behavior is required from the in-memory fake and from Azure SQL.
// The SQL run needs a migrated database: set TEST_SQL_CONNECTION_STRING
// (never production). Without it, only the in-memory run executes.
const sqlConnectionString = process.env.TEST_SQL_CONNECTION_STRING;

function newConversation(overrides: Partial<NewConversation> = {}): NewConversation {
  return {
    customer: {
      fullName: 'Cliente Teste',
      phone: '5515999990000',
      encryptedCpf: randomBytes(40),
      cpfHash: randomBytes(32),
      encryptedRg: randomBytes(38),
      consentVersion: '2026-10-20',
      consentAt: new Date(),
    },
    session: { tokenHash: randomBytes(32), expiresAt: new Date(Date.now() + 60_000) },
    target: { departmentCode: 'FINANCEIRO', cityCode: 'ITARARE' },
    welcomeMessage: (ticketNumber) => `protocolo ${ticketNumber}`,
    firstMessage: 'primeira mensagem',
    ...overrides,
  };
}

function contract(name: string, createRepository: () => ChatRepository) {
  describe(`ChatRepository contract: ${name}`, () => {
    const repository = createRepository();

    afterAll(async () => {
      if (repository instanceof SqlChatRepository) await repository.close();
    });

    it('loads the catalog with display names', async () => {
      const catalog = await repository.loadCatalog();
      expect(catalog).toContainEqual({
        departmentCode: 'FINANCEIRO',
        departmentName: 'Financeiro',
        cityCode: 'ITARARE',
        cityName: 'Itararé',
      });
    });

    it('creates a conversation with the welcome and first messages, in order', async () => {
      const conversation = newConversation();
      const created = await repository.createConversation(conversation);

      const customerId = await repository.findSessionCustomer(conversation.session.tokenHash, new Date());
      expect(customerId).not.toBeNull();
      const ticket = await repository.findCustomerTicket(customerId!, created.ticketId);
      expect(ticket).toEqual({ id: created.ticketId, number: created.ticketNumber, status: 'OPEN' });

      const messages = await repository.listMessages(created.ticketId, 0, 100);
      expect(messages.map((message) => [message.sender, message.body])).toEqual([
        ['SYSTEM', `protocolo ${created.ticketNumber}`],
        ['CUSTOMER', 'primeira mensagem'],
      ]);
      expect(messages[0]!.seq).toBeLessThan(messages[1]!.seq);
    });

    it('rejects a pair outside the catalog and keeps nothing', async () => {
      const conversation = newConversation({ target: { departmentCode: 'MEDICINA', cityCode: 'TAQUARITUBA' } });
      await expect(repository.createConversation(conversation)).rejects.toThrow();
      expect(await repository.findSessionCustomer(conversation.session.tokenHash, new Date())).toBeNull();
    });

    it('ignores expired and unknown sessions', async () => {
      const expired = newConversation({ session: { tokenHash: randomBytes(32), expiresAt: new Date(Date.now() - 1000) } });
      await repository.createConversation(expired);
      expect(await repository.findSessionCustomer(expired.session.tokenHash, new Date())).toBeNull();
      expect(await repository.findSessionCustomer(randomBytes(32), new Date())).toBeNull();
    });

    it("does not return another customer's ticket", async () => {
      const mine = newConversation();
      const theirs = await repository.createConversation(newConversation());
      await repository.createConversation(mine);
      const myCustomerId = await repository.findSessionCustomer(mine.session.tokenHash, new Date());

      expect(await repository.findCustomerTicket(myCustomerId!, theirs.ticketId)).toBeNull();
      expect(await repository.findCustomerTicket(myCustomerId!, randomUUID())).toBeNull();
    });

    it('stores a customer message once per client id and pages after a cursor', async () => {
      const created = await repository.createConversation(newConversation({ firstMessage: null }));
      const clientMessageId = randomUUID();

      const first = await repository.addCustomerMessage(created.ticketId, clientMessageId, 'oi');
      const retry = await repository.addCustomerMessage(created.ticketId, clientMessageId, 'oi');
      expect(retry).toEqual(first);

      const all = await repository.listMessages(created.ticketId, 0, 100);
      expect(all.map((message) => message.body)).toEqual([`protocolo ${created.ticketNumber}`, 'oi']);
      expect(await repository.listMessages(created.ticketId, first.seq, 100)).toEqual([]);
      expect(await repository.listMessages(created.ticketId, 0, 1)).toHaveLength(1);
    });
  });
}

contract('in-memory', () => new InMemoryChatRepository());

if (sqlConnectionString) {
  contract('Azure SQL', () => new SqlChatRepository(sqlConnectionString));
} else {
  describe.skip('ChatRepository contract: Azure SQL (set TEST_SQL_CONNECTION_STRING)', () => {
    it('needs a database', () => {});
  });
}
