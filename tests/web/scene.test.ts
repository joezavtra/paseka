import { describe, it, expect } from 'vitest';
import { Camera } from '../../web/render/camera.js';
import { drawScene, type SceneInput } from '../../web/render/scene.js';
import { DIR_COLOR_INDEX, PALETTE } from '../../web/render/palette.js';

/** Свойства контекста, которые кадр вправе менять и обязан вернуть как было. */
const STATE_KEYS = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'globalAlpha',
  'font',
  'textAlign',
  'textBaseline',
] as const;

interface Stub {
  ctx: CanvasRenderingContext2D;
  /** Кисть на каждом fill(). */
  fills: string[];
  /** Прозрачность на каждом fill(): по ней видно гашение узла альфой фильтра. */
  fillAlpha: number[];
  /** Кисть на каждом stroke(). */
  strokes: string[];
  /** Написанный текст вместе с кистью и местом. */
  texts: { text: string; x: number; y: number; fill: string }[];
  /** Конец каждой квадратичной кривой: сюда бьёт луч. */
  curves: { cx: number; cy: number; x: number; y: number }[];
  /** Прозрачность на каждом stroke(): по ней видно затухание луча. */
  strokeAlpha: number[];
}

/**
 * Заглушка контекста canvas, достаточная для всех слоёв кадра — узлов, лучей и
 * значков. Бедная заглушка вынуждала бы тест передавать пустые слои (иначе
 * падение на отсутствующем методе), и слои лучей и значков были бы недостижимы.
 * save/restore реализованы честным стеком: без этого нечем проверить, что кадр
 * возвращает контекст в исходное состояние.
 */
function stubContext(): Stub {
  const fills: string[] = [];
  const fillAlpha: number[] = [];
  const strokes: string[] = [];
  const strokeAlpha: number[] = [];
  const texts: { text: string; x: number; y: number; fill: string }[] = [];
  const curves: { cx: number; cy: number; x: number; y: number }[] = [];
  const stack: Record<string, unknown>[] = [];

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      curves.push({ cx, cy, x, y });
    },
    stroke() {
      strokes.push(String(ctx.strokeStyle));
      strokeAlpha.push(Number(ctx.globalAlpha));
    },
    fill() {
      fills.push(String(ctx.fillStyle));
      fillAlpha.push(Number(ctx.globalAlpha));
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, fill: String(ctx.fillStyle) });
    },
    save() {
      const bag = ctx as unknown as Record<string, unknown>;
      const snapshot: Record<string, unknown> = {};
      for (const key of STATE_KEYS) snapshot[key] = bag[key];
      stack.push(snapshot);
    },
    restore() {
      const snapshot = stack.pop();
      if (!snapshot) return;
      const bag = ctx as unknown as Record<string, unknown>;
      for (const key of STATE_KEYS) bag[key] = snapshot[key];
    },
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fills,
    fillAlpha,
    strokes,
    texts,
    curves,
    strokeAlpha,
  };
}

/** Сцена из двух узлов без лучей и значков — основа, которую дописывают тесты. */
function sceneWithTwoNodes(): SceneInput {
  return {
    active: Uint8Array.from([1, 1]),
    positions: Float32Array.from([0, 0, 10, 10]),
    radius: Float32Array.from([3, 3]),
    // Цвет — индекс в палитре, а не строка: его приходится умножать на альфу
    // гашения покадрово, и строки для этого негодны.
    color: Uint8Array.from([DIR_COLOR_INDEX, 3]),
    alpha: new Float32Array(2).fill(1),
    // Ребро между двумя узлами сцены: по умолчанию оба конца в полной яркости,
    // поэтому оно рисуется всегда первым stroke() кадра — на это опираются
    // тесты, которые проверяют кисть и прозрачность именно рёбер.
    linkSource: Uint32Array.from([0]),
    linkTarget: Uint32Array.from([1]),
    flash: new Float32Array(2),
    beams: {
      count: 0,
      fromX: new Float32Array(2),
      fromY: new Float32Array(2),
      toX: new Float32Array(2),
      toY: new Float32Array(2),
      author: new Uint32Array(2),
      strength: new Float32Array(2),
    },
    actors: {
      positions: new Float32Array(4),
      active: new Uint8Array(2),
      color: ['#111111', '#222222'],
      initials: ['АП', 'БЛ'],
      name: ['Аня Петрова', 'Бо Ли'],
    },
  };
}

