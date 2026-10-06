import { describe, expect, it } from 'vitest';
import { decideRouting } from '../src/modules/routing/routingPolicy';
import { DepartmentCity, parseServiceScope } from '../src/modules/routing/serviceScope';

const coverage: DepartmentCity[] = [
  { departmentCode: 'FINANCEIRO', cityCode: 'ITARARE' },
  { departmentCode: 'FINANCEIRO', cityCode: 'SENGES' },
  { departmentCode: 'FINANCEIRO', cityCode: 'TAQUARITUBA' },
  { departmentCode: 'MEDICINA', cityCode: 'ITARARE' },
  { departmentCode: 'MEDICINA', cityCode: 'SENGES' },
  { departmentCode: 'SEGURANCA', cityCode: 'ITARARE' },
  { departmentCode: 'SEGURANCA', cityCode: 'TAQUARITUBA' },
];
const fullScope = parseServiceScope('*');
const pilotScope = parseServiceScope('FINANCEIRO:ITARARE');

describe('decideRouting', () => {
  it('routes a served pair within scope', () => {
    const decision = decideRouting({ departmentCode: 'MEDICINA', cityCode: 'SENGES' }, coverage, fullScope);
    expect(decision).toEqual({ kind: 'routed', target: { departmentCode: 'MEDICINA', cityCode: 'SENGES' } });
  });

  it('reports which fields are missing', () => {
    expect(decideRouting({ departmentCode: null, cityCode: null }, coverage, fullScope)).toEqual({
      kind: 'incomplete',
      missing: ['department', 'city'],
    });
    expect(decideRouting({ departmentCode: 'FINANCEIRO', cityCode: null }, coverage, fullScope)).toEqual({
      kind: 'incomplete',
      missing: ['city'],
    });
  });

  it('rejects a department that does not serve the city', () => {
    const decision = decideRouting({ departmentCode: 'MEDICINA', cityCode: 'TAQUARITUBA' }, coverage, fullScope);
    expect(decision.kind).toBe('not_served');
  });

  it('keeps served pairs outside the pilot out of scope', () => {
    expect(decideRouting({ departmentCode: 'FINANCEIRO', cityCode: 'ITARARE' }, coverage, pilotScope).kind).toBe('routed');
    expect(decideRouting({ departmentCode: 'FINANCEIRO', cityCode: 'SENGES' }, coverage, pilotScope).kind).toBe(
      'out_of_scope',
    );
  });

  it('checks coverage before scope', () => {
    const scopeWithUnservedPair = parseServiceScope('MEDICINA:TAQUARITUBA');
    const decision = decideRouting({ departmentCode: 'MEDICINA', cityCode: 'TAQUARITUBA' }, coverage, scopeWithUnservedPair);
    expect(decision.kind).toBe('not_served');
  });
});

describe('parseServiceScope', () => {
  it('parses a list of pairs, case-insensitive', () => {
    expect(parseServiceScope(' financeiro:itarare , MEDICINA:SENGES ')).toEqual({
      kind: 'restricted',
      allowed: [
        { departmentCode: 'FINANCEIRO', cityCode: 'ITARARE' },
        { departmentCode: 'MEDICINA', cityCode: 'SENGES' },
      ],
    });
  });

  it.each(['', ',', 'FINANCEIRO', 'FINANCEIRO-ITARARE', 'A:B:C'])('rejects invalid value %j', (raw) => {
    expect(() => parseServiceScope(raw)).toThrow();
  });
});
