import { describe, it, expect } from 'vitest';
import { buildChildIndex, footprintRadius, subtreeStats } from '../../web/layout/subtree.js';
import type { SectorSettings } from '../../web/layout/sectors.js';

const PADDING = 2;
const PACK = 0.8;
const SECTORS: SectorSettings = { backGuard: Math.PI / 12, branchBudget: 0.75, margin: 0.25 };

/**
 * Дерево строится литералами прямо в тесте, как в соседних тестах раскладки:
 * `parent[i]` — родитель пути i, у корня родитель — он сам.
 */
function stats(parent: number[], radius: number[], active?: number[]) {
  const mask = Uint8Array.from(active ?? parent.map(() => 1));
  const tree = Uint32Array.from(parent);
  return subtreeStats(
    mask,
    tree,
    Float32Array.from(radius),
    PADDING,
    PACK,
    buildChildIndex(mask, tree),
    SECTORS,
  );
}

describe('subtreeStats: кольцо ветвящихся детей', () => {
  it('единственной подпапке кольца не выдаётся', () => {
    // Транзитная цепочка каталогов: конкурировать за угол не с кем, и любое
    // требование отойти растянуло бы цепочку ровно тем растягиванием, ради
    // избавления от которого длина ребра стала выводиться из следов.
    const s = stats([0, 0, 1, 2], [3, 3, 3, 30]);
    expect(s.ring[0]).toBe(0);
    expect(s.ring[1]).toBe(0);
    expect(s.ring[2]).toBe(0);
  });

  it('файлы кольца не требуют: оно про подпапки', () => {
    const s = stats([0, 0, 0, 0], [3, 20, 20, 20]);
    expect(s.ring[0]).toBe(0);
  });

  it('две подпапки требуют кольца и раздвигают след родителя', () => {
    // 0 → 1 и 2, у каждой по файлу: обе ветвящиеся, значит конкурируют за угол.
    const parent = [0, 0, 0, 1, 2];
    const radius = [3, 3, 3, 30, 30];
    const s = stats(parent, radius);
    expect(s.ring[0]!).toBeGreaterThan(0);
    expect(s.footprint[0]!).toBeGreaterThanOrEqual(s.ring[0]! + s.footprint[1]!);
  });

  it('кольцо не уменьшает след, посчитанный по площади', () => {
    // Обе модели верны, брать надо большую: площадная отвечает, сколько места
    // нужно кружкам, угловая — насколько далеко их пришлось отодвинуть.
    const parent = [0, 0, 0, 1, 2];
    const radius = [3, 3, 3, 40, 40];
    const s = stats(parent, radius);
    const packed = Math.sqrt((s.area[0]! - 25) / 0.8);
    expect(s.footprint[0]!).toBeGreaterThanOrEqual(Math.min(packed, s.ring[0]! + s.footprint[1]!) - 1e-6);
  });

  it('скрытая подпапка в кольцо не считается', () => {
    const parent = [0, 0, 0, 1, 2];
    const radius = [3, 3, 3, 30, 30];
    const visible = stats(parent, radius);
    const hidden = stats(parent, radius, [1, 1, 0, 1, 0]);
    expect(visible.ring[0]!).toBeGreaterThan(0);
    expect(hidden.ring[0]).toBe(0);
  });
});

