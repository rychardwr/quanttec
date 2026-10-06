import { DepartmentCity, isInScope, sameDepartmentCity, ServiceScope } from './serviceScope';

/** What the AI (or a human) extracted from the conversation. */
export interface Classification {
  readonly departmentCode: string | null;
  readonly cityCode: string | null;
}

export type MissingField = 'department' | 'city';

export type RoutingDecision =
  | { readonly kind: 'routed'; readonly target: DepartmentCity }
  | { readonly kind: 'incomplete'; readonly missing: readonly MissingField[] }
  | { readonly kind: 'not_served'; readonly target: DepartmentCity }
  | { readonly kind: 'out_of_scope'; readonly target: DepartmentCity };

/**
 * Decides where a conversation goes.
 * `coverage` is the department × city catalog (source of truth: database);
 * `scope` is the rollout flag that limits which pairs are live (pilot).
 */
export function decideRouting(
  classification: Classification,
  coverage: readonly DepartmentCity[],
  scope: ServiceScope,
): RoutingDecision {
  const missing = missingFields(classification);
  if (missing.length > 0) {
    return { kind: 'incomplete', missing };
  }

  const target: DepartmentCity = {
    departmentCode: classification.departmentCode!,
    cityCode: classification.cityCode!,
  };

  if (!coverage.some((served) => sameDepartmentCity(served, target))) {
    return { kind: 'not_served', target };
  }
  if (!isInScope(scope, target)) {
    return { kind: 'out_of_scope', target };
  }
  return { kind: 'routed', target };
}

function missingFields(classification: Classification): MissingField[] {
  const missing: MissingField[] = [];
  if (!classification.departmentCode) missing.push('department');
  if (!classification.cityCode) missing.push('city');
  return missing;
}
