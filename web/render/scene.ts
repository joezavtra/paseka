import type { Camera } from './camera.js';
import { PALETTE } from './palette.js';

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
 */
export interface LabelLayer {
  count: number;
  path: Uint32Array;
  text: string[];
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
  /** Свечение узла от недавнего касания: 0 — нет, 1 — только что задет. */
  flash: Float32Array;
  /**
   * Найденное поиском; индекс — идентификатор пути. Отдельная ось от alpha:
   * фильтр гасит непопавшее, поиск обводит попавшее, и одно не отменяет
   * другого.
   */
  hit: Uint8Array;
  beams: BeamLayer;
  actors: ActorLayer;
  labels: LabelLayer;
}

/** Насколько узел раздувается на вспышке. */
const FLASH_GROWTH = 0.6;
/** Доля длины луча, на которую он отводится в сторону от прямой. */
const BEAM_BOW = 0.18;

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

  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = Math.max(0.4, camera.scale * 0.35);
  // Рёбер могут быть десятки тысяч, а различных альф среди них — единицы (в
  // основном погашено/не погашено, до четырёх во время перехода фильтра).
  // Группируем по округлённой альфе и на группу тратим один beginPath() и
  // один stroke(), а не по паре на каждое ребро.
  const edgeGroups = new Map<number, number[]>();
  for (let i = 0; i < input.linkSource.length; i++) {
    const source = input.linkSource[i]!;
    const target = input.linkTarget[i]!;
    // Ребро не может быть ярче своих концов: иначе погашенная ветка осталась бы
    // соединена яркими линиями и читалась бы как активная.
    const edgeAlpha = Math.min(input.alpha[source]!, input.alpha[target]!);
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

    ctx.fillStyle = '#0b0d12';
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
  for (let i = 0; i < input.labels.count; i++) {
    const path = input.labels.path[i]!;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const r = flashRadius(input.radius[path]!, input.flash[path]!) * camera.scale;
    // Та же отсечка по bbox узла, что и у остальных слоёв: подпись всё равно
    // держится вплотную к своему узлу, и если узел за кадром, то и она.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    // Яркость подписи — яркость узла, но не ниже 0.5: иначе подпись
    // наведённого узла в погашенной фильтром ветке была бы нечитаема, а
    // именно наведённый узел — тот случай, где молчать нельзя (см. labels.ts).
    ctx.globalAlpha = Math.max(0.5, input.alpha[path]!);
    ctx.fillStyle = '#c9d1d9';
    ctx.fillText(input.labels.text[i] ?? '', sx + r + 4, sy);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}
