import type { Camera } from './camera.js';
import { PALETTE, SCENE_BACKGROUND } from './palette.js';

/**
 * Лучи от авторов к задетым файлам. Оба конца — уже мировые координаты, а не
 * идентификаторы: правило «в какой узел бьёт луч» принадлежит выводу кадра
 * (web/render/activity.ts), и знать про него отрисовке незачем. Луч свёрнутой
 * папки бьёт в её представителя — это правило меняется ровно в одном месте.
 */
export interface BeamLayer {
  count: number;
  fromX: Float32Array;
  fromY: Float32Array;
  toX: Float32Array;
  toY: Float32Array;
  author: Uint32Array;
  strength: Float32Array;
  /**
   * Яркость фильтра у конца луча: её считает вывод кадра по тому же
   * представителю, что и сам конец. Отрисовке остаётся только помножить.
   */
  alpha: Float32Array;
}

/** Значки авторов; всё индексируется идентификатором автора. */
export interface ActorLayer {
  positions: Float32Array;
  active: Uint8Array;
  color: string[];
  initials: string[];
  name: string[];
}

/**
 * Подписи узлов: параллельные массивы, длина значима до `count`. Отбор — чей
 * путь сюда попал и в каком порядке — решает `selectLabels` (web/render/labels.ts);
 * отрисовке остаётся только положить готовый текст рядом с узлом, а не
 * собирать его на лету — иначе правило «показывать ли счётчик файлов»
 * задваивалось бы между сборкой сцены и кадром.
 *
 * Порядок в слое — по убыванию важности (первым идёт наведённый), поэтому
 * рисуется он с конца: холст кладёт следующий текст поверх предыдущего, и при
 * прямом обходе самая важная подпись оказывалась бы закрашена всеми
 * остальными. Наведение — жест, ответ на который закрашивать нельзя.
 */
export interface LabelLayer {
  count: number;
  path: Uint32Array;
  text: string[];
  /**
   * Множитель яркости подписи: его решает отбор (web/render/labels.ts), а не
   * отрисовка. Бледная подпись обычной папки и гаснущая подпись только что
   * изменённого файла — это одно и то же поле, потому что вопрос один:
   * насколько эта подпись важна прямо сейчас.
   */
  alpha: Float32Array;
}

export interface SceneInput {
  /** Рисуемая маска; индекс — идентификатор пути. Не то же самое, что живость: скрытый или свёрнутый живой путь сюда не входит. */
  active: Uint8Array;
  /** Пары x, y в мировых координатах; индекс пары — идентификатор пути. */
  positions: Float32Array;
  radius: Float32Array;
  /**
   * Цвет узла — индекс в PALETTE, а не строка. Числа нужны срезу 5: там цвет
   * каждого узла придётся умножать на альфу гашения покадрово, а строку для
   * этого пришлось бы каждый кадр разбирать обратно в компоненты.
   */
  color: Uint8Array;
  /**
   * Яркость узла от фильтра: 1 — попал, около нуля — нет. Фильтр именно гасит,
   * поэтому альфа множится на кисть, а узел остаётся на своём месте в дереве.
   */
  alpha: Float32Array;
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
  /**
   * Глубина пути в дереве: у корня 0, у его детей 1 и так далее. Индекс —
   * идентификатор пути. Нужна отрисовке рёбер: чем глубже связь, тем тусклее
   * она рисуется (см. edgeDepthAlpha).
   */
  depth: Uint32Array;
  /** Свечение узла от недавнего касания: 0 — нет, 1 — только что задет. */
  flash: Float32Array;
  /**
   * Найденное поиском; индекс — идентификатор пути. Отдельная ось от alpha:
   * фильтр гасит непопавшее, поиск обводит попавшее, и одно не отменяет
   * другого.
   */
  hit: Uint8Array;
  /**
   * Сколько единиц в `hit`; считается той же проекцией попаданий, что и сама
   * маска (web/state/search.ts), поэтому разойтись им неоткуда. Ноль означает
   * «обводить нечего» — и слой обводки выходит на этом сразу, не обходя все
   * пути кадра. Самый частый случай — поиск не используется вовсе, и платить
   * за него полным проходом было бы неправильно.
   */
  hitCount: number;
  beams: BeamLayer;
  actors: ActorLayer;
  labels: LabelLayer;
}

