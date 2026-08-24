import { describe, it, expect } from 'vitest';
import {
  accumulateCentroids,
  containmentDeltas,
  MIN_GROUP_LEAVES,
  propagateDown,
  repelSiblings,
  siblingPairs,
} from '../../web/layout/groups.js';

/** Дерево литералами, как в соседних тестах раскладки: parent[i] — родитель пути i. */
const tree = (parent: number[], active?: number[]) => ({
  parent: Uint32Array.from(parent),
  active: Uint8Array.from(active ?? parent.map(() => 1)),
});

describe('accumulateCentroids', () => {
  it('центр масс собирается со всего поддерева', () => {
    // Корень → папка(1) → два файла по краям: центр обязан лечь посередине.
    const { parent, active } = tree([0, 0, 1, 1]);
    const x = Float64Array.from([0, 0, -10, 10]);
    const y = Float64Array.from([0, 0, 0, 0]);
    const mass = Float64Array.from([0, 0, 1, 1]);
    const cx = new Float64Array(4);
    const cy = new Float64Array(4);
    const cm = new Float64Array(4);

    accumulateCentroids(active, parent, x, y, mass, cx, cy, cm);
    expect(cm[1]).toBe(2);
    expect(cx[1]! / cm[1]!).toBeCloseTo(0, 6);
  });

  it('тяжёлый узел тянет центр к себе', () => {
    const { parent, active } = tree([0, 0, 1, 1]);
    const x = Float64Array.from([0, 0, -10, 10]);
    const y = new Float64Array(4);
    const mass = Float64Array.from([0, 0, 9, 1]);
    const cx = new Float64Array(4);
    const cy = new Float64Array(4);
    const cm = new Float64Array(4);

    accumulateCentroids(active, parent, x, y, mass, cx, cy, cm);
    expect(cx[1]! / cm[1]!).toBeCloseTo(-8, 6);
  });

  it('узел вне маски не тянет центр масс', () => {
    // Ушедший со сцены файл остаётся в памяти хранилища узлов вместе со своей
    // позицией; тянуть за собой центр масс он не должен.
    const { parent } = tree([0, 0, 1, 1]);
    const active = Uint8Array.from([1, 1, 1, 0]);
    const x = Float64Array.from([0, 0, -10, 1000]);
    const y = new Float64Array(4);
    const mass = Float64Array.from([0, 0, 1, 1]);
    const cx = new Float64Array(4);
    const cy = new Float64Array(4);
    const cm = new Float64Array(4);

    accumulateCentroids(active, parent, x, y, mass, cx, cy, cm);
    expect(cm[1]).toBe(1);
    expect(cx[1]! / cm[1]!).toBeCloseTo(-10, 6);
  });
});

describe('containmentDeltas', () => {
  const setup = (childX: number, parentFootprint: number, childFootprint = 1) => {
    const { parent, active } = tree([0, 0, 1]);
    const x = Float64Array.from([0, 0, childX]);
    const y = new Float64Array(3);
    const footprint = Float32Array.from([100, parentFootprint, childFootprint]);
    const centroidX = new Float64Array(3);
    const centroidY = new Float64Array(3);
    const vx = new Float64Array(3);
    const vy = new Float64Array(3);
    return { parent, active, x, y, footprint, centroidX, centroidY, vx, vy };
  };

  it('узел внутри следа своей папки не чувствует ничего', () => {
    const s = setup(10, 50);
    containmentDeltas(s.active, s.parent, s.x, s.y, s.footprint, s.centroidX, s.centroidY, 0.5, 1, s.vx, s.vy);
    expect(s.vx[2]).toBe(0);
    expect(s.vy[2]).toBe(0);
  });

  it('сбежавший узел тянется обратно к центру', () => {
    const s = setup(200, 50);
    containmentDeltas(s.active, s.parent, s.x, s.y, s.footprint, s.centroidX, s.centroidY, 0.5, 1, s.vx, s.vy);
    expect(s.vx[2]!).toBeLessThan(0);
  });

  it('возврат тем сильнее, чем дальше сбежал', () => {
    const near = setup(60, 50);
    containmentDeltas(near.active, near.parent, near.x, near.y, near.footprint, near.centroidX, near.centroidY, 0.5, 1, near.vx, near.vy);
    const far = setup(300, 50);
    containmentDeltas(far.active, far.parent, far.x, far.y, far.footprint, far.centroidX, far.centroidY, 0.5, 1, far.vx, far.vy);
    expect(Math.abs(far.vx[2]!)).toBeGreaterThan(Math.abs(near.vx[2]!));
  });

  it('собственный размер узла входит в границу: крупный высовывается раньше', () => {
    const small = setup(49, 50, 1);
    containmentDeltas(small.active, small.parent, small.x, small.y, small.footprint, small.centroidX, small.centroidY, 0.5, 1, small.vx, small.vy);
    const big = setup(49, 50, 20);
    containmentDeltas(big.active, big.parent, big.x, big.y, big.footprint, big.centroidX, big.centroidY, 0.5, 1, big.vx, big.vy);
    expect(small.vx[2]).toBe(0);
    expect(big.vx[2]!).toBeLessThan(0);
  });

  it('нулевая сила ничего не двигает', () => {
    const s = setup(500, 50);
    containmentDeltas(s.active, s.parent, s.x, s.y, s.footprint, s.centroidX, s.centroidY, 0, 1, s.vx, s.vy);
    expect(s.vx[2]).toBe(0);
  });

  it('совпадение с центром не даёт негодной скорости', () => {
    const s = setup(0, 1, 100);
    containmentDeltas(s.active, s.parent, s.x, s.y, s.footprint, s.centroidX, s.centroidY, 0.5, 1, s.vx, s.vy);
    expect(Number.isFinite(s.vx[2]!)).toBe(true);
  });
});

