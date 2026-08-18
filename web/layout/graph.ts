export interface ActiveLinks {
  /** Идентификаторы путей-родителей. */
  source: Uint32Array;
  /** Идентификаторы путей-потомков. */
  target: Uint32Array;
}

const DIR_RADIUS = 3;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 40;

/**
 * Радиус узла растёт как корень из числа строк — так разница между большим и
 * маленьким файлом заметна, но не рвёт масштаб. У обычной директории размер
 * всегда 0 (см. `visibility.sizes`), поэтому её радиус остаётся `DIR_RADIUS`;
 * у свёрнутой директории размер — сумма живых потомков, и тем же законом, но
 * от директорийной базы, она обязана расти вместе с ним: иначе сворачивание
 * рисовало бы любую папку точкой в три пикселя независимо от того, сколько в
 * ней спрятано кода.
 */
export function radiusFor(lines: number, isDir: boolean): number {
  const base = isDir ? DIR_RADIUS : MIN_RADIUS;
  return Math.min(MAX_RADIUS, base + Math.sqrt(Math.max(0, lines)) * 0.6);
}

/**
 * Рёбра дерева между узлами присланной маски, в идентификаторах путей. Маска
 * обычно рисуемая, а не живая: main.ts кормит сюда `scene.active`, где живой,
 * но скрытый или свёрнутый путь уже вычеркнут.
 * Плотной перенумерации больше нет: она ломала бы позиции при каждом
 * изменении состава маски, а состав меняется на каждом коммите.
 */
export function buildActiveLinks(active: Uint8Array, parent: Uint32Array): ActiveLinks {
  const source: number[] = [];
  const target: number[] = [];
  for (let path = 0; path < active.length; path++) {
    if (active[path] === 0) continue;
    const parentId = parent[path];
    if (parentId === path) continue; // корень
    if (active[parentId] === 0) continue;
    source.push(parentId);
    target.push(path);
  }
  return { source: Uint32Array.from(source), target: Uint32Array.from(target) };
}

/**
 * Пути, ставшие рисуемыми со времени прошлого применения. Разница движка
 * времени отвечает на вопрос «что родилось в истории», а этот список — на
 * другой: «что появилось на сцене». С видимостью это уже не одно и то же —
 * развёрнутая папка выпускает наружу узлы, которые в истории не менялись.
 *
 * Чистая функция: ни `prevDrawn`, ни `drawn` не мутирует, поэтому вызывающий
 * сам решает, когда переносить `drawn` в `prevDrawn` для следующего вызова.
 */
export function diffBorn(prevDrawn: Uint8Array, drawn: Uint8Array): Uint32Array {
  const born: number[] = [];
  for (let path = 0; path < drawn.length; path++) {
    if (drawn[path] === 1 && prevDrawn[path] === 0) born.push(path);
  }
  return Uint32Array.from(born);
}