/** Насколько узел раздувается на вспышке. */
const FLASH_GROWTH = 0.6;
/** Доля длины луча, на которую он отводится в сторону от прямой. */
const BEAM_BOW = 0.18;
/**
 * Пол читаемости подписи: яркость текста не опускается ниже этого значения,
 * даже когда узел сильно погашен фильтром. Численно совпадает с
 * `DIMMED_ALPHA_THRESHOLD` из web/render/labels.ts, но это разные величины —
 * та решает, подписывать ли узел вообще, эта — насколько ярко рисовать уже
 * выбранную подпись. Совпадение чисел не повод сводить их к одной константе.
 */
const MIN_LABEL_ALPHA = 0.5;
/** Зазор между краем узла и его подписью, в экранных пикселях. */
const LABEL_GAP_PX = 4;
/**
 * Цвет ребра дерева.
 *
 * Прежний `#2a3140` давал к фону сцены контраст 1.49 — линия формально была, а
 * глазом её не было; ровно тот же дефект уже случался у подложки-гистограммы
 * (там было 1.51). Нынешнее значение даёт 3.53 при 7.72 у узлов и 12.59 у
 * подписей, то есть связь видно, но спорить с самими узлами за внимание она не
 * начинает. Число сторожит тест: он считает контраст к SCENE_BACKGROUND сам, а
 * не сверяется с записанной здесь величиной.
 */
const EDGE_COLOR = '#586a84';
/**
 * Наименьшая толщина ребра в экранных пикселях. Прежние 0.4 на общем плане
 * давали линию тоньше пикселя: сглаживание размазывало её в почти прозрачную
 * и без того малозаметную полоску.
 */
const MIN_EDGE_WIDTH_PX = 0.9;
/** Во сколько раз тускнеет ребро с каждым уровнем вложенности. */
const EDGE_DEPTH_FALLOFF = 0.72;
/** Ниже этой доли яркости ребро не опускается: глубокая ветка должна остаться видимой. */
const EDGE_MIN_DEPTH_ALPHA = 0.28;

/**
 * Насколько ярко рисовать ребро на этой глубине.
 *
 * Ствол ярче веточек: рёбра от корня держат общую форму дерева, а рёбра внутри
 * пакета из пяти вложенных папок повторяют то, что и так видно по расположению
 * узлов. Без этого все связи кричат одинаково громко, и на большом дереве
 * читается только сплошная сетка.
 *
 * Глубина считается по потомку, а не по родителю: у ребра «корень → src»
 * потомок лежит на первом уровне, и такое ребро рисуется в полную силу.
 * Затухание геометрическое, с полом — иначе на десятом уровне вложенности
 * связь пропала бы совсем, а вместе с ней и понимание, к какой папке относится
 * файл.
 */
export function edgeDepthAlpha(depth: number): number {
  if (!Number.isFinite(depth)) return EDGE_MIN_DEPTH_ALPHA;
  const level = Math.max(1, Math.floor(depth));
  return Math.max(EDGE_MIN_DEPTH_ALPHA, Math.pow(EDGE_DEPTH_FALLOFF, level - 1));
}

/** Радиус узла с учётом свечения от недавнего касания. */
export function flashRadius(radius: number, flash: number): number {
  const base = Math.max(0, radius);
  const strength = Math.min(1, Math.max(0, flash));
  return base * (1 + FLASH_GROWTH * strength);
}

/**
 * Контрольная точка квадратичной кривой луча. Прямая линия от автора к файлу
 * читается как ребро дерева; изгиб отделяет одно от другого.
 */
export function beamControl(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return [mx, my];
  return [mx - (dy / length) * length * BEAM_BOW, my + (dx / length) * length * BEAM_BOW];
}

export { EDGE_COLOR, MIN_EDGE_WIDTH_PX };

