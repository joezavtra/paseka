import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LABEL_LIMIT,
  MIN_LABEL_RADIUS_PX,
  labelFor,
  pluralFiles,
  representedClause,
  selectLabels,
  type LabelCamera,
  type LabelInput,
} from '../../web/render/labels.js';

describe('pluralFiles', () => {
  const cases: [number, string][] = [
    [1, '1 файл'],
    [2, '2 файла'],
    [5, '5 файлов'],
    [11, '11 файлов'],
    [12, '12 файлов'],
    [13, '13 файлов'],
    [14, '14 файлов'],
    [21, '21 файл'],
    [22, '22 файла'],
    [25, '25 файлов'],
    [101, '101 файл'],
    [111, '111 файлов'],
    [114, '114 файлов'],
    [0, '0 файлов'],
  ];

  for (const [count, expected] of cases) {
    it(`${count} → «${expected}»`, () => {
      expect(pluralFiles(count)).toBe(expected);
    });
  }
});

describe('labelFor', () => {
  it('без счётчика (files === 0) даёт только имя', () => {
    expect(labelFor('main.ts', 0)).toBe('main.ts');
  });

  it('со счётчиком даёт «имя · N файлов»', () => {
    expect(labelFor('src', 12)).toBe('src · 12 файлов');
    expect(labelFor('src', 1)).toBe('src · 1 файл');
  });
});

describe('representedClause', () => {
  const cases: [number, string][] = [
    [1, 'на сцене показан 1'],
    [2, 'на сцене показано 2'],
    [5, 'на сцене показано 5'],
    [11, 'на сцене показано 11'],
    [12, 'на сцене показано 12'],
    [21, 'на сцене показан 21'],
    [22, 'на сцене показано 22'],
  ];

  for (const [count, expected] of cases) {
    it(`${count} → «${expected}»`, () => {
      expect(representedClause(count)).toBe(expected);
    });
  }
});

/** Камера-тождество: экранные координаты совпадают с мировыми, масштаб 1. */
const identityCamera: LabelCamera = {
  scale: 1,
  toScreen: (worldX: number, worldY: number) => [worldX, worldY],
};

/** Камера со смещением и масштабом ≠ 1: экран = мир·scale + offset. Нужна,
 * чтобы отличить проверки, реально идущие через camera.scale/toScreen, от
 * тех, что случайно совпадают на камере-тождестве. */
function scaledCamera(scale: number, offsetX = 0, offsetY = 0): LabelCamera {
  return {
    scale,
    toScreen: (worldX: number, worldY: number) => [worldX * scale + offsetX, worldY * scale + offsetY],
  };
}

const WIDTH = 800;
const HEIGHT = 600;

/** Узел по умолчанию: рисуется, в кадре, мелкий, не наведён и не погашен. */
function baseInput(count: number): LabelInput {
  return {
    active: new Uint8Array(count).fill(1),
    positions: new Float32Array(count * 2),
    radius: new Float32Array(count).fill(1),
    alpha: new Float32Array(count).fill(1),
    hit: new Uint8Array(count),
  };
}

