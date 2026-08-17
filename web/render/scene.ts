import type { Camera } from './camera.js';

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
    const r = input.radius[path]! * camera.scale;
    // Отсечение: за границами вида рисовать нечего, а узлов десятки тысяч.
    if (sx + r < 0 || sy + r < 0 || sx - r > width || sy - r > height) continue;
    ctx.fillStyle = PALETTE[input.color[path]!]!;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  }
}
