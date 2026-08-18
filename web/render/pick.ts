/** Под точкой нет ни одного узла. */
export const NOTHING = -1;

/** Всё, что нужно знать о сцене, чтобы понять, куда показывает курсор. */
export interface PickInput {
  /** Рисуемая маска; индекс — идентификатор пути. */
  active: Uint8Array;
  /** Пары x, y в мировых координатах. */
  positions: Float32Array;
  radius: Float32Array;
}

/**
 * Узел под точкой мира или NOTHING.
 *
 * Прямое накрытие сильнее близости, а среди накрывающих выигрывает больший
 * идентификатор: отрисовка идёт по возрастанию идентификатора, поэтому узел с
 * большим номером лежит сверху, и целятся именно в него. Иначе клик по файлу
 * внутри крупного каталога открывал бы каталог — то есть попадал бы не туда,
 * куда смотрит пользователь.
 *
 * `slack` — допуск в мировых единицах: на отдалении радиус узла меньше
 * пикселя, и без допуска попасть в него мышью невозможно. Перевод из экранных
 * пикселей делает вызывающий (делением на масштаб камеры): о камере эта
 * функция не знает намеренно, иначе её нельзя было бы проверить без DOM.
 */
export function pickNode(input: PickInput, worldX: number, worldY: number, slack: number): number {
  let covered = NOTHING;
  let near = NOTHING;
  let nearGap = Infinity;

  for (let path = 0; path < input.active.length; path++) {
    if (input.active[path] !== 1) continue;
    const dx = input.positions[path * 2]! - worldX;
    const dy = input.positions[path * 2 + 1]! - worldY;
    const distance = Math.hypot(dx, dy);
    const radius = input.radius[path]!;
    if (distance <= radius) {
      // Просто перезаписываем: обход идёт по возрастанию, значит последний
      // накрывающий и есть верхний.
      covered = path;
      continue;
    }
    const gap = distance - radius;
    if (gap <= slack && gap <= nearGap) {
      near = path;
      nearGap = gap;
    }
  }

  return covered !== NOTHING ? covered : near;
}
