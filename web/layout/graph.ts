export interface LayoutGraph {
  /** Идентификаторы путей, попавших в симуляцию. */
  nodeIds: Uint32Array;
  /** Рёбра в локальных индексах внутри nodeIds. */
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
}

const DIR_RADIUS = 3;
const MIN_RADIUS = 2.5;
const MAX_RADIUS = 40;

export function radiusFor(lines: number, isDir: boolean): number {
  if (isDir) return DIR_RADIUS;
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(Math.max(0, lines)) * 0.6);
}

/**
 * Сжимает живое подмножество путей в плотный граф для d3-force.
 * Локальные индексы нужны потому, что симуляция работает с массивом узлов,
 * а идентификаторы путей разрежены: половина дерева в любой момент мертва.
 */
export function buildLayoutGraph(alive: Uint8Array, parent: Uint32Array): LayoutGraph {
  const local = new Int32Array(alive.length).fill(-1);
  const nodeIds: number[] = [];
  for (let path = 0; path < alive.length; path++) {
    if (alive[path] === 1) {
      local[path] = nodeIds.length;
      nodeIds.push(path);
    }
  }

  const linkSource: number[] = [];
  const linkTarget: number[] = [];
  for (const path of nodeIds) {
    const parentId = parent[path];
    if (parentId === path) continue; // корень
    if (local[parentId] === -1) continue;
    linkSource.push(local[parentId]);
    linkTarget.push(local[path]);
  }

  return {
    nodeIds: Uint32Array.from(nodeIds),
    linkSource: Uint32Array.from(linkSource),
    linkTarget: Uint32Array.from(linkTarget),
  };
}
