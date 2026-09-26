import type { MarginRule, Product } from '../types/api';

export interface DepartmentMargin {
  department: string;
  /** null means no rule: the department cannot be priced. Zero is a real
   *  margin (selling at cost) and is kept as zero. */
  percentage: number | null;
}

export interface DepartmentMargins {
  departments: DepartmentMargin[];
  /** Rules nothing in the catalog matches — any CATEGORIA or SUBCATEGORIA
   *  rule, and any DEPARTAMENTO rule whose name no product carries. Reported
   *  rather than hidden, so a percentage in the database is never invisible. */
  unmatchedRules: MarginRule[];
}

/**
 * Which catalog departments can be priced, and at what margin.
 *
 * Matching is by EXACT string, deliberately identical to `marginFor` in
 * `usePricingInputs`. A looser match here (case, accents, whitespace) would
 * show a margin as set while the register still refused to price the product.
 * The departments come from the catalog rather than from free text so that the
 * margin can never be saved under a name nothing matches.
 */
export function departmentMargins(products: Product[], rules: MarginRule[]): DepartmentMargins {
  const departmentRules = new Map<string, number>();
  for (const rule of rules) {
    if (rule.level === 'DEPARTAMENTO') {
      departmentRules.set(rule.level_name, rule.percentage);
    }
  }

  const catalogDepartments = new Set<string>();
  for (const product of products) {
    if (product.department.trim() !== '') {
      catalogDepartments.add(product.department);
    }
  }

  const departments = [...catalogDepartments]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((department) => ({ department, percentage: departmentRules.get(department) ?? null }));

  const unmatchedRules = rules.filter(
    (rule) => rule.level !== 'DEPARTAMENTO' || !catalogDepartments.has(rule.level_name)
  );

  return { departments, unmatchedRules };
}
