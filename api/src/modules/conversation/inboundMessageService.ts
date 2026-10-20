import { withTimeout } from '../../shared/timeout';
import { redactCpf } from '../privacy/cpfRedaction';
import { FieldCipher } from '../privacy/fieldCipher';
import { Classification, decideRouting } from '../routing/routingPolicy';
import { DepartmentCity, ServiceScope } from '../routing/serviceScope';
import { InboundMessage } from '../whatsapp/inboundPayload';
import { ConversationClassifier, ConversationRepository, CustomerReplier, Logger, TicketState } from './ports';
import { askForMissing, REPLIES } from './replies';

type TicketChange =
  | { readonly kind: 'assign'; readonly target: DepartmentCity }
  | { readonly kind: 'hand_to_human' }
  | { readonly kind: 'none' };

interface TriageOutcome {
  readonly reply: string;
  readonly ticketChange: TicketChange;
}

const HAND_TO_HUMAN: TriageOutcome = { reply: REPLIES.handedToHuman, ticketChange: { kind: 'hand_to_human' } };

/** Inbound text messages the AI gets to classify a ticket before a human takes over. */
export const MAX_AUTO_TRIAGE_MESSAGES = 3;

export interface InboundMessageServiceDeps {
  readonly repository: ConversationRepository;
  readonly classifier: ConversationClassifier;
  readonly replier: CustomerReplier;
  readonly cipher: FieldCipher;
  readonly scope: ServiceScope;
  readonly classifierTimeoutMs: number;
  readonly logger: Logger;
}

/**
 * Handles one customer message: records it once, masks CPFs, triages the
 * ticket with the AI and answers the customer. Any AI problem hands the ticket
 * to a human; the customer always gets a reply while the ticket is in triage.
 * Safe to run again for the same message (queue retries, Meta re-deliveries);
 * a crash between the reply and markProcessed may send the reply twice.
 */
export class InboundMessageService {
  constructor(private readonly deps: InboundMessageServiceDeps) {}

  async handle(message: InboundMessage): Promise<void> {
    const { repository, replier } = this.deps;
    const redaction = message.text === null ? null : redactCpf(message.text);

    const recorded = await repository.recordInbound(message, redaction?.redactedText ?? null);
    if (recorded.alreadyProcessed) {
      return;
    }

    const cpf = redaction?.validCpfs[0];
    if (cpf) {
      await repository.saveCustomerCpf(message.waId, this.deps.cipher.encrypt(cpf), this.deps.cipher.hash(cpf));
    }

    if (isInAutomaticTriage(recorded.ticket)) {
      const outcome = await this.triage(recorded.ticket.id);
      // Reply before persisting the outcome: if the reply fails, the retry
      // still finds the ticket in triage and answers the customer.
      await replier.reply(recorded.ticket.id, message.waId, outcome.reply);
      await this.applyTicketChange(recorded.ticket.id, outcome.ticketChange);
    }

    await repository.markProcessed(recorded.messageId);
  }

  private async triage(ticketId: string): Promise<TriageOutcome> {
    const { repository, scope } = this.deps;
    const conversation = await repository.listInboundTexts(ticketId);
    if (conversation.length > MAX_AUTO_TRIAGE_MESSAGES) {
      return HAND_TO_HUMAN;
    }

    const classification = await this.classifySafely(conversation);
    if (classification === null) {
      return HAND_TO_HUMAN;
    }

    const decision = decideRouting(classification, await repository.loadCoverage(), scope);
    switch (decision.kind) {
      case 'routed':
        return { reply: REPLIES.routed, ticketChange: { kind: 'assign', target: decision.target } };
      case 'incomplete':
        return { reply: askForMissing(decision.missing), ticketChange: { kind: 'none' } };
      case 'not_served':
      case 'out_of_scope':
        return HAND_TO_HUMAN;
    }
  }

  private async applyTicketChange(ticketId: string, change: TicketChange): Promise<void> {
    switch (change.kind) {
      case 'assign':
        return this.deps.repository.assignDepartment(ticketId, change.target);
      case 'hand_to_human':
        return this.deps.repository.handToHuman(ticketId);
      case 'none':
        return;
    }
  }

  /** Returns null when the AI fails or times out. */
  private async classifySafely(conversation: readonly string[]): Promise<Classification | null> {
    if (conversation.length === 0) {
      return { departmentCode: null, cityCode: null };
    }
    try {
      return await withTimeout(this.deps.classifier.classify(conversation), this.deps.classifierTimeoutMs);
    } catch (error) {
      // Only the error name: messages from providers may echo the conversation.
      this.deps.logger.warn(`AI classification failed (${errorName(error)}); ticket handed to human triage`);
      return null;
    }
  }
}

function isInAutomaticTriage(ticket: TicketState): boolean {
  return ticket.departmentCode === null && ticket.triageMode === 'AUTO';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
