import { hashString } from '../../src/util/hash.js';
import { PALETTE } from './palette.js';

/** Буквы и цифры любого алфавита: имена в истории бывают не только латиницей. */
const LETTER = /\p{L}|\p{N}/u;

function firstLetter(text: string): string {
  for (const char of text) {
    if (LETTER.test(char)) return char.toUpperCase();
  }
  return '';
}

/**
 * Одна-две буквы для значка автора. Имя может быть пустым или состоять из
 * знаков — тогда отступаем к почте, а если и её нет, показываем вопрос:
 * пустой кружок читался бы как ошибка отрисовки.
 */
export function initialsFor(name: string, email: string): string {
  const words = name.split(/[\s.,;:<>()"'|/\\]+/u).filter((word) => LETTER.test(word));
  const letters = words.slice(0, 2).map(firstLetter).join('');
  if (letters.length > 0) return letters;

  const fromEmail = firstLetter(email);
  return fromEmail.length > 0 ? fromEmail : '?';
}

/** На сколько градусов оттенок значка обязан отстоять от любого оттенка палитры узлов. */
export const HUE_MARGIN = 20;

/** Оттенок цвета из #rrggbb в градусах; null для серого без выраженного оттенка. */
function hexHue(hex: string): number | null {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Кратчайшее расстояние между двумя оттенками на цветовом круге. */
function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

/**
 * Оттенки, которые держатся не ближе marginDeg градусов от каждого оттенка
 * palette. Принимает палитру параметром, а не читает PALETTE напрямую: так
 * вырожденный случай (палитра плотнее отступа) проверяется тестом напрямую,
 * без подмены модуля.
 *
 * Если такого оттенка не осталось — палитру сделали настолько плотной, что
 * HUE_MARGIN нечем удовлетворить, — молчать нельзя: остаток от деления на
 * пустой список дал бы NaN, `hsl(NaN ...)` был бы для canvas негодной кистью,
 * и он молча оставил бы значок цветом предыдущей отрисовки. Вместо этого явно
 * откатываемся к полному кругу оттенков и громко предупреждаем в консоль —
 * значки при этом смогут совпасть с палитрой узлов, но хотя бы не станут
 * неопределённым поведением.
 */
export function computeSafeHues(palette: readonly string[], marginDeg: number): number[] {
  const paletteHues = palette.map(hexHue).filter((h): h is number => h !== null);
  const safe: number[] = [];
  for (let deg = 0; deg < 360; deg++) {
    if (paletteHues.every((h) => hueDistance(deg, h) >= marginDeg)) safe.push(deg);
  }
  if (safe.length > 0) return safe;

  console.warn(
    `avatarColor: палитра узлов не оставила ни одного оттенка с отступом ${marginDeg}° — ` +
      'значки откатываются на полный круг оттенков и могут совпасть с палитрой узлов.',
  );
  const fallback: number[] = [];
  for (let deg = 0; deg < 360; deg++) fallback.push(deg);
  return fallback;
}

const SAFE_HUES: readonly number[] = computeSafeHues(PALETTE, HUE_MARGIN);

/**
 * Уровни светлоты значка — вторая ось цвета поверх оттенка. Безопасных
 * оттенков всего около сотни, и при восьми авторах примерно в четверти случаев
 * двое получали один цвет; в списке авторов и в карточке узла эти двое стоят
 * рядом, и различить их было нечем, кроме имени. Расширять полосу оттенков
 * обратно нельзя — она сужена затем, чтобы значок не сливался с узлами.
 *
 * Нижняя граница — 64, а не ниже: инициалы внутри кружка тёмные, а значок
 * лежит на фоне сцены (SCENE_BACKGROUND, см. web/render/palette.ts), и на
 * самом тёмном из безопасных оттенков
 * (около 282°) контраст с фоном обязан держать WCAG AA (порог 4.5:1) с
 * заметным запасом. 58 давал только 4.54:1 — запас 0.04, любая последующая
 * правка палитры узлов срезала бы его в минус незаметно для теста. 64 держит
 * 5.6:1 на том же худшем оттенке. Соседние уровни разнесены на 6–12 пунктов:
 * само число 8 не имеет смысла — важно, что расчёт контраста (см. тест) не
 * даёт ни одной комбинации ниже 5:1.
 */
export const AVATAR_LIGHTNESS: readonly number[] = [64, 70, 82];

/**
 * Оттенок и светлота значка. Палитра оттенков и набор уровней приходят
 * параметрами, а не берутся из модуля: так тест сравнивает одну ось с двумя,
 * не подменяя модуль.
 */
export function avatarStyle(
  email: string,
  hues: readonly number[],
  lightness: readonly number[],
): { hue: number; lightness: number } {
  const key = email.trim().toLowerCase();
  const total = hues.length * lightness.length;
  const index = hashString(key) % total;
  return { hue: hues[index % hues.length]!, lightness: lightness[Math.floor(index / hues.length)]! };
}

/**
 * Цвет значка выводится из почты, а не из имени: один человек пишет имя
 * по-разному, а почта — тот же ключ, по которому авторы дедуплицируются при
 * сборке пакета, и приводится он так же.
 *
 * Оттенок выбирается только из SAFE_HUES, поэтому значок не сливается с
 * пастельной палитрой узлов даже при точном попадании хэша в её оттенок.
 * Светлота — вторая ось, она варьируется по AVATAR_LIGHTNESS: одного оттенка
 * на восьмерых авторов не хватает, а расширять полосу безопасных оттенков
 * нельзя.
 */
export function avatarColor(email: string): string {
  const style = avatarStyle(email, SAFE_HUES, AVATAR_LIGHTNESS);
  return `hsl(${style.hue} 70% ${style.lightness}%)`;
}
