/** Символы, которые в регулярном выражении значат не то, что в образце пути. */
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

const cache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  const known = cache.get(pattern);
  if (known) return known;
  // Экранируем всё, затем возвращаем смысл только подстановкам.
  const source = pattern
    .replace(SPECIAL, '\\$&')
    .replace(/\\\*/g, '.*')
    .replace(/\\\?/g, '.');
  const compiled = new RegExp(`^${source}$`, 'iu');
  cache.set(pattern, compiled);
  return compiled;
}

/**
 * Образец без подстановок — это поиск подстроки: пользователь чаще всего хочет
 * «покажи всё про utils», а не пишет якоря. Как только появляется `*` или `?`,
 * образец начинает значить путь целиком, иначе `src/*` совпало бы с `lib/src/a`.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return true;
  if (!trimmed.includes('*') && !trimmed.includes('?')) {
    return path.toLowerCase().includes(trimmed.toLowerCase());
  }
  return toRegExp(trimmed).test(path);
}