describe('siblingPairs', () => {
  it('пары строятся только между папками одного родителя', () => {
    // Корень → a(1), b(2); у a — потомок c(3). Пара должна быть одна: a и b.
    const { parent, active } = tree([0, 0, 0, 1]);
    const leaves = Uint32Array.from([9, 5, 4, 4]);
    const pairs = siblingPairs(active, parent, leaves, 4, 256);
    expect(pairs.a.length).toBe(1);
    expect([pairs.a[0], pairs.b[0]]).toEqual([1, 2]);
  });

  it('мелкие папки в расталкивании не участвуют', () => {
    // Порог — защита стоимости: папка с тысячами детей-файлов иначе дала бы
    // миллионы пар на тик.
    const { parent, active } = tree([0, 0, 0]);
    const leaves = Uint32Array.from([4, MIN_GROUP_LEAVES - 1, MIN_GROUP_LEAVES - 1]);
    expect(siblingPairs(active, parent, leaves).a.length).toBe(0);
  });

  it('вырожденный родитель пропускается целиком', () => {
    const parent = [0];
    const leaves = [1000];
    for (let i = 0; i < 40; i++) {
      parent.push(0);
      leaves.push(10);
    }
    const { parent: p, active } = tree(parent);
    const pairs = siblingPairs(active, p, Uint32Array.from(leaves), 4, 10);
    expect(pairs.a.length).toBe(0);
  });

  it('скрытые папки в пары не попадают', () => {
    const { parent } = tree([0, 0, 0]);
    const active = Uint8Array.from([1, 1, 0]);
    const leaves = Uint32Array.from([9, 5, 4]);
    expect(siblingPairs(active, parent, leaves).a.length).toBe(0);
  });
});

describe('repelSiblings', () => {
  const pairs = { a: Uint32Array.from([1]), b: Uint32Array.from([2]) };

  const push = (distance: number, footprint: number, gap = 0, massA = 1, massB = 1) => {
    const cx = Float64Array.from([0, 0, distance]);
    const cy = new Float64Array(3);
    const fp = Float32Array.from([0, footprint, footprint]);
    const mass = Float64Array.from([0, massA, massB]);
    const pushX = new Float64Array(3);
    const pushY = new Float64Array(3);
    repelSiblings(pairs, cx, cy, fp, mass, gap, 1, 1, pushX, pushY);
    return pushX;
  };

  it('разошедшиеся папки не трогаются вовсе', () => {
    // Сила контактная: она молчит там, где заряд уже справился, и потому не
    // считает одно и то же дважды.
    const pushX = push(500, 50);
    expect(pushX[1]).toBe(0);
    expect(pushX[2]).toBe(0);
  });

  it('налезшие следы разводятся в разные стороны', () => {
    const pushX = push(40, 50);
    expect(pushX[1]!).toBeLessThan(0);
    expect(pushX[2]!).toBeGreaterThan(0);
  });

  it('зазор заставляет расходиться и при касании', () => {
    expect(push(100, 50, 0)[1]).toBe(0);
    expect(push(100, 50, 20)[1]!).toBeLessThan(0);
  });

  it('тяжёлая папка уступает меньше лёгкой', () => {
    const pushX = push(40, 50, 0, 9, 1);
    expect(Math.abs(pushX[1]!)).toBeLessThan(Math.abs(pushX[2]!));
  });

  it('совпавшие центры разводятся детерминированно, а не в NaN', () => {
    const first = push(0, 50);
    const second = push(0, 50);
    expect(Number.isFinite(first[1]!)).toBe(true);
    expect(first[1]).not.toBe(0);
    expect([...first]).toEqual([...second]);
  });
});

describe('propagateDown', () => {
  it('смещение группы достаётся каждому потомку ровно по разу', () => {
    // Корень → папка(1) → подпапка(2) → файл(3).
    const { parent, active } = tree([0, 0, 1, 2]);
    const pushX = Float64Array.from([0, 5, 0, 0]);
    const pushY = new Float64Array(4);
    propagateDown(active, parent, pushX, pushY);
    expect([...pushX]).toEqual([0, 5, 5, 5]);
  });

  it('вложенные смещения складываются', () => {
    const { parent, active } = tree([0, 0, 1, 2]);
    const pushX = Float64Array.from([0, 5, 3, 0]);
    const pushY = new Float64Array(4);
    propagateDown(active, parent, pushX, pushY);
    expect([...pushX]).toEqual([0, 5, 8, 8]);
  });

  it('через мёртвого предка смещение не течёт', () => {
    const { parent } = tree([0, 0, 1, 2]);
    const active = Uint8Array.from([1, 1, 0, 1]);
    const pushX = Float64Array.from([0, 5, 0, 0]);
    const pushY = new Float64Array(4);
    propagateDown(active, parent, pushX, pushY);
    expect(pushX[3]).toBe(0);
  });
});
