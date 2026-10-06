import { describe, expect, it } from 'vitest';
import { CPF_MASK, isValidCpf, redactCpf } from '../src/modules/privacy/cpfRedaction';

// Synthetic CPFs with valid check digits.
const VALID_CPF = '52998224725';
const OTHER_VALID_CPF = '11144477735';

describe('isValidCpf', () => {
  it('accepts valid check digits', () => {
    expect(isValidCpf(VALID_CPF)).toBe(true);
    expect(isValidCpf(OTHER_VALID_CPF)).toBe(true);
  });

  it.each(['52998224724', '11111111111', '5299822472', 'abcdefghijk'])('rejects %s', (value) => {
    expect(isValidCpf(value)).toBe(false);
  });
});

describe('redactCpf', () => {
  it.each([
    ['529.982.247-25'],
    ['529982247-25'],
    ['529 982 247 25'],
    [VALID_CPF],
  ])('masks %s and extracts its digits', (written) => {
    const result = redactCpf(`meu cpf é ${written}, obrigado`);
    expect(result.redactedText).toBe(`meu cpf é ${CPF_MASK}, obrigado`);
    expect(result.validCpfs).toEqual([VALID_CPF]);
  });

  it('masks a punctuated CPF with a typo but does not extract it', () => {
    const result = redactCpf('cpf 529.982.247-24');
    expect(result.redactedText).toBe(`cpf ${CPF_MASK}`);
    expect(result.validCpfs).toEqual([]);
  });

  it('keeps bare 11-digit numbers that are not CPFs, such as phones', () => {
    const text = 'me liga no 15999998888';
    expect(redactCpf(text)).toEqual({ redactedText: text, validCpfs: [] });
  });

  it('does not touch longer digit runs', () => {
    const text = 'protocolo 1529982247250';
    expect(redactCpf(text).redactedText).toBe(text);
  });

  it('handles several CPFs in one message', () => {
    const result = redactCpf(`${VALID_CPF} e 111.444.777-35`);
    expect(result.redactedText).toBe(`${CPF_MASK} e ${CPF_MASK}`);
    expect(result.validCpfs).toEqual([VALID_CPF, OTHER_VALID_CPF]);
  });
});
