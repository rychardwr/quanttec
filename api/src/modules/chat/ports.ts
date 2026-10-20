import { CatalogEntry } from '../routing/catalog';
import { DepartmentCity } from '../routing/serviceScope';

export type MessageSender = 'CUSTOMER' | 'ATTENDANT' | 'SYSTEM';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED';

export interface ChatMessage {
  /** Increasing position; the polling cursor. */
  readonly seq: number;
  readonly sender: MessageSender;
  readonly body: string;
  readonly createdAt: Date;
}

export interface NewConversation {
  readonly customer: {
    readonly fullName: string;
    readonly phone: string;
    readonly encryptedCpf: Buffer;
    readonly cpfHash: Buffer;
    readonly encryptedRg: Buffer;
    readonly consentVersion: string;
    readonly consentAt: Date;
  };
  readonly session: { readonly tokenHash: Buffer; readonly expiresAt: Date };
  readonly target: DepartmentCity;
  /** Built once the ticket number is known. */
  readonly welcomeMessage: (ticketNumber: number) => string;
  /** Already redacted. */
  readonly firstMessage: string | null;
}

export interface CreatedConversation {
  readonly ticketId: string;
  readonly ticketNumber: number;
}

export interface CustomerTicket {
  readonly id: string;
  readonly number: number;
  readonly status: TicketStatus;
}

export interface ChatRepository {
  loadCatalog(): Promise<CatalogEntry[]>;
  /** In one transaction: customer, session, ticket, welcome message and the optional first message. */
  createConversation(conversation: NewConversation): Promise<CreatedConversation>;
  /** The customer of a session that has not expired, or null. */
  findSessionCustomer(tokenHash: Buffer, now: Date): Promise<string | null>;
  /** The ticket, only when it belongs to the customer. */
  findCustomerTicket(customerId: string, ticketId: string): Promise<CustomerTicket | null>;
  /** Idempotent per (ticket, clientMessageId): a retry returns the message already stored. */
  addCustomerMessage(ticketId: string, clientMessageId: string, body: string): Promise<ChatMessage>;
  listMessages(ticketId: string, afterSeq: number, limit: number): Promise<ChatMessage[]>;
}
