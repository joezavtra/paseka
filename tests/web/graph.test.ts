import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT_PARAMS } from '../../web/layout/params.js';
import {
  buildActiveLinks,
  chargeStrengthFor,
  countChildren,
  diffBorn,
  linkDistanceFor,
  linkStrengthFor,
  radiusFor,
} from '../../web/layout/graph.js';

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

describe('countChildren', () => {
  it('считает детей по присланным рёбрам', () => {
    // Корень с двумя детьми, у первого — ещё три.
    const linkSource = Uint32Array.from([0, 0, 1, 1, 1]);
    expect([...countChildren(linkSource, 6)]).toEqual([2, 3, 0, 0, 0, 0]);
  });

  it('без рёбер детей нет ни у кого', () => {
    expect([...countChildren(new Uint32Array(0), 3)]).toEqual([0, 0, 0]);
  });
});

describe('linkDistanceFor', () => {
  it('транзитная папка держит ребёнка вплотную', () => {
    // Раньше длина была одна на все рёбра (24), и цепочка папок с единственным
    // ребёнком растягивала дерево на всю глубину. Звено такой цепочки обязано
    // быть заметно короче прежней константы.
    expect(linkDistanceFor(1)).toBeLessThan(15);
    expect(linkDistanceFor(1)).toBeLessThan(linkDistanceFor(4));
  });

  it('ветвящейся папке нужно кольцо пошире', () => {
    expect(linkDistanceFor(25)).toBeGreaterThan(linkDistanceFor(4));
    expect(linkDistanceFor(4)).toBeGreaterThan(linkDistanceFor(2));
  });

  it('длина ограничена сверху: дальше кольцо не помогает', () => {
    expect(linkDistanceFor(10_000)).toBeLessThanOrEqual(60);
    expect(linkDistanceFor(10_000)).toBe(linkDistanceFor(100_000));
  });

  it('нулевое и отрицательное число детей не ломают длину', () => {
    expect(linkDistanceFor(0)).toBeGreaterThan(0);
    expect(Number.isFinite(linkDistanceFor(-5))).toBe(true);
  });
});

describe('linkStrengthFor', () => {
  it('ребро к единственному ребёнку жёсткое', () => {
    // Мягкое звено — это и есть пружина, растягивающая цепочку транзитных папок.
    expect(linkStrengthFor(1)).toBe(1);
    expect(linkStrengthFor(0)).toBe(1);
  });

  it('у ветвящейся папки ребро мягче, чтобы дети разошлись по кольцу', () => {
    expect(linkStrengthFor(2)).toBeLessThan(linkStrengthFor(1));
    expect(linkStrengthFor(50)).toBeLessThan(1);
  });
});

describe('chargeStrengthFor', () => {
  it('узел без потомков отталкивает слабо', () => {
    // Заряд действует между всеми парами и растёт как квадрат числа узлов:
    // кластер из сотни файлов в полную силу расталкивает соседние кластеры и
    // растягивает цепочку транзитных папок в ниточку через полэкрана.
    expect(chargeStrengthFor(3, 0)).toBeGreaterThan(chargeStrengthFor(3, 5));
    expect(chargeStrengthFor(3, 0)).toBeLessThan(0);
  });

  it('ветвящийся каталог требует места по своему размеру', () => {
    expect(chargeStrengthFor(20, 5)).toBeLessThan(chargeStrengthFor(3, 5));
  });

  it('отрицательный радиус не усиливает притяжение', () => {
    expect(chargeStrengthFor(-100, 5)).toBe(chargeStrengthFor(0, 5));
  });

  it('умолчания сохраняют инварианты раскладки', () => {
    // Сами числа подбираются глазом на панели и меняются; сторожим не их, а два
    // свойства, из-за нарушения которых картинка ломается предсказуемо.

    // Заряд листа заметно слабее заряда папки: заряд действует между всеми
    // парами и растёт как квадрат числа узлов, поэтому кластер из сотни файлов
    // в полную силу растягивает цепочку транзитных папок в ниточку.
    expect(DEFAULT_LAYOUT_PARAMS.leafCharge).toBeGreaterThan(DEFAULT_LAYOUT_PARAMS.dirCharge);

    // Ниже примерно 150 соседние поддеревья перестают расходиться и сливаются
    // в один ком (замер в докблоке chargeStrengthFor).
    expect(DEFAULT_LAYOUT_PARAMS.chargeDistanceMax).toBeGreaterThanOrEqual(150);
  });
});

describe('силы принимают настройки', () => {
  it('заряд считается по переданным настройкам, а не по умолчаниям', () => {
    const params = { ...DEFAULT_LAYOUT_PARAMS, leafCharge: -1, dirCharge: -2, dirChargePerRadius: -3 };
    expect(chargeStrengthFor(10, 0, params)).toBe(-1);
    expect(chargeStrengthFor(10, 4, params)).toBe(-32);
  });

  it('длина и жёсткость ребра тоже', () => {
    const params = { ...DEFAULT_LAYOUT_PARAMS, linkMin: 100, linkSpread: 0, linkMax: 500, chainStrength: 0.1, branchStrength: 0.2 };
    expect(linkDistanceFor(1, params)).toBe(100);
    expect(linkDistanceFor(50, params)).toBe(100);
    expect(linkStrengthFor(1, params)).toBe(0.1);
    expect(linkStrengthFor(9, params)).toBe(0.2);
  });

  it('без настроек берутся замеренные умолчания', () => {
    expect(linkStrengthFor(1)).toBe(DEFAULT_LAYOUT_PARAMS.chainStrength);
    expect(chargeStrengthFor(0, 0)).toBe(DEFAULT_LAYOUT_PARAMS.leafCharge);
  });
});
