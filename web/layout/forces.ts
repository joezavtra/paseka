import {
  accumulateCentroids,
  containmentDeltas,
  propagateDown,
  repelSiblings,
  siblingPairs,
  type SiblingPairs,
} from './groups.js';

/**
 * Переходник между групповой математикой и симуляцией d3.
 *
 * Сила в d3 — это функция от alpha с необязательным `initialize`, и больше
 * ничего: сам `d3-force` здесь не нужен и намеренно не импортируется. Так вся
 * новая физика остаётся проверяемой без Worker, без `self` и без d3 — тем же
 * приёмом, которым в проекте вынесены бухгалтерия узлов и математика сил.
 */

/**
 * Узел симуляции: d3 мутирует скорость прямо в объекте.
 *
 * `vx` и `vy` необязательны намеренно: их заводит сам d3 при инициализации
 * состава, а хранилище узлов (`node-store.ts`) о них не знает и знать не
 * должно — оно живёт без d3. К моменту первого тика поля уже есть.
 */
export interface MutableNode {
  id: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

/** Сила в терминах d3: вызывается каждый тик, переинициализируется при смене состава. */
export interface GroupForce {
  (alpha: number): void;
  initialize(nodes: MutableNode[], random?: () => number): void;
}

/** Всё, что групповым силам нужно знать о дереве и настройках. */
export interface FolderState {
  active: Uint8Array;
  parent: Uint32Array;
  /** Радиус следа поддерева по идентификатору пути (см. subtree.ts). */
  footprint: Float32Array;
  /** Число листьев поддерева: порог участия в расталкивании. */
  leaves: Uint32Array;
  /** Площадь кружка узла: масса при взвешивании центра масс. */
  area: Float64Array;
  /** Сила возврата узла в границы своей папки. */
  cohesion: number;
  /** Сила расталкивания папок. */
  repel: number;
  /** Зазор между следами соседних папок. */
  gap: number;
}

/** Рабочие массивы на состав узлов: выделяются в initialize, а не каждый тик. */
interface Scratch {
  x: Float64Array;
  y: Float64Array;
  mass: Float64Array;
  centroidX: Float64Array;
  centroidY: Float64Array;
  centroidMass: Float64Array;
  pushX: Float64Array;
  pushY: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  pairs: SiblingPairs;
  nodes: MutableNode[];
}

function allocate(state: FolderState, nodes: MutableNode[]): Scratch {
  const pathCount = state.active.length;
  return {
    x: new Float64Array(pathCount),
    y: new Float64Array(pathCount),
    mass: new Float64Array(pathCount),
    centroidX: new Float64Array(pathCount),
    centroidY: new Float64Array(pathCount),
    centroidMass: new Float64Array(pathCount),
    pushX: new Float64Array(pathCount),
    pushY: new Float64Array(pathCount),
    vx: new Float64Array(pathCount),
    vy: new Float64Array(pathCount),
    pairs: siblingPairs(state.active, state.parent, state.leaves),
    nodes,
  };
}

/** Снимает координаты живых узлов в массивы по идентификатору пути. */
function readPositions(state: FolderState, scratch: Scratch): void {
  scratch.x.fill(0);
  scratch.y.fill(0);
  scratch.mass.fill(0);
  for (const node of scratch.nodes) {
    if (state.active[node.id] !== 1) continue;
    scratch.x[node.id] = node.x;
    scratch.y[node.id] = node.y;
    scratch.mass[node.id] = state.area[node.id] ?? 0;
  }
}

/** Центр масс поддерева, готовый к использованию: сумма, делённая на массу. */
function centroids(state: FolderState, scratch: Scratch): void {
  accumulateCentroids(
    state.active,
    state.parent,
    scratch.x,
    scratch.y,
    scratch.mass,
    scratch.centroidX,
    scratch.centroidY,
    scratch.centroidMass,
  );
  for (let path = 0; path < state.active.length; path++) {
    const mass = scratch.centroidMass[path]!;
    if (mass <= 0) continue;
    scratch.centroidX[path] = scratch.centroidX[path]! / mass;
    scratch.centroidY[path] = scratch.centroidY[path]! / mass;
  }
}

/**
 * Мягкая граница папки: узел, ушедший за след своего родителя, возвращается.
 *
 * Внутри следа сила ровно нулевая, поэтому она не спорит ни с пружинами, ни с
 * разведением кружков — те работают в неизменном режиме.
 */
export function forceFolderCohesion(state: FolderState): GroupForce {
  let scratch: Scratch | null = null;

  const force = ((alpha: number): void => {
    if (!scratch || state.cohesion <= 0) return;
    readPositions(state, scratch);
    centroids(state, scratch);
    scratch.vx.fill(0);
    scratch.vy.fill(0);
    containmentDeltas(
      state.active,
      state.parent,
      scratch.x,
      scratch.y,
      state.footprint,
      scratch.centroidX,
      scratch.centroidY,
      state.cohesion,
      alpha,
      scratch.vx,
      scratch.vy,
    );
    for (const node of scratch.nodes) {
      node.vx = (node.vx ?? 0) + scratch.vx[node.id]!;
      node.vy = (node.vy ?? 0) + scratch.vy[node.id]!;
    }
  }) as GroupForce;

  force.initialize = (nodes: MutableNode[]): void => {
    scratch = allocate(state, nodes);
  };
  return force;
}

/**
 * Расталкивание папок-сиблингов: следы, налезшие друг на друга, расходятся
 * целыми группами, и смещение достаётся каждому члену.
 */
export function forceGroupRepel(state: FolderState): GroupForce {
  let scratch: Scratch | null = null;

  const force = ((alpha: number): void => {
    if (!scratch || state.repel <= 0 || scratch.pairs.a.length === 0) return;
    readPositions(state, scratch);
    centroids(state, scratch);
    scratch.pushX.fill(0);
    scratch.pushY.fill(0);
    repelSiblings(
      scratch.pairs,
      scratch.centroidX,
      scratch.centroidY,
      state.footprint,
      scratch.centroidMass,
      state.gap,
      state.repel,
      alpha,
      scratch.pushX,
      scratch.pushY,
    );
    propagateDown(state.active, state.parent, scratch.pushX, scratch.pushY);
    for (const node of scratch.nodes) {
      node.vx = (node.vx ?? 0) + scratch.pushX[node.id]!;
      node.vy = (node.vy ?? 0) + scratch.pushY[node.id]!;
    }
  }) as GroupForce;

  force.initialize = (nodes: MutableNode[]): void => {
    scratch = allocate(state, nodes);
  };
  return force;
}
