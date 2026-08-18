import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LABEL_LIMIT,
  MIN_LABEL_RADIUS_PX,
  labelFor,
  pluralFiles,
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

/** Камера-тождество: экранные координаты совпадают с мировыми, масштаб 1. */
const identityCamera: LabelCamera = {
  scale: 1,
  toScreen: (worldX: number, worldY: number) => [worldX, worldY],
};

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

  it('ушедший за край экрана (с полем в 40 px) не подписывается', () => {
    const input = baseInput(1);
    input.radius[0] = 20;
    input.positions[0] = -61; // левее экрана больше, чем на 40 px с учётом радиуса
    input.positions[1] = 0;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
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

  it('длина результата не превышает limit', () => {
    const count = 10;
    const input = baseInput(count);
    for (let i = 0; i < count; i++) input.radius[i] = 20;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT, { limit: 3 });
    expect(result).toHaveLength(3);
  });

  it('без явного limit использует DEFAULT_LABEL_LIMIT', () => {
    const count = DEFAULT_LABEL_LIMIT + 5;
    const input = baseInput(count);
    for (let i = 0; i < count; i++) input.radius[i] = 20;
    const result = selectLabels(input, identityCamera, WIDTH, HEIGHT);
    expect(result).toHaveLength(DEFAULT_LABEL_LIMIT);
  });
});
