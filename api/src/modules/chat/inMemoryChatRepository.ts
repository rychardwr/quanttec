import { randomUUID } from 'node:crypto';
import { CatalogEntry } from '../routing/catalog';
import { sameDepartmentCity } from '../routing/serviceScope';
import {
  ChatMessage,
  ChatRepository,
  CreatedConversation,
  CustomerTicket,
  MessageSender,
  NewConversation,
} from './ports';

/** Same catalog as db/migrations/0002_reference_data.sql, for local runs without a database. */
export const DEFAULT_CATALOG: readonly CatalogEntry[] = [
  { departmentCode: 'FINANCEIRO', departmentName: 'Financeiro', cityCode: 'ITARARE', cityName: 'Itararé' },
  { departmentCode: 'FINANCEIRO', departmentName: 'Financeiro', cityCode: 'SENGES', cityName: 'Sengés' },
  { departmentCode: 'FINANCEIRO', departmentName: 'Financeiro', cityCode: 'TAQUARITUBA', cityName: 'Taquarituba' },
  { departmentCode: 'MEDICINA', departmentName: 'Medicina', cityCode: 'ITARARE', cityName: 'Itararé' },
  { departmentCode: 'MEDICINA', departmentName: 'Medicina', cityCode: 'SENGES', cityName: 'Sengés' },
  { departmentCode: 'SEGURANCA', departmentName: 'Segurança', cityCode: 'ITARARE', cityName: 'Itararé' },
  { departmentCode: 'SEGURANCA', departmentName: 'Segurança', cityCode: 'TAQUARITUBA', cityName: 'Taquarituba' },
];

interface StoredMessage extends ChatMessage {
  readonly ticketId: string;
  readonly clientMessageId: string | null;
}

/**
 * Process-local ChatRepository for tests and local development only. Data is
 * lost on restart, and the configuration refuses it when running in Azure.
 */
export class InMemoryChatRepository implements ChatRepository {
  private readonly customers = new Map<string, NewConversation['customer']>();
  private readonly sessions = new Map<string, { customerId: string; expiresAt: Date }>();
  private readonly tickets = new Map<string, CustomerTicket & { customerId: string }>();
  private readonly messages: StoredMessage[] = [];
  private nextTicketNumber = 1000;
  private nextSeq = 1;

  constructor(private readonly catalog: readonly CatalogEntry[] = DEFAULT_CATALOG) {}

  async loadCatalog(): Promise<CatalogEntry[]> {
    return [...this.catalog];
  }

  async createConversation(conversation: NewConversation): Promise<CreatedConversation> {
    if (!this.catalog.some((entry) => sameDepartmentCity(entry, conversation.target))) {
      throw new Error('Department/city pair is not in the catalog');
    }
    const customerId = randomUUID();
    this.customers.set(customerId, conversation.customer);
    this.sessions.set(conversation.session.tokenHash.toString('hex'), {
      customerId,
      expiresAt: conversation.session.expiresAt,
    });

    const ticket = { id: randomUUID(), number: this.nextTicketNumber++, status: 'OPEN' as const, customerId };
    this.tickets.set(ticket.id, ticket);
    this.store(ticket.id, 'SYSTEM', conversation.welcomeMessage(ticket.number), null);
    if (conversation.firstMessage !== null) {
      this.store(ticket.id, 'CUSTOMER', conversation.firstMessage, null);
    }
    return { ticketId: ticket.id, ticketNumber: ticket.number };
  }

  async findSessionCustomer(tokenHash: Buffer, now: Date): Promise<string | null> {
    const session = this.sessions.get(tokenHash.toString('hex'));
    return session && session.expiresAt > now ? session.customerId : null;
  }

  async findCustomerTicket(customerId: string, ticketId: string): Promise<CustomerTicket | null> {
    const ticket = this.tickets.get(ticketId.toLowerCase());
    if (!ticket || ticket.customerId !== customerId) return null;
    return { id: ticket.id, number: ticket.number, status: ticket.status };
  }

  async addCustomerMessage(ticketId: string, clientMessageId: string, body: string): Promise<ChatMessage> {
    const existing = this.messages.find(
      (message) => message.ticketId === ticketId && message.clientMessageId === clientMessageId.toLowerCase(),
    );
    return toChatMessage(existing ?? this.store(ticketId, 'CUSTOMER', body, clientMessageId.toLowerCase()));
  }

  async listMessages(ticketId: string, afterSeq: number, limit: number): Promise<ChatMessage[]> {
    return this.messages
      .filter((message) => message.ticketId === ticketId && message.seq > afterSeq)
      .slice(0, limit)
      .map(toChatMessage);
  }

  /** Test helper: moves a ticket to another status. */
  setTicketStatus(ticketId: string, status: CustomerTicket['status']): void {
    const ticket = this.tickets.get(ticketId);
    if (ticket) this.tickets.set(ticketId, { ...ticket, status });
  }

  private store(ticketId: string, sender: MessageSender, body: string, clientMessageId: string | null): StoredMessage {
    const message = { ticketId, clientMessageId, seq: this.nextSeq++, sender, body, createdAt: new Date() };
    this.messages.push(message);
    return message;
  }
}

function toChatMessage({ seq, sender, body, createdAt }: StoredMessage): ChatMessage {
  return { seq, sender, body, createdAt };
}
