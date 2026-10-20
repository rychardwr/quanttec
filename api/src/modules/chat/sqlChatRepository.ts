import sql from 'mssql';
import { CatalogEntry } from '../routing/catalog';
import {
  ChatMessage,
  ChatRepository,
  CreatedConversation,
  CustomerTicket,
  MessageSender,
  NewConversation,
  TicketStatus,
} from './ports';

const UNIQUE_VIOLATION_ERRORS = new Set([2601, 2627]);

interface MessageRow {
  seq: string; // BIGINT comes back as string
  sender: MessageSender;
  body: string;
  created_at: Date;
}

/** ChatRepository on Azure SQL. Every value goes through parameters, never string concatenation. */
export class SqlChatRepository implements ChatRepository {
  private poolPromise: Promise<sql.ConnectionPool> | undefined;

  constructor(private readonly connectionString: string) {}

  async loadCatalog(): Promise<CatalogEntry[]> {
    const result = await (await this.pool()).request().query<CatalogEntry>(`
      SELECT d.code AS departmentCode, d.name AS departmentName, c.code AS cityCode, c.name AS cityName
      FROM department_cities dc
      JOIN departments d ON d.id = dc.department_id
      JOIN cities c ON c.id = dc.city_id
      ORDER BY d.name, c.name`);
    return result.recordset;
  }

