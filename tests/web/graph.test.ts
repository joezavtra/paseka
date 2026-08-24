import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUT_PARAMS } from '../../web/layout/params.js';
import {
  buildActiveLinks,
  radialShare,
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
    // След папки с единственным ребёнком равен следу самого ребёнка, разность
    // нулевая — и цепочка каталогов остаётся короткой без отдельной ветки в коде.
    expect(linkDistanceFor(40, 40)).toBe(DEFAULT_LAYOUT_PARAMS.linkMin);
  });

  it('длина растёт вместе со следом папки', () => {
    // Прежняя формула упиралась в потолок 60 и держала содержимое сжатым:
    // диск папки на две тысячи файлов — четыре сотни пикселей, а пружины
    // тянули на шестьдесят.
    const roomy = linkDistanceFor(459, 9);
    expect(roomy).toBeGreaterThan(300);
    expect(roomy).toBeGreaterThan(linkDistanceFor(60, 9));
  });

  it('крупный ребёнок садится на родителя, мелкий уходит на периферию', () => {
    // Папка с одним огромным поддеревом и горстью файлов: поддерево и есть
    // содержимое папки, ему незачем отодвигаться.
    const huge = linkDistanceFor(405, 400);
    const small = linkDistanceFor(405, 11);
    expect(huge).toBe(DEFAULT_LAYOUT_PARAMS.linkMin);
    expect(small).toBeGreaterThan(300);
  });

  it('потолок остаётся страховкой от вырожденного дерева', () => {
    expect(linkDistanceFor(1e6, 0)).toBe(DEFAULT_LAYOUT_PARAMS.linkMax);
  });

  it('дети разносятся по диску, а не садятся на одно кольцо', () => {
    // С одной длиной покоя на всех папка на две тысячи файлов превращается в
    // бублик с пустой серединой вдвое шире нужного.
    const near = linkDistanceFor(459, 9, DEFAULT_LAYOUT_PARAMS, 0.2);
    const far = linkDistanceFor(459, 9, DEFAULT_LAYOUT_PARAMS, 1);
    expect(near).toBeLessThan(far / 2);
  });

  it('доля вне отрезка от нуля до единицы зажимается', () => {
    expect(linkDistanceFor(459, 9, DEFAULT_LAYOUT_PARAMS, 5)).toBe(
      linkDistanceFor(459, 9, DEFAULT_LAYOUT_PARAMS, 1),
    );
    expect(linkDistanceFor(459, 9, DEFAULT_LAYOUT_PARAMS, -1)).toBe(DEFAULT_LAYOUT_PARAMS.linkMin);
  });

  it('негодные следы не ломают длину', () => {
    expect(linkDistanceFor(0, 0)).toBe(DEFAULT_LAYOUT_PARAMS.linkMin);
    expect(linkDistanceFor(10, 40)).toBe(DEFAULT_LAYOUT_PARAMS.linkMin);
    expect(Number.isFinite(linkDistanceFor(-5, -5))).toBe(true);
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
    const params = { ...DEFAULT_LAYOUT_PARAMS, linkMin: 100, linkMax: 500, folderFill: 1, chainStrength: 0.1, branchStrength: 0.2 };
    expect(linkDistanceFor(150, 20, params)).toBe(130);
    expect(linkDistanceFor(5000, 0, params)).toBe(500);
    expect(linkStrengthFor(1, params)).toBe(0.1);
    expect(linkStrengthFor(9, params)).toBe(0.2);
  });

  it('без настроек берутся замеренные умолчания', () => {
    expect(linkStrengthFor(1)).toBe(DEFAULT_LAYOUT_PARAMS.chainStrength);
    expect(chargeStrengthFor(0, 0)).toBe(DEFAULT_LAYOUT_PARAMS.leafCharge);
  });
});

describe('radialShare', () => {
  it('всегда лежит от нуля до единицы', () => {
    for (const id of [0, 1, 7, 1000, 65535, 1_000_000]) {
      const share = radialShare(id);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it('один и тот же путь всегда на одном удалении', () => {
    // Иначе файл менял бы место в папке от кадра к кадру, и дерево дышало бы
    // без причины.
    expect(radialShare(4242)).toBe(radialShare(4242));
  });

  it('соседние идентификаторы дают разные доли', () => {
    // Файлы одной папки идут подряд: без перемешивания они сели бы по спирали.
    const shares = [10, 11, 12, 13, 14].map(radialShare);
    expect(new Set(shares).size).toBe(shares.length);
  });

  it('доли распределены равномерно по площади, а не по радиусу', () => {
    // Равномерность по площади означает, что во внешней половине радиуса
    // оказывается три четверти точек — там и площади втрое больше.
    const total = 4000;
    let outer = 0;
    for (let id = 0; id < total; id++) if (radialShare(id) > 0.5) outer++;
    expect(outer / total).toBeGreaterThan(0.7);
    expect(outer / total).toBeLessThan(0.8);
  });
});
