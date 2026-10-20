import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG } from '../src/modules/chat/inMemoryChatRepository';
import { offeredDepartments } from '../src/modules/routing/catalog';
import { parseServiceScope } from '../src/modules/routing/serviceScope';
import { pendingMigrations } from '../src/shared/migrations';

describe('offeredDepartments', () => {
  it('offers only the pilot pair', () => {
    expect(offeredDepartments(DEFAULT_CATALOG, parseServiceScope('FINANCEIRO:ITARARE'))).toEqual([
      { code: 'FINANCEIRO', name: 'Financeiro', cities: [{ code: 'ITARARE', name: 'Itararé' }] },
    ]);
  });

  it('groups the whole catalog by department, in catalog order', () => {
    const offered = offeredDepartments(DEFAULT_CATALOG, parseServiceScope('*'));
    expect(offered.map((department) => [department.code, department.cities.map((city) => city.code)])).toEqual([
      ['FINANCEIRO', ['ITARARE', 'SENGES', 'TAQUARITUBA']],
      ['MEDICINA', ['ITARARE', 'SENGES']],
      ['SEGURANCA', ['ITARARE', 'TAQUARITUBA']],
    ]);
  });

  it('ignores scope pairs the catalog does not serve', () => {
    expect(offeredDepartments(DEFAULT_CATALOG, parseServiceScope('MEDICINA:TAQUARITUBA'))).toEqual([]);
  });
});

describe('pendingMigrations', () => {
  it('returns unapplied .sql files in order', () => {
    const files = ['0002_reference_data.sql', 'README.md', '0001_initial_schema.sql', '0003_next.sql'];
    expect(pendingMigrations(files, new Set(['0001_initial_schema.sql']))).toEqual([
      '0002_reference_data.sql',
      '0003_next.sql',
    ]);
  });
});
