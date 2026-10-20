import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ChatApi, ChatMessage, ChatSession, TicketMessages } from '../api/chatApi';
import { ChatPage } from './ChatPage';
import { saveSession } from './sessionStorage';

const SESSION: ChatSession = { sessionToken: 't'.repeat(43), ticketId: 'ticket-1', ticketNumber: 1000 };
const OPTIONS = {
  departments: [{ code: 'FINANCEIRO', name: 'Financeiro', cities: [{ code: 'ITARARE', name: 'Itararé' }] }],
  privacyNotice: { version: '2026-10-20', text: 'Aviso de privacidade de teste.' },
};
const WELCOME: ChatMessage = { seq: 1, sender: 'SYSTEM', body: 'Protocolo 1000.', createdAt: '2026-10-20T12:00:00Z' };

function fakeApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    getOptions: vi.fn(async () => OPTIONS),
    startConversation: vi.fn(async () => SESSION),
    listMessages: vi.fn(async (): Promise<TicketMessages> => ({ ticket: { number: 1000, status: 'OPEN' }, messages: [WELCOME] })),
    postMessage: vi.fn(async (_session, _id, text: string) => ({ seq: 2, sender: 'CUSTOMER' as const, body: text, createdAt: '2026-10-20T12:01:00Z' })),
    ...overrides,
  };
}

async function fillIntake(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Financeiro' }));
  await user.click(screen.getByRole('button', { name: 'Itararé' }));
  await user.type(screen.getByLabelText('Nome completo'), 'Maria da Silva');
  await user.type(screen.getByLabelText(/Telefone/), '15999990000');
  await user.type(screen.getByLabelText('CPF'), '52998224725');
  await user.type(screen.getByLabelText('RG'), '123456789');
}

describe('ChatPage', () => {
  it('opens a conversation from the department, city and intake steps', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<ChatPage api={api} />);

    await fillIntake(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    expect(await screen.findByText('Atendimento nº 1000')).toBeInTheDocument();
    expect(await screen.findByText('Protocolo 1000.')).toBeInTheDocument();
    expect(api.startConversation).toHaveBeenCalledWith(
      expect.objectContaining({ departmentCode: 'FINANCEIRO', cityCode: 'ITARARE', consentVersion: '2026-10-20' }),
    );
    expect(JSON.parse(localStorage.getItem('quanttec.chat.session')!)).toEqual(SESSION);
  });

  it('requires consent before calling the API', async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<ChatPage api={api} />);

    await fillIntake(user);
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    expect(screen.getByText('Para continuar, é preciso concordar com o uso dos dados.')).toBeInTheDocument();
    expect(api.startConversation).not.toHaveBeenCalled();
  });

  it('shows the fields the server rejected', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ startConversation: vi.fn(async () => Promise.reject(new ApiError(400, 'invalid_request', ['cpf']))) });
    render(<ChatPage api={api} />);

    await fillIntake(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Iniciar atendimento' }));

    expect(await screen.findByText('Informe um CPF válido.')).toBeInTheDocument();
    expect(screen.getByLabelText('CPF')).toHaveAttribute('aria-invalid', 'true');
  });

  it('lets the customer retry when the options fail to load', async () => {
    const user = userEvent.setup();
    const getOptions = vi.fn().mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValue(OPTIONS);
    render(<ChatPage api={fakeApi({ getOptions })} />);

    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByRole('button', { name: 'Financeiro' })).toBeInTheDocument();
  });

  it('resumes a saved conversation and sends a message', async () => {
    const user = userEvent.setup();
    saveSession(SESSION);
    const api = fakeApi();
    render(<ChatPage api={api} />);

    await screen.findByText('Protocolo 1000.');
    await user.type(screen.getByLabelText('Sua mensagem'), 'Alguém aí?{Enter}');

    expect(await screen.findByText('Alguém aí?')).toBeInTheDocument();
    expect(api.postMessage).toHaveBeenCalledWith(SESSION, expect.any(String), 'Alguém aí?');
  });

  it('retries a failed message with the same client id', async () => {
    const user = userEvent.setup();
    saveSession(SESSION);
    const postMessage = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'network'))
      .mockImplementation(async (_s: ChatSession, _id: string, text: string) => ({ seq: 2, sender: 'CUSTOMER', body: text, createdAt: '2026-10-20T12:01:00Z' }));
    render(<ChatPage api={fakeApi({ postMessage })} />);

    await screen.findByText('Protocolo 1000.');
    await user.type(screen.getByLabelText('Sua mensagem'), 'Oi{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(postMessage.mock.calls[1]![1]).toBe(postMessage.mock.calls[0]![1]);
    await waitFor(() => expect(screen.queryByText('Não enviada.')).not.toBeInTheDocument());
  });

  it('offers a new conversation when the ticket is closed', async () => {
    const user = userEvent.setup();
    saveSession(SESSION);
    const listMessages = vi.fn(async (): Promise<TicketMessages> => ({ ticket: { number: 1000, status: 'RESOLVED' }, messages: [WELCOME] }));
    render(<ChatPage api={fakeApi({ listMessages })} />);

    expect(await screen.findByText('Este atendimento foi encerrado.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sua mensagem')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Novo atendimento' }));
    expect(await screen.findByRole('button', { name: 'Financeiro' })).toBeInTheDocument();
    expect(localStorage.getItem('quanttec.chat.session')).toBeNull();
  });

  it('starts over when the saved session is no longer valid', async () => {
    saveSession(SESSION);
    const listMessages = vi.fn(async () => Promise.reject(new ApiError(401, 'session_invalid')));
    render(<ChatPage api={fakeApi({ listMessages })} />);

    expect(await screen.findByText(/Não encontramos mais esta conversa/)).toBeInTheDocument();
  });
});
