import { isValidCpf } from '../privacy/cpfRedaction';

export const MAX_MESSAGE_LENGTH = 2000;

const BRAZIL_COUNTRY_CODE = '55';
const NON_DIGIT = /\D/g;
const RG_SEPARATORS = /[\s.\-/]/g;
const RG_PATTERN = /^[0-9A-Z]{5,14}$/;
const LETTER = /\p{L}/u;

/** The intake form, validated and normalized. Carries personal data: never log it. */
export interface Intake {
  readonly departmentCode: string;
  readonly cityCode: string;
  readonly fullName: string;
  /** Digits only, with country code (e.g. 5515999990000). */
  readonly phone: string;
  /** 11 digits. */
  readonly cpf: string;
  /** Uppercase letters and digits, separators removed. */
  readonly rg: string;
  readonly consentVersion: string;
  readonly firstMessage: string | null;
}

export type IntakeField = keyof Omit<Intake, 'consentVersion'> | 'consent';

export type Validation<T, F extends string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly invalidFields: readonly F[] };

/**
 * Validates the form posted by the browser. Errors name the fields only,
 * never echo their values. `currentConsentVersion` is the privacy notice the
 * server currently shows; consenting to another version is rejected.
 */
export function validateIntake(body: unknown, currentConsentVersion: string): Validation<Intake, IntakeField> {
  const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const invalidFields: IntakeField[] = [];

  const departmentCode = normalizeCode(input.departmentCode);
  if (departmentCode === null) invalidFields.push('departmentCode');

  const cityCode = normalizeCode(input.cityCode);
  if (cityCode === null) invalidFields.push('cityCode');

  const fullName = normalizeFullName(input.fullName);
  if (fullName === null) invalidFields.push('fullName');

  const phone = normalizePhone(input.phone);
  if (phone === null) invalidFields.push('phone');

  const cpf = typeof input.cpf === 'string' ? input.cpf.replace(NON_DIGIT, '') : '';
  if (!isValidCpf(cpf)) invalidFields.push('cpf');

  const rg = typeof input.rg === 'string' ? input.rg.replace(RG_SEPARATORS, '').toUpperCase() : '';
  if (!RG_PATTERN.test(rg)) invalidFields.push('rg');

  if (input.consentVersion !== currentConsentVersion) invalidFields.push('consent');

  const firstMessage = validateMessageText(input.firstMessage ?? '', { allowEmpty: true });
  if (!firstMessage.ok) invalidFields.push('firstMessage');

  if (invalidFields.length > 0) {
    return { ok: false, invalidFields };
  }
  return {
    ok: true,
    value: {
      departmentCode: departmentCode!,
      cityCode: cityCode!,
      fullName: fullName!,
      phone: phone!,
      cpf,
      rg,
      consentVersion: currentConsentVersion,
      firstMessage: firstMessage.ok ? firstMessage.value : null,
    },
  };
}

/** Trims the text; null means empty (only accepted with allowEmpty). */
export function validateMessageText(
  text: unknown,
  options: { allowEmpty: boolean } = { allowEmpty: false },
): Validation<string | null, 'text'> {
  if (typeof text !== 'string') return { ok: false, invalidFields: ['text'] };
  const trimmed = text.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) return { ok: false, invalidFields: ['text'] };
  if (trimmed.length === 0) {
    return options.allowEmpty ? { ok: true, value: null } : { ok: false, invalidFields: ['text'] };
  }
  return { ok: true, value: trimmed };
}

function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z_]{1,30}$/.test(code) ? code : null;
}

function normalizeFullName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 3 && name.length <= 150 && LETTER.test(name) ? name : null;
}

/** Accepts Brazilian numbers with area code (10 or 11 digits), with or without +55. */
function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(NON_DIGIT, '');
  if (digits.length === 10 || digits.length === 11) return BRAZIL_COUNTRY_CODE + digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith(BRAZIL_COUNTRY_CODE)) return digits;
  return null;
}
