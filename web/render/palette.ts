import { hashString } from '../../src/util/hash.js';

/**
 * Единственное место, где живут строки цветов сцены. Раньше цвет каталога был
 * объявлен дважды — в отрисовке и в точке входа; теперь он просто нулевой
 * элемент палитры.
 *
 * Палитра лежит отдельно от отрисовки: цвет значка автора выводится из неё
 * (оттенок обязан отстоять от оттенков узлов), и тянуть ради этого в чистую
 * цветовую логику весь модуль с canvas было бы зависимостью не в ту сторону.
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
  return FILE_COLOR_START + (hashString(ext) % (PALETTE.length - FILE_COLOR_START));
}
