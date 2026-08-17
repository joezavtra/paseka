/**
 * Плотность коммитов по времени. Раскладка идёт по значению времени, а не по
 * порядку в массиве: даты автора немонотонны после rebase и cherry-pick.
 */
export function bucketCommits(ts: Uint32Array, buckets: number): Uint32Array {
  const counts = new Uint32Array(buckets);
  if (ts.length === 0 || buckets <= 0) return counts;

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

/** Рисует плотность коммитов подложкой под слайдером. */
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
  ctx.fillStyle = '#2f3a4d';
  for (let i = 0; i < counts.length; i++) {
    // Минимум в один пиксель: полностью пустой промежуток должен отличаться
    // от промежутка с единственным коммитом.
    const barHeight = counts[i]! === 0 ? 0 : Math.max(1, (counts[i]! / peak) * height);
    ctx.fillRect(i * step, height - barHeight, Math.max(1, step - 1), barHeight);
  }
}
