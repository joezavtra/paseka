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
  return matchWildcard(path.toLowerCase(), trimmed.toLowerCase());
}

/**
 * Сопоставление с `*`/`?` двумя указателями вместо регулярного выражения.
 * Регэксп с обратным отслеживанием на образце вида `a*a*a*…*b` уходит в
 * экспоненциальное время на несовпадающей строке, а на очень длинном образце
 * вообще не компилируется. Этот алгоритм линеен по построению: на звёздочке
 * запоминаем её позицию и место в строке, при несовпадении откатываемся к
 * последней звёздочке и сдвигаем запомненное место на один символ.
 */
function matchWildcard(path: string, pattern: string): boolean {
  let pathIdx = 0;
  let patternIdx = 0;
  let starPatternIdx = -1;
  let starPathIdx = -1;

  while (pathIdx < path.length) {
    // Звёздочку образца проверяем раньше совпадения символов: если в самом пути
    // встретилась буквальная `*`, она не должна «съесть» звёздочку образца как
    // обычный литерал и лишить нас точки отката.
    if (patternIdx < pattern.length && pattern[patternIdx] === '*') {
      starPatternIdx = patternIdx;
      starPathIdx = pathIdx;
      patternIdx++;
    } else if (patternIdx < pattern.length && (pattern[patternIdx] === '?' || pattern[patternIdx] === path[pathIdx])) {
      pathIdx++;
      patternIdx++;
    } else if (starPatternIdx !== -1) {
      patternIdx = starPatternIdx + 1;
      starPathIdx++;
      pathIdx = starPathIdx;
    } else {
      return false;
    }
  }

  while (patternIdx < pattern.length && pattern[patternIdx] === '*') {
    patternIdx++;
  }
  return patternIdx === pattern.length;
}