describe('footprintRadius', () => {
  it('одинокий кружок занимает ровно себя, без наценки за плотность', () => {
    // У листа нет детей, которые надо укладывать: делить его собственный
    // радиус на плотность упаковки не за что.
    expect(footprintRadius(0, 0, 22, PACK)).toBe(22);
  });

  it('единственный ребёнок задаёт след целиком', () => {
    expect(footprintRadius(100, 10, 5, PACK)).toBe(10);
  });

  it('растёт как корень из площади детей', () => {
    const small = footprintRadius(100, 0, 0, PACK);
    const big = footprintRadius(400, 0, 0, PACK);
    expect(big / small).toBeCloseTo(2, 5);
  });

  it('плотность упаковки задаёт простор', () => {
    expect(footprintRadius(1000, 0, 0, 0.5)).toBeGreaterThan(footprintRadius(1000, 0, 0, 0.9));
  });

  it('негодные величины не дают негодного следа', () => {
    for (const value of [footprintRadius(-100, 0, 0, PACK), footprintRadius(0, -5, 0, PACK), footprintRadius(100, 0, 0, 0)]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('subtreeStats', () => {
  it('след транзитной папки равен следу её единственного ребёнка', () => {
    // Корень → папка → файл. Разность следов на каждом звене нулевая, и
    // цепочка каталогов остаётся короткой.
    const { footprint } = stats([0, 0, 1], [3, 3, 8]);
    expect(footprint[1]).toBeCloseTo(footprint[2]!, 2);
  });

  it('папка с двумя тысячами файлов требует сотни пикселей, а не десятки', () => {
    // Ровно тот случай, ради которого всё затевалось: прежняя формула давала
    // потолок в 60 пикселей при физическом диске около четырёхсот.
    const parent = [0, 0];
    const radius = [3, 3];
    for (let i = 0; i < 2000; i++) {
      parent.push(1);
      radius.push(7);
    }
    const { footprint, leaves } = stats(parent, radius);
    expect(leaves[1]).toBe(2000);
    expect(footprint[1]).toBeGreaterThan(400);
  });

  it('площадь и листья собираются со всего поддерева, а не только с прямых детей', () => {
    // Корень → a → b → два файла.
    const { leaves, area } = stats([0, 0, 1, 2, 2], [3, 3, 3, 5, 5]);
    expect(leaves[1]).toBe(2);
    expect(leaves[2]).toBe(2);
    expect(area[1]!).toBeGreaterThan(area[2]!);
  });

  it('свёрнутая папка занимает свой кружок, а не спрятанное внутри', () => {
    // Путь 1 — папка, чьё содержимое не рисуется: на сцене это один кружок.
    // Взять сюда число спрятанных файлов — самая вероятная тихая ошибка всей
    // затеи: свёрнутой папке отвели бы диск в сотни пикселей под один кружок.
    const parent = [0, 0];
    const radius = [3, 20];
    for (let i = 0; i < 40; i++) {
      parent.push(1);
      radius.push(7);
    }
    const active = parent.map((_, i) => (i <= 1 ? 1 : 0));
    const collapsed = stats(parent, radius, active);
    expect(collapsed.leaves[1]).toBe(1);
    expect(collapsed.footprint[1]).toBeCloseTo(20 + PADDING, 4);

    const expanded = stats(parent, radius);
    expect(expanded.leaves[1]).toBe(40);
    expect(expanded.footprint[1]!).toBeGreaterThan(collapsed.footprint[1]! * 2);
  });

  it('мелкие дети, помещающиеся в кружок самой папки, следа не увеличивают', () => {
    // Собственный радиус — нижняя граница следа, а не слагаемое.
    const { footprint } = stats([0, 0, 1, 1], [3, 20, 3, 3]);
    expect(footprint[1]).toBeCloseTo(20 + PADDING, 4);
  });

  it('скрытое поддерево не занимает места', () => {
    const parent = [0, 0, 1, 1, 1];
    const radius = [3, 3, 9, 9, 9];
    const all = stats(parent, radius);
    const hidden = stats(parent, radius, [1, 1, 1, 0, 0]);
    expect(hidden.footprint[1]!).toBeLessThan(all.footprint[1]!);
    expect(hidden.leaves[1]).toBe(1);
  });

  it('узел с мёртвым родителем не отдаёт ему площадь', () => {
    // Тот же предикат, что у buildActiveLinks: пружины между ними нет, значит
    // и агрегат учитывать её не должен.
    const { area, leaves } = stats([0, 0, 1], [3, 3, 9], [1, 0, 1]);
    expect(leaves[0]).toBe(1);
    expect(area[0]!).toBeCloseTo((3 + PADDING) ** 2, 4);
  });

  it('корень собирает всё дерево', () => {
    const { leaves } = stats([0, 0, 0, 1, 1], [3, 3, 5, 5, 5]);
    expect(leaves[0]).toBe(3);
  });
});
