import { describe, it, expect } from 'vitest';
import { footprintRadius, subtreeStats } from '../../web/layout/subtree.js';

const PADDING = 2;
const PACK = 0.8;

/**
 * Дерево строится литералами прямо в тесте, как в соседних тестах раскладки:
 * `parent[i]` — родитель пути i, у корня родитель — он сам.
 */
function stats(parent: number[], radius: number[], active?: number[]) {
  return subtreeStats(
    Uint8Array.from(active ?? parent.map(() => 1)),
    Uint32Array.from(parent),
    Float32Array.from(radius),
    PADDING,
    PACK,
  );
}

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