describe('selectLabels', () => {
  it('подписывается только рисуемый узел (active === 1)', () => {
    const input = baseInput(2);
    input.radius[0] = 20; // крупный — подписался бы сам по себе
    input.radius[1] = 20;
    input.active[1] = 0;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([0]);
  });

  it('ушедший за левый край экрана (с полем в 40 px) не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 20;
    input.positions[0] = -61; // левее экрана больше, чем на 40 px с учётом радиуса
    input.positions[1] = 0;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('ушедший за верхний край экрана (с полем в 40 px) не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 20;
    input.positions[0] = 0;
    input.positions[1] = -61; // выше экрана больше, чем на 40 px с учётом радиуса
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('ушедший за правый край экрана (с полем в 40 px) не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 20;
    input.positions[0] = WIDTH + 61; // правее экрана больше, чем на 40 px с учётом радиуса
    input.positions[1] = 0;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('ушедший за нижний край экрана (с полем в 40 px) не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 20;
    input.positions[0] = 0;
    input.positions[1] = HEIGHT + 61; // ниже экрана больше, чем на 40 px с учётом радиуса
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('узел ровно на границе поля 40px ещё подписывается, за ней — уже нет', () => {
    const input = baseInput(1);
    input.radius[0] = 20;
    // sx + r = -60 + 20 = -40 — ровно на границе поля EDGE_MARGIN_PX: если бы
    // поле было обнулено (или иначе искажено), этот узел уже не прошёл бы.
    input.positions[0] = -60;
    input.positions[1] = 0;
    const atEdge = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(atEdge).toEqual([0]);

    // На 1px дальше та же арифметика уже выводит узел за поле.
    input.positions[0] = -61;
    const beyondEdge = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(beyondEdge).toEqual([]);
  });

  it('порог MIN_LABEL_RADIUS_PX сравнивается с экранным радиусом (учитывает camera.scale), а не мировым', () => {
    const camera = scaledCamera(5); // мировой радиус 2 * scale 5 = экранный 10 ≥ порога 9
    const input = baseInput(1);
    input.radius[0] = 2; // мировой радиус сам по себе меньше порога
    const result = selectLabels(input, camera, WIDTH, HEIGHT);
    expect(result).toEqual([0]);
  });

  it('крупный в мировых координатах узел не подписывается сам по себе на маленьком масштабе', () => {
    const camera = scaledCamera(0.1); // мировой радиус 50 * scale 0.1 = экранный 5 < порога
    const input = baseInput(1);
    input.radius[0] = 50;
    const result = selectLabels(input, camera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('отсечка по краю экрана идёт через camera.toScreen (масштаб и смещение), а не по мировым координатам напрямую', () => {
    const camera = scaledCamera(0.5, 300, 300); // экран = мир·0.5 + 300
    const input = baseInput(1);
    input.radius[0] = 20; // крупный, чтобы попадание зависело только от положения
    input.positions[0] = 1000; // далеко за пределами width=800 без учёта камеры
    input.positions[1] = 0;
    // Экранная позиция: 1000*0.5 + 300 = 800, экранный радиус 20*0.5=10 —
    // sx - r = 790 ≤ width(800) + 40, узел виден.
    const result = selectLabels(input, camera, WIDTH, HEIGHT);
    expect(result).toEqual([0]);
  });

  it('узел с «безопасными» мировыми координатами обрезается, если камера уводит его за экран', () => {
    const camera = scaledCamera(1, -10000, 0); // огромный сдвиг влево
    const input = baseInput(1);
    input.radius[0] = 20;
    input.positions[0] = 0; // в мировых координатах как будто в кадре
    input.positions[1] = 0;
    const result = selectLabels(input, camera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('крупный узел (экранный радиус ≥ MIN_LABEL_RADIUS_PX) подписывается сам по себе', () => {
    const input = baseInput(1);
    input.radius[0] = MIN_LABEL_RADIUS_PX;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([0]);
  });

  it('мелкий узел не подписывается сам по себе', () => {
    const input = baseInput(1);
    input.radius[0] = MIN_LABEL_RADIUS_PX - 0.5;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('мелкий узел подписывается, если он наведён', () => {
    const input = baseInput(1);
    input.radius[0] = 1;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT, { hovered: 0 });
    expect(result).toEqual([0]);
  });

  it('мелкий узел подписывается, если он найден поиском', () => {
    const input = baseInput(1);
    input.radius[0] = 1;
    input.hit[0] = 1;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([0]);
  });

  it('погашенный фильтром узел не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 20; // крупный — подписался бы, если бы не гашение
    input.alpha[0] = 0.12;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('погашенный фильтром узел подписывается, если он наведён', () => {
    const input = baseInput(1);
    input.radius[0] = 1;
    input.alpha[0] = 0.12;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT, { hovered: 0 });
    expect(result).toEqual([0]);
  });

  it('погашенный, но найденный поиском (не наведённый) не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 1;
    input.alpha[0] = 0.12;
    input.hit[0] = 1;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([]);
  });

  it('наведённый и найденные идут первыми, остальные — по убыванию экранного радиуса', () => {
    const input = baseInput(4);
    // 0: крупный, но не наведён и не найден — должен уйти в хвост.
    input.radius[0] = 30;
    // 1: найден поиском, мелкий радиус.
    input.radius[1] = 2;
    input.hit[1] = 1;
    // 2: наведён, ещё мельче.
    input.radius[2] = 1;
    // 3: крупный, но меньше узла 0.
    input.radius[3] = 15;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT, { hovered: 2 });
    expect(result).toEqual([2, 1, 0, 3]);
  });

  it('внутри одной группы приоритета сортирует по радиусу, а не по порядку вставки', () => {
    const input = baseInput(3);
    // Радиусы намеренно расставлены в порядке, обратном желаемому выводу: ни
    // один из узлов не наведён и не найден (одна группа приоритета), и если
    // бы сортировка не сравнивала радиус (мутант «компаратор возвращает 0»,
    // стабильная сортировка сохранила бы порядок вставки — [0, 1, 2]), тест
    // не заметил бы разницы. Здесь порядок вставки и порядок по радиусу
    // расходятся полностью, поэтому ложноположительный «0» ловится.
    input.radius[0] = 10;
    input.radius[1] = 20;
    input.radius[2] = 15;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toEqual([1, 2, 0]);
  });

  it('при обрезке по limit уцелевают крупнейшие по экранному радиусу, а не первые по обходу', () => {
    const input = baseInput(5);
    // Индекс 0 стоит первым по обходу, но не входит в тройку крупнейших —
    // если бы limit просто резал по порядку вставки (или сортировка не
    // работала), в выживших оказался бы он, а не узел 4.
    input.radius[0] = 12;
    input.radius[1] = 30;
    input.radius[2] = 9;
    input.radius[3] = 25;
    input.radius[4] = 18;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT, { limit: 3 });
    // По убыванию радиуса: 1(30), 3(25), 4(18), 0(12), 2(9) — уцелеть должны
    // именно первые три из этого порядка.
    expect(result).toEqual([1, 3, 4]);
  });

  it('без явного limit использует DEFAULT_LABEL_LIMIT', () => {
    const count = DEFAULT_LABEL_LIMIT + 5;
    const input = baseInput(count);
    for (let i = 0; i < count; i++) input.radius[i] = 20;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toHaveLength(DEFAULT_LABEL_LIMIT);
  });
});
