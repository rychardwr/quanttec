import { redactCpf } from '../privacy/cpfRedaction';
import { FieldCipher } from '../privacy/fieldCipher';
import { offeredDepartments, OfferedDepartment } from '../routing/catalog';
import { decideRouting } from '../routing/routingPolicy';
import { ServiceScope } from '../routing/serviceScope';
import { Intake } from './intake';
import { ChatMessage, ChatRepository, CustomerTicket, TicketStatus } from './ports';
import { PRIVACY_NOTICE } from './privacyNotice';
import { createSessionToken, hashSessionToken, isWellFormedSessionToken, SESSION_TTL_DAYS } from './sessionToken';

export const MESSAGES_PAGE_SIZE = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES: readonly TicketStatus[] = ['RESOLVED', 'CANCELLED'];

export type ChatErrorCode = 'option_unavailable' | 'session_invalid' | 'ticket_not_found' | 'ticket_closed';

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode) {
    super(code);
    this.name = 'ChatError';
  }
}

export interface ChatOptions {
  readonly departments: readonly OfferedDepartment[];
  readonly privacyNotice: { readonly version: string; readonly text: string };
}

export interface StartedConversation {
  readonly sessionToken: string;
  readonly ticketId: string;
  readonly ticketNumber: number;
}

export interface TicketMessages {
  readonly ticket: { readonly number: number; readonly status: TicketStatus };
  readonly messages: readonly ChatMessage[];
}

export interface ChatServiceDeps {
  readonly repository: ChatRepository;
  readonly cipher: FieldCipher;
  readonly scope: ServiceScope;
  readonly clock: () => Date;
}

export function welcomeMessage(ticketNumber: number): string {
  return (
    `Seu atendimento foi aberto com o protocolo ${ticketNumber}. ` +
    'Um atendente vai responder por aqui em breve. ' +
    'Você pode fechar esta página e voltar depois pelo mesmo navegador.'
  );
}

/**
 * The customer side of the web chat. The customer picks department and city
 * from the offered options and fills the intake form; then customer and
 * attendants exchange messages on the ticket. CPFs typed in messages are masked.
 */
export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  async getOptions(): Promise<ChatOptions> {
    const catalog = await this.deps.repository.loadCatalog();
    return { departments: offeredDepartments(catalog, this.deps.scope), privacyNotice: PRIVACY_NOTICE };
  }

  async startConversation(intake: Intake): Promise<StartedConversation> {
    const { repository, cipher, scope, clock } = this.deps;
    const catalog = await repository.loadCatalog();
    const decision = decideRouting(intake, catalog, scope);
    if (decision.kind !== 'routed') {
      throw new ChatError('option_unavailable');
    }

    const now = clock();
    const session = createSessionToken();
    const created = await repository.createConversation({
      customer: {
        fullName: intake.fullName,
        phone: intake.phone,
        encryptedCpf: cipher.encrypt(intake.cpf),
        cpfHash: cipher.hash(intake.cpf),
        encryptedRg: cipher.encrypt(intake.rg),
        consentVersion: intake.consentVersion,
        consentAt: now,
      },
      session: { tokenHash: session.tokenHash, expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * DAY_MS) },
      target: decision.target,
      welcomeMessage,
      firstMessage: intake.firstMessage === null ? null : redactCpf(intake.firstMessage).redactedText,
    });

    return { sessionToken: session.token, ticketId: created.ticketId, ticketNumber: created.ticketNumber };
  }

  async postMessage(sessionToken: string, ticketId: string, clientMessageId: string, text: string): Promise<ChatMessage> {
    const ticket = await this.authorizedTicket(sessionToken, ticketId);
    if (CLOSED_STATUSES.includes(ticket.status)) {
      throw new ChatError('ticket_closed');
    }
    return this.deps.repository.addCustomerMessage(ticket.id, clientMessageId, redactCpf(text).redactedText);
  }

  async listMessages(sessionToken: string, ticketId: string, afterSeq: number): Promise<TicketMessages> {
    const ticket = await this.authorizedTicket(sessionToken, ticketId);
    const messages = await this.deps.repository.listMessages(ticket.id, afterSeq, MESSAGES_PAGE_SIZE);
    return { ticket: { number: ticket.number, status: ticket.status }, messages };
  }

  private async authorizedTicket(sessionToken: string, ticketId: string): Promise<CustomerTicket> {
    if (!isWellFormedSessionToken(sessionToken)) {
      throw new ChatError('session_invalid');
    }
    const { repository, clock } = this.deps;
    const customerId = await repository.findSessionCustomer(hashSessionToken(sessionToken), clock());
    if (customerId === null) {
      throw new ChatError('session_invalid');
    }
    const ticket = await repository.findCustomerTicket(customerId, ticketId);
    if (ticket === null) {
      throw new ChatError('ticket_not_found');
    }
    return ticket;
  }
}
