export interface ActiveLinks {
  /** Идентификаторы путей-родителей. */
  source: Uint32Array;
  /** Идентификаторы путей-потомков. */
  target: Uint32Array;
}

const DIR_RADIUS = 3;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 40;

export function radiusFor(lines: number, isDir: boolean): number {
  if (isDir) return DIR_RADIUS;
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(Math.max(0, lines)) * 0.6);
}

/**
 * Рёбра дерева между живыми узлами, в идентификаторах путей.
 * Плотной перенумерации больше нет: она ломала бы позиции при каждом
 * изменении состава живых узлов, а состав меняется на каждом коммите.
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