describe('drawScene', () => {
  it('берёт строку кисти из палитры по числовому индексу узла', () => {
    const { ctx, fills } = stubContext();
    drawScene(ctx, new Camera(), sceneWithTwoNodes(), 800, 600);
    expect(fills).toEqual([PALETTE[DIR_COLOR_INDEX], PALETTE[3]]);
  });

  it('красит луч цветом его автора, а не автора с номером луча', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    // Единственный луч (индекс 0) принадлежит автору 1: если отрисовка возьмёт
    // цвет по индексу луча, а не по идентификатору автора, цвета совпадут
    // с чужим автором и разница будет видна именно здесь.
    input.beams.count = 1;
    input.beams.author[0] = 1;
    input.beams.fromX[0] = 40;
    input.beams.fromY[0] = 50;
    input.beams.toX[0] = 10;
    input.beams.toY[0] = 10;
    input.beams.strength[0] = 1;

    drawScene(ctx, new Camera(), input, 800, 600);

    // Первый stroke — рёбра дерева, дальше идут лучи.
    expect(strokes).toEqual(['#2a3140', '#222222']);
  });

  it('ведёт луч в те координаты, которые ему дали, не заглядывая в маску живых', () => {
    const { ctx, curves } = stubContext();
    const input = sceneWithTwoNodes();
    input.beams.count = 1;
    input.beams.author[0] = 0;
    input.beams.fromX[0] = 40;
    input.beams.fromY[0] = 50;
    input.beams.toX[0] = 10;
    input.beams.toY[0] = 10;
    input.beams.strength[0] = 0.5;
    // Правило видимости принадлежит выводу кадра: сюда луч приходит уже
    // разрешённым в координаты. Гасим всю маску живых — луч обязан остаться,
    // иначе в отрисовке завелась вторая копия правила «в какой узел бьёт луч»,
    // и в срезе 5 (свёрнутая папка бьёт в представителя) они разойдутся.
    input.active.fill(0);

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(curves).toHaveLength(1);
    expect(curves[0]!.x).toBeCloseTo(10, 5);
    expect(curves[0]!.y).toBeCloseTo(10, 5);
  });

  it('гасит узел по альфе, не убирая его со сцены', () => {
    const { ctx, fills, fillAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.alpha[0] = 1;
    input.alpha[1] = 0.12;

    drawScene(ctx, new Camera(), input, 800, 600);

    // Узел погашен, но не пропал: оба fill() состоялись, и среди прозрачностей
    // есть яркость погашенного узла. Значение прошло через Float32Array,
    // поэтому сравниваем с допуском, а не на точное равенство.
    expect(fillAlpha.some((value) => Math.abs(value - 0.12) < 1e-4)).toBe(true);
    expect(fills.length).toBe(2);
  });

  it('гасит ребро вместе с его более тусклым концом', () => {
    const { ctx, strokes, strokeAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.alpha[0] = 1;
    input.alpha[1] = 0.12;

    drawScene(ctx, new Camera(), input, 800, 600);

    // Первый stroke — ребро дерева: его прозрачность не может быть ярче
    // погашенного конца, иначе ветка выглядела бы соединённой яркой линией.
    expect(strokes[0]).toBe('#2a3140');
    expect(strokeAlpha[0]).toBeCloseTo(0.12, 5);
  });

  it('рисует все рёбра одной альфы одним контуром, а не по одному на ребро', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    // Четыре узла в ряд, три ребра, все концы в полной альфе.
    input.active = Uint8Array.from([1, 1, 1, 1]);
    input.positions = Float32Array.from([0, 0, 10, 0, 20, 0, 30, 0]);
    input.radius = Float32Array.from([3, 3, 3, 3]);
    input.color = Uint8Array.from([DIR_COLOR_INDEX, DIR_COLOR_INDEX, DIR_COLOR_INDEX, DIR_COLOR_INDEX]);
    input.alpha = new Float32Array(4).fill(1);
    input.flash = new Float32Array(4);
    input.linkSource = Uint32Array.from([0, 1, 2]);
    input.linkTarget = Uint32Array.from([1, 2, 3]);

    drawScene(ctx, new Camera(), input, 800, 600);

    // Одна и та же альфа у всех трёх рёбер — один контур, один stroke().
    expect(strokes.filter((style) => style === '#2a3140')).toHaveLength(1);
  });

  it('не рисует ребро, целиком лежащее за пределами видимой области', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    input.linkSource = Uint32Array.from([0]);
    input.linkTarget = Uint32Array.from([1]);
    // Оба конца далеко за правым краем холста 800×600.
    input.positions = Float32Array.from([10_000, 10_000, 10_050, 10_050]);

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(strokes.filter((style) => style === '#2a3140')).toHaveLength(0);
  });

  it('гасит луч по его силе', () => {
    const { ctx, strokeAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.beams.count = 2;
    input.beams.strength[0] = 1;
    input.beams.strength[1] = 0.25;

    drawScene(ctx, new Camera(), input, 800, 600);

    // strokeAlpha[0] — рёбра дерева; дальше два луча.
    expect(strokeAlpha[1]!).toBeGreaterThan(strokeAlpha[2]!);
    expect(strokeAlpha[2]!).toBeGreaterThan(0);
  });

  it('рисует значок автора: кружок его цветом, инициалы и имя рядом', () => {
    const { ctx, fills, texts } = stubContext();
    const input = sceneWithTwoNodes();
    input.actors.active[1] = 1;
    input.actors.positions[2] = 100;
    input.actors.positions[3] = 200;

    drawScene(ctx, new Camera(), input, 800, 600);

    // Последний fill — кружок значка, поверх двух узлов.
    expect(fills[fills.length - 1]).toBe('#222222');
    expect(texts.map((t) => t.text)).toEqual(['БЛ', 'Бо Ли']);
    expect(texts[0]!.x).toBeCloseTo(100, 5);
    expect(texts[1]!.x).toBeGreaterThan(100);
    expect(texts[1]!.fill).toBe('#222222');
  });

  it('не рисует значок автора без активности', () => {
    const { ctx, texts } = stubContext();
    drawScene(ctx, new Camera(), sceneWithTwoNodes(), 800, 600);
    expect(texts).toEqual([]);
  });

  it('возвращает контекст в то состояние, в котором его взял', () => {
    const stub = stubContext();
    const bag = stub.ctx as unknown as Record<string, unknown>;
    bag['font'] = '20px serif';
    bag['lineWidth'] = 7;
    bag['fillStyle'] = '#abcdef';
    bag['globalAlpha'] = 0.5;
    bag['textAlign'] = 'right';
    const before: Record<string, unknown> = {};
    for (const key of STATE_KEYS) before[key] = bag[key];

    const input = sceneWithTwoNodes();
    input.beams.count = 1;
    input.actors.active[0] = 1;
    drawScene(stub.ctx, new Camera(), input, 800, 600);

    for (const key of STATE_KEYS) expect([key, bag[key]]).toEqual([key, before[key]]);
  });
});
