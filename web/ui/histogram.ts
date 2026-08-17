/**
 * Плотность коммитов по времени. Раскладка идёт по значению времени, а не по
 * порядку в массиве: даты автора немонотонны после rebase и cherry-pick.
 */
export function bucketCommits(ts: Uint32Array, buckets: number): Uint32Array {
  // Проверка — до выделения массива: конструктор Uint32Array бросает
  // RangeError на отрицательной длине и молча обрезает дробную, так что
  // проверять buckets уже после `new Uint32Array(buckets)` бессмысленно —
  // до неё просто не дойти (или она проверяет не то, что было передано).
  if (!Number.isInteger(buckets) || buckets <= 0) return new Uint32Array(0);

  const counts = new Uint32Array(buckets);
  if (ts.length === 0) return counts;

  let min = ts[0]!;
  let max = ts[0]!;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i]! < min) min = ts[i]!;
    if (ts[i]! > max) max = ts[i]!;
  }

  const span = max - min;
  if (span === 0) {
    counts[0] = ts.length;
    return counts;
  }
  for (let i = 0; i < ts.length; i++) {
    // Крайнее правое значение иначе попало бы в несуществующую корзину.
    const bucket = Math.min(buckets - 1, Math.floor(((ts[i]! - min) / span) * buckets));
    counts[bucket]++;
  }
  return counts;
}

/**
 * Рисует плотность коммитов подложкой под слайдером.
 *
 * Без hover-подсказки и без легенды намеренно: это не самостоятельный график,
 * а фон под range-инпутом, который и владеет указателем (тянешь — перематываешь
 * историю). Собственный tooltip дрался бы с этим жестом за курсор.
 *
 * Столбики — плоские прямоугольники без скруглённых концов и с зазором в 1px,
 * тоже намеренно: на панели транспорта ~120 корзин на всю ширину, то есть
 * столбик шириной около 8px. Скругление радиусом 4px съело бы такой столбик
 * целиком, а зазор в 2px — это уже четверть его ширины. Для такой плотной
 * микрогистограммы это неподходящая спека для обычных баров.
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
    // Минимум в один пиксель: полностью пустой промежуток должен отличаться
    // от промежутка с единственным коммитом.
    const barHeight = counts[i]! === 0 ? 0 : Math.max(1, (counts[i]! / peak) * height);
    ctx.fillRect(i * step, height - barHeight, Math.max(1, step - 1), barHeight);
  }
}
