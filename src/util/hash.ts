/**
 * FNV-1a, 32 бита — устойчивый хэш строки для выбора цвета.
 *
 * Живёт рядом с генератором псевдослучайных чисел и по тем же причинам:
 * Math.random() запрещён, а цвет расширения и цвет значка автора обязаны
 * совпадать от запуска к запуску. Модуль чистый и не трогает node:, поэтому
 * годится и для кода в web/.
 */
export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}
