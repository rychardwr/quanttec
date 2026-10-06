export const CPF_MASK = '***.***.***-**';

// 3-3-3-2 digit groups, optionally separated by dots/spaces and a dash/space.
const CPF_CANDIDATE = /(?<!\d)\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?!\d)/g;
const NON_DIGIT = /\D/g;

export interface CpfRedaction {
  /** Text safe to persist: every CPF replaced by CPF_MASK. */
  readonly redactedText: string;
  /** Digits of each CPF with valid check digits, in order of appearance. */
  readonly validCpfs: readonly string[];
}

/**
 * Masks CPFs in free text before it is stored or sent to the AI.
 * A punctuated candidate (123.456.789-09) is always masked, since its format
 * already marks it as a CPF, even with a typo. A bare 11-digit run is masked
 * only when its check digits are valid, so phone numbers stay readable.
 */
export function redactCpf(text: string): CpfRedaction {
  const validCpfs: string[] = [];

  const redactedText = text.replace(CPF_CANDIDATE, (candidate) => {
    const digits = candidate.replace(NON_DIGIT, '');
    const isValid = isValidCpf(digits);
    if (isValid) {
      validCpfs.push(digits);
    }
    const isPunctuated = digits.length !== candidate.length;
    return isValid || isPunctuated ? CPF_MASK : candidate;
  });

  return { redactedText, validCpfs };
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) {
    return false;
  }
  return checkDigit(digits, 9) === Number(digits[9]) && checkDigit(digits, 10) === Number(digits[10]);
}

function checkDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}
