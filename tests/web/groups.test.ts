import { describe, it, expect } from 'vitest';
import {
  accumulateCentroids,
  containmentDeltas,
  MIN_GROUP_LEAVES,
  propagateDown,
  propagateRotation,
  repelCones,
  repelSiblings,
  siblingPairs,
} from '../../web/layout/groups.js';
import { buildChildIndex } from '../../web/layout/subtree.js';

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

describe('propagateRotation', () => {
  const apply = (parent: number[], x: number[], y: number[], spin: number[]) => {
    const active = Uint8Array.from(parent.map(() => 1));
    const px = Float64Array.from(x);
    const py = Float64Array.from(y);
    const vx = new Float64Array(parent.length);
    const vy = new Float64Array(parent.length);
    propagateRotation(
      active,
      Uint32Array.from(parent),
      px,
      py,
      Float64Array.from(spin),
      new Float64Array(parent.length),
      new Float64Array(parent.length),
      new Float64Array(parent.length),
      vx,
      vy,
    );
    return { vx, vy };
  };

  it('поворот вокруг родителя смещает по касательной, а не по радиусу', () => {
    // Корень(0) в нуле, ребёнок(1) на оси X: поворот обязан двинуть его по Y.
    const { vx, vy } = apply([0, 0], [0, 100], [0, 0], [0, 0.01]);
    expect(vx[1]).toBeCloseTo(0, 9);
    expect(vy[1]).toBeCloseTo(1, 9);
  });

  it('поддерево едет вместе с папкой, сохраняя внутренние расстояния', () => {
    // Корень(0) → папка(1) на (100,0) → файл(2) на (110,0).
    const { vx, vy } = apply([0, 0, 1], [0, 100, 110], [0, 0, 0], [0, 0.01, 0]);
    expect(vy[1]).toBeCloseTo(1, 9);
    expect(vy[2]).toBeCloseTo(1.1, 9);
    // В первом порядке это жёсткий поворот: расстояние внутри не меняется.
    expect(vx[2]! - vx[1]!).toBeCloseTo(0, 9);
  });

  it('повороты деда и папки складываются', () => {
    const only = apply([0, 0, 1], [0, 100, 110], [0, 0, 0], [0, 0, 0.01]);
    const both = apply([0, 0, 1], [0, 100, 110], [0, 0, 0], [0, 0.01, 0.01]);
    expect(both.vy[2]!).toBeCloseTo(only.vy[2]! + 1.1, 9);
  });

  it('через мёртвого предка поворот не течёт', () => {
    const parent = Uint32Array.from([0, 0, 1]);
    const active = Uint8Array.from([1, 0, 1]);
    const vx = new Float64Array(3);
    const vy = new Float64Array(3);
    propagateRotation(
      active,
      parent,
      Float64Array.from([0, 100, 110]),
      new Float64Array(3),
      Float64Array.from([0, 0.01, 0]),
      new Float64Array(3),
      new Float64Array(3),
      new Float64Array(3),
      vx,
      vy,
    );
    expect(vy[2]).toBe(0);
  });
});

