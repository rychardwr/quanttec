import { Classification } from '../routing/routingPolicy';
import { DepartmentCity } from '../routing/serviceScope';
import { InboundMessage } from '../whatsapp/inboundPayload';

/** AUTO: the AI is still triaging. MANUAL: handed to a human, no more automatic replies. */
export type TriageMode = 'AUTO' | 'MANUAL';

export interface TicketState {
  readonly id: string;
  readonly departmentCode: string | null;
  readonly triageMode: TriageMode;
}

export interface RecordedInbound {
  readonly messageId: string;
  readonly ticket: TicketState;
  /** True when this wa_message_id was already fully processed (Meta re-delivery). */
  readonly alreadyProcessed: boolean;
}

export interface ConversationRepository {
  /**
   * In one transaction: upserts the customer (refreshing the 24h window),
   * reuses the open ticket or opens one, and inserts the message. Idempotent
   * per waMessageId: a re-delivery returns the existing message.
   */
  recordInbound(message: InboundMessage, redactedText: string | null): Promise<RecordedInbound>;
  saveCustomerCpf(waId: string, encryptedCpf: Buffer, cpfHash: Buffer): Promise<void>;
  /** Redacted texts of the ticket's inbound text messages, oldest first. */
  listInboundTexts(ticketId: string): Promise<string[]>;
  loadCoverage(): Promise<DepartmentCity[]>;
  assignDepartment(ticketId: string, target: DepartmentCity): Promise<void>;
  handToHuman(ticketId: string): Promise<void>;
  markProcessed(messageId: string): Promise<void>;
}

export interface ConversationClassifier {
  /** Receives only redacted texts (CPFs already masked). */
  classify(conversation: readonly string[]): Promise<Classification>;
}

/** Sends a text to the customer and records it as an outbound message of the ticket. */
export interface CustomerReplier {
  reply(ticketId: string, waId: string, text: string): Promise<void>;
}

export interface Logger {
  warn(message: string): void;
}
