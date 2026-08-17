import type { Camera } from './camera.js';

/**
 * Лучи от авторов к задетым файлам. Параллельные массивы, а не объекты:
 * лучей бывает несколько сотен, и пересобирать их каждый кадр объектами
 * означало бы мусорить в горячем пути отрисовки.
 */
export interface BeamLayer {
  count: number;
  fromX: Float32Array;
  fromY: Float32Array;
  toPath: Uint32Array;
  author: Uint32Array;
  strength: Float32Array;
}

/** Значки авторов; всё индексируется идентификатором автора. */
export interface ActorLayer {
  positions: Float32Array;
  active: Uint8Array;
  color: string[];
  initials: string[];
  name: string[];
}

export interface SceneInput {
  /** Маска живых узлов; индекс — идентификатор пути. */
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
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
  /** Свечение узла от недавнего касания: 0 — нет, 1 — только что задет. */
  flash: Float32Array;
  beams: BeamLayer;
  actors: ActorLayer;
}

/**
 * Единственное место, где живут строки цветов сцены. Раньше цвет каталога был
 * объявлен дважды — здесь и в точке входа; теперь он просто нулевой элемент
 * палитры.
 */
export const PALETTE: readonly string[] = [
  '#39414d', // 0 — каталог и файл без расширения
  '#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff',
  '#f7768e', '#73daca', '#ff9e64', '#c0caf5', '#b4f9f8',
];

/** Цвет каталога и файла без расширения. */
export const DIR_COLOR_INDEX = 0;

/** С какого индекса начинаются цвета файлов: нулевой занят каталогами. */
const FILE_COLOR_START = 1;

/** Устойчивый цвет по расширению файла: одно расширение — один цвет палитры. */
export function paletteIndexForPath(path: string): number {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  if (ext === '') return DIR_COLOR_INDEX;
  let hash = 2166136261;
  for (let i = 0; i < ext.length; i++) {
    hash = Math.imul(hash ^ ext.charCodeAt(i), 16777619);
  }
  return FILE_COLOR_START + ((hash >>> 0) % (PALETTE.length - FILE_COLOR_START));
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

  ctx.strokeStyle = '#2a3140';
  ctx.lineWidth = Math.max(0.4, camera.scale * 0.35);
  ctx.beginPath();
  for (let i = 0; i < input.linkSource.length; i++) {
    const a = input.linkSource[i]! * 2;
    const b = input.linkTarget[i]! * 2;
    const [ax, ay] = camera.toScreen(input.positions[a]!, input.positions[a + 1]!);
    const [bx, by] = camera.toScreen(input.positions[b]!, input.positions[b + 1]!);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] === 0) continue;
    const [sx, sy] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const flash = input.flash[path]!;
    const r = flashRadius(input.radius[path]!, flash) * camera.scale;
    // Отсечение: за границами вида рисовать нечего, а узлов десятки тысяч.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.fillStyle = PALETTE[input.color[path]!]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
    if (flash > 0) {
      // Подсветку кладём поверх цвета узла, а не подменяем его: так виден и
      // тип файла, и факт касания.
      ctx.globalAlpha = Math.min(1, flash) * 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  ctx.lineWidth = 1.4;
  for (let i = 0; i < input.beams.count; i++) {
    const path = input.beams.toPath[i]!;
    if (input.active[path] === 0) continue;
    const [ax, ay] = camera.toScreen(input.beams.fromX[i]!, input.beams.fromY[i]!);
    const [bx, by] = camera.toScreen(input.positions[path * 2]!, input.positions[path * 2 + 1]!);
    const [cx, cy] = beamControl(ax, ay, bx, by);
    ctx.globalAlpha = Math.min(1, Math.max(0, input.beams.strength[i]!)) * 0.8;
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
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