export function drawScene(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  input: SceneInput,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);

  // Кадр берёт контекст в известном состоянии и возвращает его таким же:
  // шрифт, толщина линии, кисть и прозрачность здесь задаются посекционно, и
  // следующий слой не должен зависеть от того, что осталось от предыдущего.
  ctx.save();

  ctx.strokeStyle = EDGE_COLOR;
  ctx.lineWidth = Math.max(MIN_EDGE_WIDTH_PX, camera.scale * 0.35);
  // Рёбер могут быть десятки тысяч, а различных альф среди них — десятки:
  // состояние фильтра (погашено, не погашено, промежуточные во время перехода)
  // умножается на затухание по глубине, а глубин в реальном дереве — до
  // полутора десятков, и дальше все упираются в пол. Группируем по округлённой
  // альфе и на группу тратим один beginPath() и один stroke(), а не по паре на
  // каждое ребро.
  const edgeGroups = new Map<number, number[]>();
  for (let i = 0; i < input.linkSource.length; i++) {
    const source = input.linkSource[i]!;
    const target = input.linkTarget[i]!;
    // Ребро не может быть ярче своих концов: иначе погашенная ветка осталась бы
    // соединена яркими линиями и читалась бы как активная. Поверх этого —
    // затухание с глубиной: ствол ярче веточек.
    const edgeAlpha =
      Math.min(input.alpha[source]!, input.alpha[target]!) * edgeDepthAlpha(input.depth[target]!);
    if (edgeAlpha <= 0) continue;
    const [ax, ay] = camera.toScreen(input.positions[source * 2]!, input.positions[source * 2 + 1]!);
    const [bx, by] = camera.toScreen(input.positions[target * 2]!, input.positions[target * 2 + 1]!);
    // Отсечение по bbox отрезка: та же экономия, что и у узлов ниже.
    if (
      Math.max(ax, bx) < 0 ||
      Math.min(ax, bx) > width ||
      Math.max(ay, by) < 0 ||
      Math.min(ay, by) > height
    ) {
      continue;
    }
    const key = Math.round(edgeAlpha * 1000);
    let group = edgeGroups.get(key);
    if (!group) {
      group = [];
      edgeGroups.set(key, group);
    }
    group.push(ax, ay, bx, by);
  }
  for (const [key, coords] of edgeGroups) {
    ctx.globalAlpha = key / 1000;
    ctx.beginPath();
    for (let i = 0; i < coords.length; i += 4) {
      ctx.moveTo(coords[i]!, coords[i + 1]!);
      ctx.lineTo(coords[i + 2]!, coords[i + 3]!);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] === 0) continue;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const flash = input.flash[path]!;
    const r = flashRadius(input.radius[path]!, flash) * camera.scale;
    // Отсечение: за границами вида рисовать нечего, а узлов десятки тысяч.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.globalAlpha = input.alpha[path]!;
    ctx.fillStyle = PALETTE[input.color[path]!]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
    if (flash > 0) {
      // Подсветку кладём поверх цвета узла, а не подменяем его: так виден и
      // тип файла, и факт касания.
      ctx.globalAlpha = Math.min(1, flash) * 0.55 * input.alpha[path]!;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Кольцо рисуется своей яркостью, а не яркостью узла: это единственный слой,
  // который сознательно не умножается на альфу фильтра. Найденный файл в
  // погашенной ветке обязан остаться погашенным — фильтр поиском не
  // отменяется, — но если погасить и кольцо, поиск по отфильтрованному дереву
  // не найдёт ничего видимого.
  //
  // Счётчик найденного спрашивается до обхода: без поиска (а это самый частый
  // случай за сеанс) слой не стоит вообще ничего, вместо прохода по всем путям
  // ради маски, в которой заведомо нет ни одной единицы.
  if (input.hitCount > 0) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#f0f6fc';
    ctx.lineWidth = 2;
    for (let path = 0; path < input.active.length; path++) {
      if (input.active[path] === 0 || input.hit[path] !== 1) continue;
      const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
      const r = flashRadius(input.radius[path]!, input.flash[path]!) * camera.scale + 3;
      if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(2, r), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.lineWidth = 1.4;
  for (let i = 0; i < input.beams.count; i++) {
    const [ax, ay] = camera.toScreen(input.beams.fromX[i]!, input.beams.fromY[i]!);
    const [bx, by] = camera.toScreen(input.beams.toX[i]!, input.beams.toY[i]!);
    const [cx, cy] = beamControl(ax, ay, bx, by);
    // Луч не может быть ярче узла, в который бьёт: иначе снятые галочки
    // авторов гасили бы файлы, а лучи по ним светили бы в полную силу.
    ctx.globalAlpha =
      Math.min(1, Math.max(0, input.beams.strength[i]!)) *
      0.8 *
      Math.min(1, Math.max(0, input.beams.alpha[i]!));
    ctx.strokeStyle = input.actors.color[input.beams.author[i]!] ?? '#ffffff';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy, bx, by);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Значки рисуются экранным размером, а не мировым: они должны читаться на
  // любом масштабе, иначе на отдалении от них останутся точки.
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let author = 0; author < input.actors.active.length; author++) {
    if (input.actors.active[author] === 0) continue;
    const [sx, sy] = camera.toScreen(
      input.actors.positions[author * 2]!,
      input.actors.positions[author * 2 + 1]!,
    );
    if (sx < -40 || sy < -40 || sx > width + 40 || sy > height + 40) continue;

    ctx.fillStyle = input.actors.color[author] ?? '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = SCENE_BACKGROUND;
    ctx.fillText(input.actors.initials[author] ?? '?', sx, sy + 0.5);

    ctx.textAlign = 'left';
    ctx.fillStyle = input.actors.color[author] ?? '#ffffff';
    ctx.fillText(input.actors.name[author] ?? '', sx + 15, sy + 0.5);
    ctx.textAlign = 'center';
  }

  // Подписи — последний слой (§11: рёбра → узлы → лучи → значки → подписи):
  // текст должен лежать поверх всего остального, иначе его перекроют более
  // ранние слои. Кто подписан и каким текстом решает selectLabels заранее —
  // здесь только отрисовка готового слоя, без сборки текста на лету.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  // Слой обходится с конца: он упорядочен по убыванию важности, а холст кладёт
  // каждый следующий текст поверх предыдущего (см. докблок LabelLayer).
  for (let i = input.labels.count - 1; i >= 0; i--) {
    const path = input.labels.path[i]!;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const r = flashRadius(input.radius[path]!, input.flash[path]!) * camera.scale;
    // Та же отсечка по bbox узла, что и у остальных слоёв: подпись всё равно
    // держится вплотную к своему узлу, и если узел за кадром, то и она.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    // Яркость подписи — яркость узла, но не ниже MIN_LABEL_ALPHA: иначе
    // подпись наведённого узла в погашенной фильтром ветке была бы нечитаема,
    // а именно наведённый узел — тот случай, где молчать нельзя (см. labels.ts).
    // Сверху накладывается множитель важности из слоя: он делает подписи папок
    // бледнее файловых и гасит подпись изменённого файла вместе с его вспышкой.
    ctx.globalAlpha =
      Math.max(MIN_LABEL_ALPHA, input.alpha[path]!) *
      Math.min(1, Math.max(0, input.labels.alpha[i]!));
    ctx.fillStyle = '#c9d1d9';
    const text = input.labels.text[i] ?? '';
    // Подпись стоит справа от узла, но у правого края окна она уезжала за кадр
    // и обрезалась: отсечка выше знает только габарит узла, а текст рисуется
    // правее него и имеет собственную ширину. Не помещается справа — кладём
    // слева от узла: подпись остаётся при своём узле и целиком видна.
    const rightX = sx + r + LABEL_GAP_PX;
    const textWidth = ctx.measureText(text).width;
    const x = rightX + textWidth <= width ? rightX : sx - r - LABEL_GAP_PX - textWidth;
    ctx.fillText(text, x, sy);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
