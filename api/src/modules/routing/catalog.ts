import { DepartmentCity, isInScope, ServiceScope } from './serviceScope';

/** One department × city pair the operation serves, with display names. */
export interface CatalogEntry extends DepartmentCity {
  readonly departmentName: string;
  readonly cityName: string;
}

export interface OfferedCity {
  readonly code: string;
  readonly name: string;
}

export interface OfferedDepartment {
  readonly code: string;
  readonly name: string;
  readonly cities: readonly OfferedCity[];
}

/** The departments and cities the chat offers: the catalog limited by the rollout scope, in catalog order. */
export function offeredDepartments(catalog: readonly CatalogEntry[], scope: ServiceScope): OfferedDepartment[] {
  const departments = new Map<string, { code: string; name: string; cities: OfferedCity[] }>();
  for (const entry of catalog) {
    if (!isInScope(scope, entry)) continue;
    let department = departments.get(entry.departmentCode);
    if (!department) {
      department = { code: entry.departmentCode, name: entry.departmentName, cities: [] };
      departments.set(entry.departmentCode, department);
    }
    department.cities.push({ code: entry.cityCode, name: entry.cityName });
  }
  return [...departments.values()];
}
