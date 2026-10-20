import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_LENGTH, validateIntake, validateMessageText } from '../src/modules/chat/intake';

const CONSENT_VERSION = '2026-10-20';
const validForm = {
  departmentCode: 'financeiro',
  cityCode: 'ITARARE',
  fullName: '  Maria   da Silva ',
  phone: '(15) 99999-0000',
  cpf: '529.982.247-25',
  rg: '12.345.678-x',
  consentVersion: CONSENT_VERSION,
  firstMessage: '  Preciso da segunda via do boleto  ',
};

describe('validateIntake', () => {
  it('normalizes a valid form', () => {
    expect(validateIntake(validForm, CONSENT_VERSION)).toEqual({
      ok: true,
      value: {
        departmentCode: 'FINANCEIRO',
        cityCode: 'ITARARE',
        fullName: 'Maria da Silva',
        phone: '5515999990000',
        cpf: '52998224725',
        rg: '12345678X',
        consentVersion: CONSENT_VERSION,
        firstMessage: 'Preciso da segunda via do boleto',
      },
    });
  });

  it('accepts a phone with country code and no first message', () => {
    const result = validateIntake({ ...validForm, phone: '+55 15 3531-0000', firstMessage: '' }, CONSENT_VERSION);
    expect(result).toMatchObject({ ok: true, value: { phone: '551535310000', firstMessage: null } });
  });

  it.each([
    ['departmentCode', { departmentCode: 'fin-01' }],
    ['cityCode', { cityCode: 42 }],
    ['fullName', { fullName: 'Al' }],
    ['fullName', { fullName: '12345' }],
    ['phone', { phone: '9999-0000' }],
    ['cpf', { cpf: '529.982.247-24' }],
    ['rg', { rg: '12' }],
    ['consent', { consentVersion: '2020-01-01' }],
    ['consent', { consentVersion: undefined }],
    ['firstMessage', { firstMessage: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }],
  ])('flags %s', (field, override) => {
    expect(validateIntake({ ...validForm, ...override }, CONSENT_VERSION)).toEqual({ ok: false, invalidFields: [field] });
  });

  it('lists every invalid field of an empty body, without values', () => {
    const result = validateIntake(null, CONSENT_VERSION);
    expect(result).toEqual({
      ok: false,
      invalidFields: ['departmentCode', 'cityCode', 'fullName', 'phone', 'cpf', 'rg', 'consent'],
    });
  });
});

describe('validateMessageText', () => {
  it('trims and accepts text up to the limit', () => {
    expect(validateMessageText('  oi  ')).toEqual({ ok: true, value: 'oi' });
    expect(validateMessageText('x'.repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
  });

  it.each([[''], ['   '], [123], ['x'.repeat(MAX_MESSAGE_LENGTH + 1)]])('rejects %j', (text) => {
    expect(validateMessageText(text).ok).toBe(false);
  });
});
