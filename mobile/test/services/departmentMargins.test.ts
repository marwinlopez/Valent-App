import { departmentMargins } from '../../src/services/departmentMargins';
import type { MarginRule, Product } from '../../src/types/api';

function product(barcode: string, department: string): Product {
  return { barcode, name: barcode, brand: 'B', department, unit: 'unidad', costUsd: 1, stock: 1 };
}

function rule(level: MarginRule['level'], levelName: string, percentage: number): MarginRule {
  return { id: `${level}-${levelName}`, level, level_name: levelName, percentage };
}

describe('departmentMargins', () => {
  it('lists each catalog department once, with its margin', () => {
    const result = departmentMargins(
      [product('1', 'Lacteos'), product('2', 'Lacteos'), product('3', 'Granos')],
      [rule('DEPARTAMENTO', 'Lacteos', 30), rule('DEPARTAMENTO', 'Granos', 15)]
    );

    expect(result.departments).toEqual([
      { department: 'Granos', percentage: 15 },
      { department: 'Lacteos', percentage: 30 },
    ]);
  });

  it('reports a department with no margin as null, not zero', () => {
    // Zero is a real margin (selling at cost). A department with no rule
    // cannot be priced at all, and the screen must be able to tell them apart.
    const result = departmentMargins([product('1', 'Limpieza')], []);

    expect(result.departments).toEqual([{ department: 'Limpieza', percentage: null }]);
  });

  it('keeps a margin of zero as zero', () => {
    const result = departmentMargins([product('1', 'Granos')], [rule('DEPARTAMENTO', 'Granos', 0)]);

    expect(result.departments).toEqual([{ department: 'Granos', percentage: 0 }]);
  });

  it('matches by exact string, the way marginFor does at the register', () => {
    // usePricingInputs.marginFor compares level_name to the product's
    // department exactly. If this function matched more loosely, the screen
    // would show a margin as set while the register still refused to price.
    const result = departmentMargins(
      [product('1', 'Lácteos')],
      [rule('DEPARTAMENTO', 'Lacteos', 30)]
    );

    expect(result.departments).toEqual([{ department: 'Lácteos', percentage: null }]);
    expect(result.unmatchedRules).toEqual([rule('DEPARTAMENTO', 'Lacteos', 30)]);
  });

  it('reports rules nothing in the catalog matches, instead of hiding them', () => {
    const result = departmentMargins(
      [product('1', 'Granos')],
      [
        rule('DEPARTAMENTO', 'Granos', 15),
        rule('CATEGORIA', 'Bebidas', 20),
        rule('SUBCATEGORIA', 'Refrescos', 25),
        rule('DEPARTAMENTO', 'Descontinuado', 10),
      ]
    );

    expect(result.departments).toEqual([{ department: 'Granos', percentage: 15 }]);
    expect(result.unmatchedRules).toEqual([
      rule('CATEGORIA', 'Bebidas', 20),
      rule('SUBCATEGORIA', 'Refrescos', 25),
      rule('DEPARTAMENTO', 'Descontinuado', 10),
    ]);
  });

  it('ignores a CATEGORIA rule that happens to share a department name', () => {
    // Only DEPARTAMENTO rules price anything, so a CATEGORIA "Granos" must not
    // be shown as the margin of the Granos department.
    const result = departmentMargins([product('1', 'Granos')], [rule('CATEGORIA', 'Granos', 50)]);

    expect(result.departments).toEqual([{ department: 'Granos', percentage: null }]);
    expect(result.unmatchedRules).toEqual([rule('CATEGORIA', 'Granos', 50)]);
  });

  it('skips a product with a blank department rather than listing an empty row', () => {
    const result = departmentMargins([product('1', ''), product('2', '   '), product('3', 'Granos')], []);

    expect(result.departments).toEqual([{ department: 'Granos', percentage: null }]);
  });

  it('returns nothing for an empty catalog and no rules', () => {
    expect(departmentMargins([], [])).toEqual({ departments: [], unmatchedRules: [] });
  });
});