  async createConversation(conversation: NewConversation): Promise<CreatedConversation> {
    const transaction = new sql.Transaction(await this.pool());
    await transaction.begin();
    try {
      const { customer, session, target } = conversation;
      const customerResult = await transaction
        .request()
        .input('fullName', sql.NVarChar(150), customer.fullName)
        .input('phone', sql.VarChar(13), customer.phone)
        .input('cpfEncrypted', sql.VarBinary(256), customer.encryptedCpf)
        .input('cpfHash', sql.VarBinary(32), customer.cpfHash)
        .input('rgEncrypted', sql.VarBinary(256), customer.encryptedRg)
        .input('consentAt', sql.DateTime2(3), customer.consentAt)
        .input('consentVersion', sql.VarChar(20), customer.consentVersion)
        .query<{ id: string }>(`
          INSERT INTO customers (full_name, phone, cpf_encrypted, cpf_hash, rg_encrypted, consent_at, consent_version)
          OUTPUT INSERTED.id
          VALUES (@fullName, @phone, @cpfEncrypted, @cpfHash, @rgEncrypted, @consentAt, @consentVersion)`);
      const customerId = customerResult.recordset[0]!.id;

      await transaction
        .request()
        .input('tokenHash', sql.VarBinary(32), session.tokenHash)
        .input('customerId', sql.UniqueIdentifier, customerId)
        .input('expiresAt', sql.DateTime2(3), session.expiresAt)
        .query('INSERT INTO chat_sessions (token_hash, customer_id, expires_at) VALUES (@tokenHash, @customerId, @expiresAt)');

      const ticketResult = await transaction
        .request()
        .input('customerId', sql.UniqueIdentifier, customerId)
        .input('departmentCode', sql.VarChar(30), target.departmentCode)
        .input('cityCode', sql.VarChar(30), target.cityCode)
        .query<{ id: string; ticket_number: number }>(`
          INSERT INTO tickets (customer_id, department_id, city_id)
          OUTPUT INSERTED.id, INSERTED.ticket_number
          SELECT @customerId, d.id, c.id
          FROM departments d CROSS JOIN cities c
          WHERE d.code = @departmentCode AND c.code = @cityCode`);
      const ticket = ticketResult.recordset[0];
      if (!ticket) {
        throw new Error('Unknown department or city code');
      }

      await insertMessage(transaction, ticket.id, 'SYSTEM', conversation.welcomeMessage(ticket.ticket_number), null);
      if (conversation.firstMessage !== null) {
        await insertMessage(transaction, ticket.id, 'CUSTOMER', conversation.firstMessage, null);
      }

      await transaction.commit();
      return { ticketId: ticket.id.toLowerCase(), ticketNumber: ticket.ticket_number };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async findSessionCustomer(tokenHash: Buffer, now: Date): Promise<string | null> {
    const result = await (await this.pool())
      .request()
      .input('tokenHash', sql.VarBinary(32), tokenHash)
      .input('now', sql.DateTime2(3), now)
      .query<{ customer_id: string }>(
        'SELECT customer_id FROM chat_sessions WHERE token_hash = @tokenHash AND expires_at > @now',
      );
    return result.recordset[0]?.customer_id.toLowerCase() ?? null;
  }

  async findCustomerTicket(customerId: string, ticketId: string): Promise<CustomerTicket | null> {
    const result = await (await this.pool())
      .request()
      .input('customerId', sql.UniqueIdentifier, customerId)
      .input('ticketId', sql.UniqueIdentifier, ticketId)
      .query<{ id: string; ticket_number: number; status: TicketStatus }>(
        'SELECT id, ticket_number, status FROM tickets WHERE id = @ticketId AND customer_id = @customerId',
      );
    const row = result.recordset[0];
    return row ? { id: row.id.toLowerCase(), number: row.ticket_number, status: row.status } : null;
  }

  async addCustomerMessage(ticketId: string, clientMessageId: string, body: string): Promise<ChatMessage> {
    const pool = await this.pool();
    try {
      return await insertMessage(pool, ticketId, 'CUSTOMER', body, clientMessageId);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await pool
        .request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('clientMessageId', sql.UniqueIdentifier, clientMessageId)
        .query<MessageRow>(`
          SELECT seq, sender, body, created_at FROM messages
          WHERE ticket_id = @ticketId AND client_message_id = @clientMessageId`);
      return toChatMessage(existing.recordset[0]!);
    }
  }

  async listMessages(ticketId: string, afterSeq: number, limit: number): Promise<ChatMessage[]> {
    const result = await (await this.pool())
      .request()
      .input('ticketId', sql.UniqueIdentifier, ticketId)
      .input('afterSeq', sql.BigInt, afterSeq)
      .input('limit', sql.Int, limit)
      .query<MessageRow>(`
        SELECT TOP (@limit) seq, sender, body, created_at FROM messages
        WHERE ticket_id = @ticketId AND seq > @afterSeq
        ORDER BY seq`);
    return result.recordset.map(toChatMessage);
  }

  async close(): Promise<void> {
    if (this.poolPromise) await (await this.poolPromise).close();
    this.poolPromise = undefined;
  }

  /** Connects lazily; a failed connection is retried on the next call (e.g. while serverless SQL resumes). */
  private pool(): Promise<sql.ConnectionPool> {
    this.poolPromise ??= new sql.ConnectionPool(this.connectionString).connect().catch((error: unknown) => {
      this.poolPromise = undefined;
      throw error;
    });
    return this.poolPromise;
  }
}

async function insertMessage(
  executor: sql.ConnectionPool | sql.Transaction,
  ticketId: string,
  sender: MessageSender,
  body: string,
  clientMessageId: string | null,
): Promise<ChatMessage> {
  const result = await executor
    .request()
    .input('ticketId', sql.UniqueIdentifier, ticketId)
    .input('sender', sql.VarChar(10), sender)
    .input('clientMessageId', sql.UniqueIdentifier, clientMessageId)
    .input('body', sql.NVarChar(sql.MAX), body)
    .query<MessageRow>(`
      INSERT INTO messages (ticket_id, sender, client_message_id, body)
      OUTPUT INSERTED.seq, INSERTED.sender, INSERTED.body, INSERTED.created_at
      VALUES (@ticketId, @sender, @clientMessageId, @body)`);
  return toChatMessage(result.recordset[0]!);
}

function toChatMessage(row: MessageRow): ChatMessage {
  return { seq: Number(row.seq), sender: row.sender, body: row.body, createdAt: row.created_at };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof sql.RequestError && error.number !== undefined && UNIQUE_VIOLATION_ERRORS.has(error.number);
}
