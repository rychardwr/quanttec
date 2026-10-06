export interface DepartmentCity {
  readonly departmentCode: string;
  readonly cityCode: string;
}

export type ServiceScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'restricted'; readonly allowed: readonly DepartmentCity[] };

const ALL_SCOPE = '*';
const PAIR_PATTERN = /^([A-Z_]+):([A-Z_]+)$/;

export function sameDepartmentCity(a: DepartmentCity, b: DepartmentCity): boolean {
  return a.departmentCode === b.departmentCode && a.cityCode === b.cityCode;
}

/**
 * Parses the rollout flag. "*" enables the whole catalog; otherwise a
 * comma-separated list such as "FINANCEIRO:ITARARE,MEDICINA:SENGES".
 */
export function parseServiceScope(raw: string): ServiceScope {
  const value = raw.trim();
  if (value === ALL_SCOPE) {
    return { kind: 'all' };
  }

  const allowed = value
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map(parsePair);

  if (allowed.length === 0) {
    throw new Error('SERVICE_SCOPE must be "*" or a list like "FINANCEIRO:ITARARE"');
  }
  return { kind: 'restricted', allowed };
}

export function isInScope(scope: ServiceScope, target: DepartmentCity): boolean {
  return scope.kind === 'all' || scope.allowed.some((allowed) => sameDepartmentCity(allowed, target));
}

function parsePair(pair: string): DepartmentCity {
  const match = PAIR_PATTERN.exec(pair.toUpperCase());
  if (!match) {
    throw new Error(`Invalid SERVICE_SCOPE entry "${pair}", expected DEPARTMENT:CITY`);
  }
  return { departmentCode: match[1]!, cityCode: match[2]! };
}
