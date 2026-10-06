import { describe, expect, it } from 'vitest';
import {
  AccessConfigurationError,
  canAccessTicket,
  Principal,
  ticketVisibilityFor,
} from '../src/modules/access/ticketAccess';

const master: Principal = { attendantId: 'm1', role: 'MASTER', departmentId: null };
const financeAttendant: Principal = { attendantId: 'a1', role: 'ATTENDANT', departmentId: 1 };

describe('ticket access', () => {
  it('lets master see everything, including unclassified tickets', () => {
    expect(ticketVisibilityFor(master)).toEqual({ kind: 'all' });
    expect(canAccessTicket(master, { departmentId: 2 })).toBe(true);
    expect(canAccessTicket(master, { departmentId: null })).toBe(true);
  });

  it('limits an attendant to their own department', () => {
    expect(ticketVisibilityFor(financeAttendant)).toEqual({ kind: 'department', departmentId: 1 });
    expect(canAccessTicket(financeAttendant, { departmentId: 1 })).toBe(true);
    expect(canAccessTicket(financeAttendant, { departmentId: 2 })).toBe(false);
    expect(canAccessTicket(financeAttendant, { departmentId: null })).toBe(false);
  });

  it('fails closed for an attendant without department', () => {
    const misconfigured: Principal = { attendantId: 'a2', role: 'ATTENDANT', departmentId: null };
    expect(() => ticketVisibilityFor(misconfigured)).toThrow(AccessConfigurationError);
  });
});
