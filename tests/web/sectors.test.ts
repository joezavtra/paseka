import { describe, it, expect } from 'vitest';
import {
  angularBudget,
  planSectors,
  requiredHalfAngle,
  ringRadius,
  wrapPi,
  type ChildIndex,
  type SectorSettings,
} from '../../web/layout/sectors.js';
import { buildChildIndex } from '../../web/layout/subtree.js';

/**
 * Кольца по следам — ровно тем же правилом, каким их считает subtreeStats.
 * План получает готовое число: искать его самому ему незачем, а разойтись с
 * тем, что заложено в след папки, нельзя.
 */
function ringsFor(children: ChildIndex, footprint: Float32Array, s: SectorSettings): Float64Array {
  const ring = new Float64Array(footprint.length);
  for (let parent = 0; parent < footprint.length; parent++) {
    const branches: number[] = [];
    for (let i = children.start[parent]!; i < children.start[parent + 1]!; i++) {
      const child = children.items[i]!;
      if (children.start[child + 1]! > children.start[child]!) branches.push(footprint[child]!);
    }
    ring[parent] = ringRadius(branches, angularBudget(parent === 0, s));
  }
  return ring;
}

const settings = (over: Partial<SectorSettings> = {}): SectorSettings => ({
  backGuard: Math.PI / 12,
  branchBudget: 0.75,
  margin: 0.25,
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

describe('planSectors', () => {
  /** Корень(0) → папка(1); у папки три ветвящихся ребёнка и один файл. */
  const branchy = () => {
    // 0 корень, 1 папка, 2..4 подпапки, 5 файл папки, 6..8 файлы подпапок
    const parent = [0, 0, 1, 1, 1, 1, 2, 3, 4];
    const { active } = tree(parent);
    const p = Uint32Array.from(parent);
    const footprint = Float32Array.from([500, 200, 40, 30, 25, 3, 3, 3, 3]);
    return { parent: p, active, footprint, children: buildChildIndex(active, p) };
  };

  it('сектор достаётся ветвящимся детям, а файлу — нет', () => {
    const s = branchy();
    const plan = planSectors(s.active, s.children, s.footprint, ringsFor(s.children, s.footprint, settings()), settings());
    expect([...plan.hasSector]).toEqual([0, 1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('секторы сиблингов попарно не пересекаются', () => {
    const s = branchy();
    const plan = planSectors(s.active, s.children, s.footprint, ringsFor(s.children, s.footprint, settings()), settings());
    for (const [a, b] of [[2, 3], [2, 4], [3, 4]]) {
      const gap = Math.abs(wrapPi(plan.bearing[a]! - plan.bearing[b]!));
      expect(gap).toBeGreaterThanOrEqual(plan.halfWidth[a]! + plan.halfWidth[b]! - 1e-9);
    }
  });

  it('ни один сектор не накрывает направление на родителя', () => {
    // Детей нарочно много: при трёх зазоры между секторами вчетверо шире самого
    // защитного зазора, и проверка проходила бы, даже если бы его вовсе не
    // было. Мерить надо край сектора, а не его середину, — и с обеих сторон:
    // запас берётся из соседнего зазора и способен вытолкнуть крайний сектор
    // за границу.
    const guard = Math.PI / 12;
    const parent = [0, 0];
    const footprint = [4000, 900];
    for (let i = 0; i < 20; i++) {
      parent.push(1);
      footprint.push(30);
      parent.push(2 + i * 2);
      footprint.push(3);
    }
    const p = Uint32Array.from(parent);
    const active = Uint8Array.from(parent.map(() => 1));
    const marks = settings({ backGuard: guard, margin: 1 });
    const index = buildChildIndex(active, p);
    const prints = Float32Array.from(footprint);
    const plan = planSectors(active, index, prints, ringsFor(index, prints, marks), marks);

    let checked = 0;
    for (let child = 2; child < parent.length; child += 2) {
      expect(plan.hasSector[child]).toBe(1);
      const near = Math.abs(wrapPi(plan.bearing[child]!)) - plan.halfWidth[child]!;
      expect(near).toBeGreaterThanOrEqual(guard - 1e-9);
      checked++;
    }
    expect(checked).toBe(20);
  });

  it('сектор шире собственного конуса ровно на запас', () => {
    const s = branchy();
    const tight = planSectors(s.active, s.children, s.footprint, ringsFor(s.children, s.footprint, settings({ margin: 0 })), settings({ margin: 0 }));
    const loose = planSectors(s.active, s.children, s.footprint, ringsFor(s.children, s.footprint, settings({ margin: 1 })), settings({ margin: 1 }));
    expect(loose.halfWidth[2]!).toBeGreaterThan(tight.halfWidth[2]!);
    // Даже с полным запасом секторы только касаются, но не налезают.
    const gap = Math.abs(wrapPi(loose.bearing[2]! - loose.bearing[3]!));
    expect(gap).toBeGreaterThanOrEqual(loose.halfWidth[2]! + loose.halfWidth[3]! - 1e-9);
  });

  it('новый ребёнок с наибольшим идентификатором не сдвигает уже стоящих', () => {
    // Идентификаторы раздаются в порядке первого появления в истории, поэтому
    // новичок всегда последний в кольце. Если бы порядок зависел от размера
    // или угла, каждый коммит перетасовывал бы дерево.
    const before = branchy();
    const planBefore = planSectors(before.active, before.children, before.footprint, ringsFor(before.children, before.footprint, settings()), settings());

    const parent = [0, 0, 1, 1, 1, 1, 2, 3, 4, 1, 9];
    const p = Uint32Array.from(parent);
    const active = Uint8Array.from(parent.map(() => 1));
    const footprint = Float32Array.from([500, 200, 40, 30, 25, 3, 3, 3, 3, 4, 3]);
    const planAfter = planSectors(active, buildChildIndex(active, p), footprint, ringsFor(buildChildIndex(active, p), footprint, settings()), settings());

    for (const child of [2, 3, 4]) {
      expect(planAfter.bearing[child]!).toBeLessThan(planBefore.bearing[child]! + 1e-9);
    }
    expect(planAfter.bearing[9]!).toBeGreaterThan(planAfter.bearing[4]!);
    expect(planAfter.hasSector[9]).toBe(1);
  });

  it('младший ребёнок корня задаёт отсчёт и силы не получает', () => {
    // У корня нет родителя, значит нет и естественного нуля. Привяжи отсчёт к
    // оси мира — и сцена начнёт медленно доворачиваться к ней без причины.
    const parent = [0, 0, 0, 1, 2];
    const p = Uint32Array.from(parent);
    const active = Uint8Array.from([1, 1, 1, 1, 1]);
    const footprint = Float32Array.from([500, 60, 60, 3, 3]);
    const plan = planSectors(active, buildChildIndex(active, p), footprint, ringsFor(buildChildIndex(active, p), footprint, settings()), settings());
    expect(plan.bearing[1]).toBe(0);
    expect(plan.bearing[2]!).toBeGreaterThan(0);
  });

  it('скрытое поддерево в план не попадает', () => {
    const parent = [0, 0, 0, 1, 2];
    const p = Uint32Array.from(parent);
    const active = Uint8Array.from([1, 1, 0, 1, 0]);
    const footprint = Float32Array.from([500, 60, 60, 3, 3]);
    const plan = planSectors(active, buildChildIndex(active, p), footprint, ringsFor(buildChildIndex(active, p), footprint, settings()), settings());
    expect(plan.hasSector[2]).toBe(0);
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
