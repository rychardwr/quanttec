export type Role = 'ATTENDANT' | 'MASTER';

/** The authenticated attendant, as resolved by the back-end (never trusted from the client). */
export interface Principal {
  readonly attendantId: string;
  readonly role: Role;
  readonly departmentId: number | null;
}

/** Filter the ticket repository must apply for a given principal. */
export type TicketVisibility =
  | { readonly kind: 'all' }
  | { readonly kind: 'department'; readonly departmentId: number };

export class AccessConfigurationError extends Error {}

export function ticketVisibilityFor(principal: Principal): TicketVisibility {
  if (principal.role === 'MASTER') {
    return { kind: 'all' };
  }
  if (principal.departmentId === null) {
    throw new AccessConfigurationError(`Attendant ${principal.attendantId} has no department`);
  }
  return { kind: 'department', departmentId: principal.departmentId };
}

/**
 * Unclassified tickets (departmentId null, e.g. AI fallback) are visible only
 * to MASTER, who triages them into a department.
 */
export function canAccessTicket(principal: Principal, ticket: { readonly departmentId: number | null }): boolean {
  const visibility = ticketVisibilityFor(principal);
  return visibility.kind === 'all' || visibility.departmentId === ticket.departmentId;
}
