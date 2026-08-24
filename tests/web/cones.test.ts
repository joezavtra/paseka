import { describe, it, expect } from 'vitest';
import {
  angularBudget,
  requiredHalfAngle,
  ringRadius,
  wrapPi,
  type ConeSettings,
} from '../../web/layout/cones.js';
import { buildChildIndex } from '../../web/layout/subtree.js';

const settings = (over: Partial<ConeSettings> = {}): ConeSettings => ({
  backGuard: Math.PI / 12,
  branchBudget: 0.75,
  ...over,
});

/** Дерево литералами, как в соседних тестах раскладки. */
const tree = (parent: number[], active?: number[]) => ({
  parent: Uint32Array.from(parent),
  active: Uint8Array.from(active ?? parent.map(() => 1)),
});

describe('wrapPi', () => {
  it('приводит угол к короткой дуге', () => {
    expect(wrapPi(0)).toBeCloseTo(0, 9);
    expect(wrapPi(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 9);
    expect(wrapPi(-Math.PI * 3)).toBeCloseTo(Math.PI, 9);
    expect(wrapPi(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 9);
  });
});

describe('requiredHalfAngle', () => {
  it('на далёком расстоянии конус узкий', () => {
    expect(requiredHalfAngle(10, 100)).toBeCloseTo(Math.asin(0.1), 9);
  });

  it('след, накрывший вершину, вырождает конус в полную плоскость', () => {
    // У транзитной папки, стоящей вплотную к родителю, направления просто нет,
    // и asin от величины больше единицы дал бы NaN — то есть молча застывшую
    // раскладку.
    expect(requiredHalfAngle(100, 50)).toBe(Math.PI);
    expect(requiredHalfAngle(100, 0)).toBe(Math.PI);
  });
});

describe('ringRadius', () => {
  it('единственному ребёнку кольцо не нужно', () => {
    // Конусы разводят между собой; с одним разводить нечего. Потребуй общая
    // формула отойти на собственный след — и транзитная цепочка каталогов
    // растянулась бы на каждом звене.
    expect(ringRadius([40], Math.PI * 1.5)).toBe(0);
  });

  it('чем больше детей, тем дальше кольцо', () => {
    const few = ringRadius([40, 40, 40], Math.PI * 1.5);
    const many = ringRadius(new Array(40).fill(40), Math.PI * 1.5);
    expect(many).toBeGreaterThan(few * 3);
  });

  it('найденный радиус ровно укладывает конусы в бюджет', () => {
    const footprints = [50, 30, 30, 20, 20, 20, 10];
    const budget = Math.PI * 1.2;
    const ring = ringRadius(footprints, budget);
    const width = (d: number) =>
      footprints.reduce((sum, r) => sum + 2 * requiredHalfAngle(r, d), 0);
    expect(width(ring)).toBeLessThanOrEqual(budget + 1e-6);
    // И это наименьший такой радиус: чуть ближе — уже не влезает.
    expect(width(ring * 0.98)).toBeGreaterThan(budget);
  });

  it('огромный ребёнок обязан отойти за собственный след', () => {
    // Иначе он накроет вершину, его конус станет полной плоскостью, и мелким
    // сиблингам не останется ни градуса. Это честная цена планарности.
    expect(ringRadius([200, 5, 5], Math.PI * 1.2)).toBeGreaterThanOrEqual(200);
  });

  it('пустой список кольца не требует', () => {
    expect(ringRadius([], Math.PI)).toBe(0);
  });
});

describe('angularBudget', () => {
  it('доля круга под подпапки сужает бюджет', () => {
    const half = angularBudget(false, settings({ branchBudget: 0.5 }));
    const full = angularBudget(false, settings({ branchBudget: 1 }));
    expect(half).toBeCloseTo(full / 2, 9);
  });

  it('меньший бюджет отодвигает кольцо дальше', () => {
    // Прямая цена настройки: чем меньше круга отдано подпапкам, тем дальше им
    // приходится отойти, чтобы конусы разошлись, и тем шире сцена.
    const footprints = new Array(10).fill(40);
    const generous = ringRadius(footprints, angularBudget(false, settings({ branchBudget: 1 })));
    const tight = ringRadius(footprints, angularBudget(false, settings({ branchBudget: 0.5 })));
    expect(tight).toBeGreaterThan(generous * 1.5);
  });

  it('у корня зазор к родителю не отнимается: родителя нет', () => {
    const s = settings({ backGuard: Math.PI / 6 });
    expect(angularBudget(true, s)).toBeGreaterThan(angularBudget(false, s));
  });
});

describe('buildChildIndex', () => {
  it('дети выходят по возрастанию идентификатора', () => {
    const { parent, active } = tree([0, 0, 1, 0, 1]);
    const index = buildChildIndex(active, parent);
    expect([...index.items.slice(index.start[0]!, index.start[1]!)]).toEqual([1, 3]);
    expect([...index.items.slice(index.start[1]!, index.start[2]!)]).toEqual([2, 4]);
  });

  it('лист детей не имеет', () => {
    const { parent, active } = tree([0, 0, 1]);
    const index = buildChildIndex(active, parent);
    expect(index.start[3]! - index.start[2]!).toBe(0);
  });

  it('скрытый узел не считается ребёнком и своих детей не отдаёт', () => {
    const { parent } = tree([0, 0, 1]);
    const active = Uint8Array.from([1, 0, 1]);
    const index = buildChildIndex(active, parent);
    expect(index.items.length).toBe(0);
  });
});
