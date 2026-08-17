/**
 * Активность по индексу коммита — в той же оси, что и слайдер перемотки.
 *
 * Слайдер линеен по индексу коммита, поэтому и подложка под ним обязана быть
 * линейной по индексу: раскладка по значению времени промахивалась мимо
 * коммита, к которому пользователь тянул ползунок (репозиторий с длинной
 * паузой и последующим всплеском разъезжается в этих осях особенно сильно).
 *
 * Высота столбика — не плотность коммитов, а объём изменений: по индексу
 * коммиты распределены равномерно по построению, и их плотность нарисовала бы
 * ровную полосу. Число изменений в диапазоне коммитов берётся из CSR-смещений
 * событий как разность границ — отдельный проход по событиям не нужен.
 *
 * Дат в расчёте больше нет, поэтому и немонотонность дат автора (rebase,
 * cherry-pick, `git am`) здесь ни на что не влияет — сортировать по времени
 * не нужно и не следует.
 */
export function bucketActivity(commitEventStart: Uint32Array, buckets: number): Uint32Array {
  // Проверка — до выделения массива: конструктор Uint32Array бросает
  // RangeError на отрицательной длине и молча обрезает дробную, так что
  // проверять buckets уже после `new Uint32Array(buckets)` бессмысленно —
  // до неё просто не дойти (или она проверяет не то, что было передано).
  if (!Number.isInteger(buckets) || buckets <= 0) return new Uint32Array(0);

  const counts = new Uint32Array(buckets);
  // В CSR границ на единицу больше, чем коммитов; пустая история — это либо
  // единственный ноль, либо вовсе пустой массив.
  const commitCount = commitEventStart.length - 1;
  if (commitCount <= 0) return counts;

  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = Math.floor((bucket * commitCount) / buckets);
    // Последняя корзина забирает хвост целиком: при делении с округлением
    // вниз крайний правый коммит иначе оказался бы за пределами всех корзин.
    const to =
      bucket === buckets - 1 ? commitCount : Math.floor(((bucket + 1) * commitCount) / buckets);
    counts[bucket] = commitEventStart[to]! - commitEventStart[from]!;
  }
  return counts;
}

/** Ширина столбика с зазором, к которой стремится расчёт числа корзин. */
const BAR_WIDTH = 6;
const MIN_BUCKETS = 8;
const MAX_BUCKETS = 512;

/**
 * Сколько корзин строить на дорожку заданной ширины.
 *
 * Жёсткая сотня с лишним корзин годилась только для широкого окна: на узком
 * дорожка сжимается и столбики вырождаются в штрихи шириной в пиксель.
 * Нижняя граница не даёт гистограмме исчезнуть на совсем узком экране,
 * верхняя — уйти в тысячи корзин, где столбик снова тоньше пикселя, а расчёт
 * дороже пользы. Нечисловая или нулевая ширина (канва ещё не в документе)
 * даёт минимум, а не ноль: ноль расчёт бы отверг и подложка пропала бы.
 */
export function bucketCountForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return MIN_BUCKETS;
  return Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, Math.floor(width / BAR_WIDTH)));
}

/**
 * Рисует активность подложкой под слайдером.
 *
 * Без hover-подсказки и без легенды намеренно: это не самостоятельный график,
 * а фон под range-инпутом, который и владеет указателем (тянешь — перематываешь
 * историю). Собственный tooltip дрался бы с этим жестом за курсор.
 *
 * Столбики — плоские прямоугольники без скруглённых концов и с зазором в 1px,
 * тоже намеренно: на панели транспорта столбик выходит около 6px шириной.
 * Скругление радиусом 4px съело бы такой столбик целиком, а зазор в 2px — это
 * треть его ширины. Для такой плотной микрогистограммы это неподходящая спека
 * для обычных баров.
 */
export function drawHistogram(canvas: HTMLCanvasElement, counts: Uint32Array): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (counts.length === 0) return;

  let peak = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i]! > peak) peak = counts[i]!;
  if (peak === 0) return;

  const step = width / counts.length;
  // #586a84 даёт ~3.14:1 к фону панели транспорта (#161b22, см. план среза,
  // Task 7) — исходный #2f3a4d давал ~1.51:1, то есть подложка была
  // практически не видна. Посчитано скриптом, не на глаз (см. отчёт задачи).
  ctx.fillStyle = '#586a84';
  for (let i = 0; i < counts.length; i++) {
    // Минимум в один пиксель: промежуток без единого изменения должен
    // отличаться от промежутка с одним изменением.
    const barHeight = counts[i]! === 0 ? 0 : Math.max(1, (counts[i]! / peak) * height);
    ctx.fillRect(i * step, height - barHeight, Math.max(1, step - 1), barHeight);
  }
}
