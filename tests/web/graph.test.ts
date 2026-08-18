import { describe, it, expect } from 'vitest';
import { buildActiveLinks, diffBorn, radiusFor } from '../../web/layout/graph.js';

describe('buildActiveLinks', () => {
  it('строит рёбра родитель → потомок в идентификаторах путей', () => {
    const active = Uint8Array.from([1, 1, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const links = buildActiveLinks(active, parent);
    expect([...links.source]).toEqual([0, 1]);
    expect([...links.target]).toEqual([1, 2]);
  });

  it('не создаёт петлю у корня', () => {
    const links = buildActiveLinks(Uint8Array.from([1]), Uint32Array.from([0]));
    expect(links.source.length).toBe(0);
  });

  it('пропускает ребро, если родитель мёртв', () => {
    const links = buildActiveLinks(Uint8Array.from([1, 0, 1]), Uint32Array.from([0, 0, 1]));
    expect(links.source.length).toBe(0);
  });

  it('пропускает мёртвые узлы', () => {
    const links = buildActiveLinks(Uint8Array.from([1, 1, 0]), Uint32Array.from([0, 0, 1]));
    expect([...links.source]).toEqual([0]);
    expect([...links.target]).toEqual([1]);
  });

  it('не падает на пустом живом множестве', () => {
    const links = buildActiveLinks(new Uint8Array(4), Uint32Array.from([0, 0, 1, 2]));
    expect(links.source.length).toBe(0);
    expect(links.target.length).toBe(0);
  });
});

describe('radiusFor', () => {
  it('растёт как корень из числа коммитов', () => {
    expect(radiusFor(0, false)).toBeCloseTo(2.5, 1);
    expect(radiusFor(100, false)).toBeGreaterThan(radiusFor(25, false));
    expect(radiusFor(1_000_000, false)).toBeLessThanOrEqual(40);
  });

  it('разница между редким и частым файлом видна глазом', () => {
    // Коммитов у файла десятки там, где строк были тысячи: на прежнем
    // множителе весь репозиторий выродился бы в одинаковые точки, и метрика
    // сменилась бы впустую. Проверяем не формулу, а различимость на экране.
    expect(radiusFor(30, false) - radiusFor(1, false)).toBeGreaterThan(4);
    expect(radiusFor(100, false) - radiusFor(10, false)).toBeGreaterThan(4);
  });

  it('обычная директория без размера остаётся мелкой', () => {
    expect(radiusFor(0, true)).toBeCloseTo(3, 1);
  });

  it('свёрнутая директория растёт от веса, как и файл, но от своей базы', () => {
    const empty = radiusFor(0, true);
    const big = radiusFor(10_000, true);
    // Заметно крупнее пустой директории, но не крупнее общего потолка.
    expect(big).toBeGreaterThan(empty * 3);
    expect(big).toBeLessThanOrEqual(40);
  });

  it('клэмпит отрицательное число коммитов', () => {
    expect(radiusFor(-50, false)).toBeCloseTo(2.5, 1);
  });
});

describe('diffBorn', () => {
  it('считает рождённым путь, ставший рисуемым', () => {
    const prevDrawn = new Uint8Array(3);
    const born = diffBorn(prevDrawn, Uint8Array.from([1, 0, 1]));
    expect([...born]).toEqual([0, 2]);
  });

  it('не считает рождённым путь, который уже был рисуемым', () => {
    const prevDrawn = Uint8Array.from([1, 0, 1]);
    const born = diffBorn(prevDrawn, Uint8Array.from([1, 1, 1]));
    expect([...born]).toEqual([1]);
  });

  it('чистая функция: не трогает ни prevDrawn, ни drawn', () => {
    const prevDrawn = Uint8Array.from([0, 0]);
    const drawn = Uint8Array.from([1, 1]);
    diffBorn(prevDrawn, drawn);
    expect([...prevDrawn]).toEqual([0, 0]);
    expect([...drawn]).toEqual([1, 1]);
  });

  it('путь, появившийся и исчезнувший между применениями, не остаётся забытым', () => {
    // Функция чистая, поэтому prevDrawn переносим сами между вызовами — ровно
    // так, как это делает main.ts.
    let prevDrawn = Uint8Array.from([0, 0]);

    let drawn = Uint8Array.from([1, 0]); // путь 0 появился
    expect([...diffBorn(prevDrawn, drawn)]).toEqual([0]);
    prevDrawn = drawn;

    drawn = Uint8Array.from([0, 0]); // путь 0 исчез, ничего нового не родилось
    expect([...diffBorn(prevDrawn, drawn)]).toEqual([]);
    prevDrawn = drawn;

    drawn = Uint8Array.from([1, 0]); // путь 0 появился снова
    expect([...diffBorn(prevDrawn, drawn)]).toEqual([0]);
  });
});