describe('repelCones', () => {
  /**
   * Корень(0) слева, папка(1) в центре, две её подпапки(2, 3) с файлами(4, 5).
   * Направление на родителя из папки — это π, и оно тоже занято: туда уходит
   * ребро вверх.
   */
  const scene = (angleA: number, angleB: number, distance = 200) => {
    const parent = Uint32Array.from([0, 0, 1, 1, 2, 3]);
    const active = Uint8Array.from([1, 1, 1, 1, 1, 1]);
    const footprint = Float32Array.from([1000, 300, 40, 40, 3, 3]);
    const children = buildChildIndex(active, parent);
    const x = Float64Array.from([
      -300, 0, Math.cos(angleA) * distance, Math.cos(angleB) * distance, 0, 0,
    ]);
    const y = Float64Array.from([0, 0, Math.sin(angleA) * distance, Math.sin(angleB) * distance, 0, 0]);
    // Файлы стоят рядом со своими подпапками, а не в них: сядь они в ту же
    // точку, и проверка «файлы в разведении не участвуют» проходила бы сама
    // собой — нулевое расстояние отсеивается раньше всякой фильтрации.
    x[4] = x[2]! + 30;
    y[4] = y[2]! + 30;
    x[5] = x[3]! + 30;
    y[5] = y[3]! - 30;
    return { parent, active, footprint, children, x, y, spin: new Float64Array(6) };
  };

  const repel = (s: ReturnType<typeof scene>, guard = 0, strength = 1, maxStep = 1e9) => {
    repelCones(
      s.active, s.parent, s.children, s.x, s.y, s.footprint, guard, strength, 1, maxStep, s.spin,
    );
    return s.spin;
  };

  it('разошедшиеся конусы не трогаются вовсе', () => {
    // Сила контактная: молчит там, где расстановка и так годная, и потому не
    // спорит ни с пружинами, ни с расталкиванием следов.
    expect([...repel(scene(0.5, -0.5))]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('налезшие конусы разводятся в разные стороны', () => {
    const spin = repel(scene(0.1, -0.1));
    expect(spin[2]!).toBeGreaterThan(0);
    expect(spin[3]!).toBeLessThan(0);
  });

  it('зазор разводит и те конусы, что лишь коснулись', () => {
    // Полуугол каждого — asin(40/200), то есть чуть больше 0.2 радиана.
    const touching = 0.21;
    expect(repel(scene(touching, -touching), 0)[2]).toBe(0);
    expect(repel(scene(touching, -touching), 0.3)[2]!).toBeGreaterThan(0);
  });

  it('поддерево на направлении к родителю отодвигается с его пути', () => {
    const s = scene(Math.PI - 0.05, 0);
    const spin = repel(s, 0.1);
    expect(spin[2]!).toBeLessThan(0);
    expect(spin[3]).toBe(0);
  });

  it('конус в полную плоскость не разводится: свободного направления нет', () => {
    const s = scene(0.1, -0.1);
    s.footprint[2] = 500; // след подпапки накрыл её родителя
    expect(repel(s)[2]).toBe(0);
    expect(repel(s)[3]).toBe(0);
  });

  it('файлы в разведении конусов не участвуют', () => {
    const s = scene(0.1, -0.1);
    expect(repel(s)[4]).toBe(0);
    expect(repel(s)[5]).toBe(0);
  });

  it('совпавшие направления разводятся детерминированно, а не в ноль', () => {
    const first = repel(scene(0.3, 0.3));
    const second = repel(scene(0.3, 0.3));
    expect(first[2]!).toBeGreaterThan(0);
    expect(first[3]!).toBeLessThan(0);
    expect([...first]).toEqual([...second]);
  });

  it('потолок шага держит разведение', () => {
    const s = scene(0, 0.01);
    const capped = repel(s, 0, 1, 5);
    expect(Math.abs(capped[2]!) * (200 + s.footprint[2]!)).toBeLessThanOrEqual(5 + 1e-9);
  });

  it('нулевая сила отключает разведение целиком', () => {
    expect([...repel(scene(0.1, -0.1), 0, 0)]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('скрытая подпапка в разведении не участвует', () => {
    const s = scene(0.1, -0.1);
    s.active[3] = 0;
    const spin = repel(s, 0, 1, 1e9);
    expect(spin[2]).toBe(0);
    expect(spin[3]).toBe(0);
  });
});

describe('repelCones: файлы конусов не имеют', () => {
  it('файл с подпапкой не разводится: конусы — это про подпапки', () => {
    // Корень(0) → папка(1) → подпапка(2) с файлом(4) и файл(3) на том же
    // направлении. Конус тут ровно один, и разводить его не с чем. Выталкивать
    // файлы из чужих конусов было замерено отдельной силой и не окупилось:
    // пересечений это не убавляло ни на десятую процента.
    const parent = Uint32Array.from([0, 0, 1, 1, 2]);
    const active = Uint8Array.from([1, 1, 1, 1, 1]);
    const footprint = Float32Array.from([1000, 400, 40, 3, 3]);
    const children = buildChildIndex(active, parent);
    const x = Float64Array.from([-300, 0, 200, Math.cos(0.05) * 300, 230]);
    const y = Float64Array.from([0, 0, 0, Math.sin(0.05) * 300, 20]);
    const spin = new Float64Array(5);
    repelCones(active, parent, children, x, y, footprint, 0, 1, 1, 1e9, spin);
    expect([...spin]).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('repelCones: защита ребра вверх', () => {
  it('единственная подпапка тоже уходит с пути ребра вверх', () => {
    // Разводить её не с кем, но ребро вверх она перекрывает не хуже прочих, и
    // проверка «меньше двух подпапок — пропускаем» эту защиту бы отменила.
    const parent = Uint32Array.from([0, 0, 1, 2]);
    const active = Uint8Array.from([1, 1, 1, 1]);
    const footprint = Float32Array.from([1000, 300, 40, 3]);
    const children = buildChildIndex(active, parent);
    const angle = Math.PI - 0.05;
    const x = Float64Array.from([-300, 0, Math.cos(angle) * 200, 0]);
    const y = Float64Array.from([0, 0, Math.sin(angle) * 200, 0]);
    x[3] = x[2]!;
    y[3] = y[2]!;
    const spin = new Float64Array(4);
    repelCones(active, parent, children, x, y, footprint, 0.1, 1, 1, 1e9, spin);
    expect(spin[2]!).toBeLessThan(0);
  });
});
