import { describe, it, expect } from 'vitest';
import { Camera } from '../../web/render/camera.js';
import { EDGE_COLOR, MIN_EDGE_WIDTH_PX, edgeDepthAlpha } from '../../web/render/scene.js';
import { SCENE_BACKGROUND } from '../../web/render/palette.js';
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

/** Ширина символа в заглушке замера текста; см. measureText ниже. */
const CHAR_WIDTH_PX = 7;

interface Stub {
  ctx: CanvasRenderingContext2D;
  /** Кисть на каждом fill(). */
  fills: string[];
  /** Прозрачность на каждом fill(): по ней видно гашение узла альфой фильтра. */
  fillAlpha: number[];
  /** Кисть на каждом stroke(). */
  strokes: string[];
  /** Написанный текст вместе с кистью, местом и прозрачностью. */
  texts: { text: string; x: number; y: number; fill: string; alpha: number }[];
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
  const texts: { text: string; x: number; y: number; fill: string; alpha: number }[] = [];
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
      texts.push({ text, x, y, fill: String(ctx.fillStyle), alpha: Number(ctx.globalAlpha) });
    },
    // Ширина текста — единственное, ради чего отрисовке нужен замер: по ней
    // решается, помещается ли подпись справа от узла. Заглушка считает по
    // фиксированной ширине символа: настоящие метрики шрифта в узле недоступны,
    // а тесту нужна не типографика, а предсказуемое число.
    measureText(text: string) {
      return { width: text.length * CHAR_WIDTH_PX };
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
    // Корень и его прямой потомок: ребро между ними — первого уровня, то есть
    // рисуется в полную силу. Тесты на затухание задают глубину сами.
    depth: Uint32Array.from([0, 1]),
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
    hit: new Uint8Array(2),
    hitCount: 0,
    beams: {
      count: 0,
      fromX: new Float32Array(2),
      fromY: new Float32Array(2),
      toX: new Float32Array(2),
      toY: new Float32Array(2),
      author: new Uint32Array(2),
      strength: new Float32Array(2),
      alpha: new Float32Array(2).fill(1),
    },
    actors: {
      positions: new Float32Array(4),
      active: new Uint8Array(2),
      color: ['#111111', '#222222'],
      initials: ['АП', 'БЛ'],
      name: ['Аня Петрова', 'Бо Ли'],
    },
    labels: {
      count: 0,
      path: new Uint32Array(2),
      text: [],
      alpha: Float32Array.from(Array(16).fill(1)),
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
    expect(strokes).toEqual([EDGE_COLOR, '#222222']);
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
    expect(strokes[0]).toBe(EDGE_COLOR);
    expect(strokeAlpha[0]).toBeCloseTo(0.12, 5);
  });

  it('рисует все рёбра одной альфы одним контуром, а не по одному на ребро', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    // Звезда, а не цепочка: три ребра от одного родителя лежат на одной
    // глубине, значит и альфа у них одна — именно этот случай и должен
    // сливаться в один контур. У цепочки глубины разные, и рёбра законно
    // рисуются по отдельности (см. затухание с глубиной).
    input.active = Uint8Array.from([1, 1, 1, 1]);
    input.positions = Float32Array.from([0, 0, 10, 0, 20, 0, 30, 0]);
    input.radius = Float32Array.from([3, 3, 3, 3]);
    input.color = Uint8Array.from([DIR_COLOR_INDEX, DIR_COLOR_INDEX, DIR_COLOR_INDEX, DIR_COLOR_INDEX]);
    input.alpha = new Float32Array(4).fill(1);
    input.flash = new Float32Array(4);
    input.depth = Uint32Array.from([0, 1, 1, 1]);
    input.linkSource = Uint32Array.from([0, 0, 0]);
    input.linkTarget = Uint32Array.from([1, 2, 3]);

    drawScene(ctx, new Camera(), input, 800, 600);

    // Одна и та же альфа у всех трёх рёбер — один контур, один stroke().
    expect(strokes.filter((style) => style === EDGE_COLOR)).toHaveLength(1);
  });

  it('не рисует ребро, целиком лежащее за пределами видимой области', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    input.linkSource = Uint32Array.from([0]);
    input.linkTarget = Uint32Array.from([1]);
    // Оба конца далеко за правым краем холста 800×600.
    input.positions = Float32Array.from([10_000, 10_000, 10_050, 10_050]);

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(strokes.filter((style) => style === EDGE_COLOR)).toHaveLength(0);
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

  it('гасит луч по яркости его конца, а не только по силе события', () => {
    const { ctx, strokeAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.beams.count = 2;
    input.beams.strength[0] = 1;
    input.beams.strength[1] = 1;
    // Оба луча одинаковой силы, но второй бьёт в погашенный фильтром узел.
    input.beams.alpha[0] = 1;
    input.beams.alpha[1] = 0.12;

    drawScene(ctx, new Camera(), input, 800, 600);

    // strokeAlpha[0] — рёбра дерева; дальше два луча.
    expect(strokeAlpha[2]!).toBeLessThan(strokeAlpha[1]!);
    expect(strokeAlpha[2]!).toBeCloseTo(strokeAlpha[1]! * 0.12, 5);
  });

  it('обводит только узлы с hit === 1', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    input.hit[0] = 1;
    input.hitCount = 1;

    drawScene(ctx, new Camera(), input, 800, 600);

    // Первый stroke — ребро дерева, второй — кольцо обводки узла 0.
    expect(strokes).toEqual([EDGE_COLOR, '#f0f6fc']);
  });

  it('не обводит узел, не рисуемый на сцене', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    input.hit[0] = 1;
    input.hitCount = 1;
    input.active[0] = 0;

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(strokes).not.toContain('#f0f6fc');
  });

  it('яркость кольца не падает вместе с альфой узла', () => {
    const { ctx, strokes, strokeAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.hit[0] = 1;
    input.hitCount = 1;
    input.alpha[0] = 0.05; // узел почти погашен фильтром

    drawScene(ctx, new Camera(), input, 800, 600);

    const ringIndex = strokes.indexOf('#f0f6fc');
    expect(ringIndex).toBeGreaterThan(-1);
    // Кольцо рисуется своей постоянной яркостью, а не яркостью погашенного узла.
    expect(strokeAlpha[ringIndex]!).toBeCloseTo(0.9, 5);
  });

  it('при нулевом счётчике совпадений слой обводки не рисуется вовсе', () => {
    const { ctx, strokes } = stubContext();
    const input = sceneWithTwoNodes();
    // Держатель числа совпадений — проекция попаданий (web/state/search.ts),
    // она же заполняет и маску. Ноль означает «обводить нечего», и слой
    // выходит на этом сразу, не обходя все пути кадра ради маски, в которой
    // заведомо нет единиц. Маска здесь намеренно противоречит счётчику: так
    // видно, что спрашивают именно счётчик.
    input.hit[0] = 1;
    input.hitCount = 0;

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(strokes).not.toContain('#f0f6fc');
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

  it('рисует подпись для перечисленных в слое путей и только для них', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    input.labels = {
      count: 1,
      path: Uint32Array.from([1, 0]),
      text: ['b.ts · 3 файла'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toBe('b.ts · 3 файла');
  });

  it('яркость подписи берётся из слоя и множится на яркость узла', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    input.labels = {
      count: 2,
      path: Uint32Array.from([0, 1]),
      text: ['полная', 'бледная'],
      alpha: Float32Array.from([1, 0.45]),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    // Слой рисуется с конца, поэтому первой ложится менее важная подпись.
    expect(texts.map((t) => t.text)).toEqual(['бледная', 'полная']);
    expect(texts[0]!.alpha).toBeCloseTo(0.45, 5);
    expect(texts[1]!.alpha).toBeCloseTo(1, 5);
  });

  it('текст подписи берётся из слоя, а не собирается отрисовкой', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    // Путь 0 в дереве называется иначе, чем текст в слое: если бы отрисовка
    // собирала подпись сама, совпадения бы не случилось.
    input.labels = { count: 1, path: Uint32Array.from([0]), text: ['совсем другой текст'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts.map((t) => t.text)).toEqual(['совсем другой текст']);
  });

  it('подпись сдвинута вправо от узла на его экранный радиус плюс 4px', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    // Узел 0 стоит в мировом (0, 0) с радиусом 3 — при единичном масштабе и
    // нулевом смещении камеры экранные координаты совпадают с мировыми.
    input.labels = { count: 1, path: Uint32Array.from([0]), text: ['x'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts[0]!.x).toBeCloseTo(0 + 3 + 4, 5);
    expect(texts[0]!.y).toBeCloseTo(0, 5);
  });

  it('яркость подписи — яркость узла, но не ниже 0.5', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    input.alpha[0] = 0.1; // сильно погашен фильтром
    input.labels = { count: 1, path: Uint32Array.from([0]), text: ['x'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts).toHaveLength(1);
    expect(texts[0]!.alpha).toBeCloseTo(0.5, 5);
  });

  it('яркость подписи следует за яркостью узла выше порога 0.5', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    input.alpha[0] = 0.8;
    input.labels = { count: 1, path: Uint32Array.from([0]), text: ['x'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts[0]!.alpha).toBeCloseTo(0.8, 5);
  });

  it('подпись рисуется поверх всего: после узлов, лучей и значков', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    input.beams.count = 1;
    input.beams.author[0] = 0;
    input.actors.active[1] = 1;
    input.labels = { count: 1, path: Uint32Array.from([0]), text: ['подпись'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    // Последний написанный текст — подпись узла, а не значок автора.
    expect(texts[texts.length - 1]!.text).toBe('подпись');
  });

  it('подпись, не помещающаяся справа, уходит влево от узла и остаётся в кадре', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    // Узел стоит у самого правого края холста: справа от него текста ширины
    // «длинное имя файла» уже не поместится. Прежде подпись рисовалась там
    // всё равно и уезжала за край обрезанной — отсечка выше знает только
    // габарит узла, а текст имеет собственную ширину.
    const width = 800;
    const text = 'очень-длинное-имя.ts';
    input.positions[0] = width - 10;
    input.positions[1] = 300;
    input.labels = { count: 1, path: Uint32Array.from([0]), text: [text],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, width, 600);

    expect(texts).toHaveLength(1);
    const drawn = texts[0]!;
    expect(drawn.x).toBeLessThan(input.positions[0]!);
    expect(drawn.x + text.length * CHAR_WIDTH_PX).toBeLessThanOrEqual(width);
  });

  it('подпись, помещающаяся справа, остаётся справа', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    // Тот же узел в середине холста: места справа вдоволь, и правило «слева,
    // если не помещается» не должно срабатывать просто так.
    input.positions[0] = 300;
    input.positions[1] = 300;
    input.labels = { count: 1, path: Uint32Array.from([0]), text: ['имя.ts'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts[0]!.x).toBeCloseTo(300 + 3 + 4, 5);
  });

  it('приоритетная подпись рисуется последней, чтобы лечь поверх остальных', () => {
    const { ctx, texts } = stubContext();
    const input = sceneWithTwoNodes();
    // Слой упорядочен по убыванию важности (наведённый — первым, см.
    // selectLabels), а холст кладёт каждый следующий текст поверх
    // предыдущего: при прямом обходе ответ на наведение закрашивался бы всеми
    // прочими подписями кадра.
    input.labels = {
      count: 2,
      path: Uint32Array.from([0, 1]),
      text: ['наведённый', 'случайный сосед'],
      alpha: Float32Array.from(Array(16).fill(1)),
    };

    drawScene(ctx, new Camera(), input, 800, 600);

    expect(texts.map((t) => t.text)).toEqual(['случайный сосед', 'наведённый']);
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

describe('видимость рёбер', () => {
  /** Коэффициент контрастности по WCAG между двумя цветами #rrggbb. */
  function contrast(a: string, b: string): number {
    const channel = (value: number): number =>
      value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    const first = luminance(a);
    const second = luminance(b);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it('расчёт контраста сходится на эталонных величинах', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast(SCENE_BACKGROUND, SCENE_BACKGROUND)).toBeCloseTo(1, 5);
  });

  it('ребро отличимо от фона сцены', () => {
    // Прежний цвет давал 1.49 — линия была только в коде. Порог 3 берётся из
    // того же места, что и у подложки-гистограммы: ниже линия перестаёт
    // читаться на тёмном фоне.
    expect(contrast(EDGE_COLOR, SCENE_BACKGROUND)).toBeGreaterThan(3);
  });

  it('ребро тусклее узлов и подписей: связь не спорит с ними за внимание', () => {
    const node = contrast('#7aa2f7', SCENE_BACKGROUND);
    const label = contrast('#c9d1d9', SCENE_BACKGROUND);
    expect(contrast(EDGE_COLOR, SCENE_BACKGROUND)).toBeLessThan(node);
    expect(contrast(EDGE_COLOR, SCENE_BACKGROUND)).toBeLessThan(label);
  });

  it('ребро не тоньше пикселя даже на общем плане', () => {
    expect(MIN_EDGE_WIDTH_PX).toBeGreaterThanOrEqual(0.75);
  });
});

describe('затухание рёбер с глубиной', () => {
  it('ребро первого уровня рисуется в полную силу', () => {
    expect(edgeDepthAlpha(1)).toBe(1);
    // Глубина 0 у ребра невозможна (у корня нет родителя), но и она не должна
    // давать больше единицы.
    expect(edgeDepthAlpha(0)).toBe(1);
  });

  it('каждый следующий уровень тусклее предыдущего', () => {
    expect(edgeDepthAlpha(2)).toBeLessThan(edgeDepthAlpha(1));
    expect(edgeDepthAlpha(3)).toBeLessThan(edgeDepthAlpha(2));
    expect(edgeDepthAlpha(4)).toBeLessThan(edgeDepthAlpha(3));
  });

  it('глубокая ветка не пропадает совсем', () => {
    // Иначе на десятом уровне вложенности связь исчезла бы, а вместе с ней и
    // понимание, к какой папке относится файл.
    expect(edgeDepthAlpha(20)).toBeGreaterThan(0.2);
    expect(edgeDepthAlpha(200)).toBe(edgeDepthAlpha(20));
  });

  it('негодная глубина не даёт негодной яркости', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5]) {
      const value = edgeDepthAlpha(bad);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('на сцене глубокое ребро рисуется тусклее мелкого', () => {
    const { ctx, strokeAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.linkSource = Uint32Array.from([0]);
    input.linkTarget = Uint32Array.from([1]);
    input.depth = Uint32Array.from([0, 1]);
    drawScene(ctx, new Camera(), input, 800, 600);
    const shallow = strokeAlpha[0]!;

    const deepRun = stubContext();
    const deepInput = sceneWithTwoNodes();
    deepInput.linkSource = Uint32Array.from([0]);
    deepInput.linkTarget = Uint32Array.from([1]);
    deepInput.depth = Uint32Array.from([0, 6]);
    drawScene(deepRun.ctx, new Camera(), deepInput, 800, 600);

    expect(deepRun.strokeAlpha[0]!).toBeLessThan(shallow);
  });

  it('затухание по глубине множится на гашение фильтром, а не заменяет его', () => {
    const { ctx, strokeAlpha } = stubContext();
    const input = sceneWithTwoNodes();
    input.linkSource = Uint32Array.from([0]);
    input.linkTarget = Uint32Array.from([1]);
    input.depth = Uint32Array.from([0, 3]);
    input.alpha = Float32Array.from([1, 0.5]);
    drawScene(ctx, new Camera(), input, 800, 600);

    expect(strokeAlpha[0]!).toBeCloseTo(0.5 * edgeDepthAlpha(3), 2);
  });
});
