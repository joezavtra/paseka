import { PALETTE } from './scene.js';

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
const HUE_MARGIN = 20;

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
 * Оттенки значка ограничены полосами, которые держатся не ближе HUE_MARGIN
 * градусов от любого оттенка палитры узлов (PALETTE, render/scene.ts).
 * Полосы считаются один раз при загрузке модуля от актуальной палитры, а не
 * прописаны числами: захардкоженный список тихо разошёлся бы с палитрой при
 * первой же правке PALETTE, и значок снова сливался бы с узлом — то есть
 * повторил бы баг, который эта проверка устраняет.
 */
const SAFE_HUES: readonly number[] = (() => {
  const paletteHues = PALETTE.map(hexHue).filter((h): h is number => h !== null);
  const safe: number[] = [];
  for (let deg = 0; deg < 360; deg++) {
    if (paletteHues.every((h) => hueDistance(deg, h) >= HUE_MARGIN)) safe.push(deg);
  }
  return safe;
})();

/**
 * Цвет значка выводится из почты, а не из имени: один человек пишет имя
 * по-разному, а почта — тот же ключ, по которому авторы дедуплицируются при
 * сборке пакета, и приводится он так же.
 *
 * Насыщенность и светлота фиксированы: значки должны читаться поверх тёмной
 * сцены. Оттенок выбирается только из SAFE_HUES, поэтому значок не сливается
 * с пастельной палитрой узлов даже при точном попадании хэша в её оттенок.
 */
export function avatarColor(email: string): string {
  const key = email.trim().toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  }
  const hue = SAFE_HUES[(hash >>> 0) % SAFE_HUES.length]!;
  return `hsl(${hue} 70% 66%)`;
}
