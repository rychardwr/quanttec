import { MissingField } from '../routing/routingPolicy';

// Fixed texts: the AI classifies, but never writes to the customer on its own.
export const REPLIES = {
  routed: 'Obrigado! Seu atendimento foi encaminhado e um atendente vai responder você por aqui em breve.',
  handedToHuman: 'Recebemos sua mensagem. Um atendente vai responder você por aqui em breve.',
  askDepartmentAndCity: 'Para direcionar seu atendimento, conte qual é o assunto e em qual cidade você está.',
  askDepartment: 'Para direcionar seu atendimento, conte qual é o assunto (por exemplo: financeiro, medicina ou segurança).',
  askCity: 'Em qual cidade você está?',
} as const;

export function askForMissing(missing: readonly MissingField[]): string {
  const needsDepartment = missing.includes('department');
  const needsCity = missing.includes('city');
  if (needsDepartment && needsCity) return REPLIES.askDepartmentAndCity;
  return needsDepartment ? REPLIES.askDepartment : REPLIES.askCity;
}
