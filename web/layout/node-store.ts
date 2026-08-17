import { makeRng } from '../../src/util/rng.js';

export interface StoreNode {
  /** Идентификатор пути; сохраняется на всё время сессии. */
  id: number;
  x: number;
  y: number;
  radius: number;
}

/** Разница, применяемая к хранилищу узлов. */
export interface StoreUpdate {
  /** Маска живых путей; индекс — идентификатор пути. Авторитетный источник. */
  active: Uint8Array;
  /** Пути-кандидаты на рождение; фактически рождаются только живые из них. */
  added: Uint32Array;
  /** Пути, у которых изменился радиус, и сами радиусы — параллельные массивы. */
  radiusIds: Uint32Array;
  radiusValues: Float32Array;
}

export interface StoreState {
  /** Живые узлы в порядке возрастания идентификатора пути. */
  nodes: StoreNode[];
  /** Пары x, y длиной pathCount * 2, индекс пары — идентификатор пути. */
  positions: Float32Array;
}

const DEFAULT_RADIUS = 3;

/**
 * Бухгалтерия узлов раскладки: кто жив, где стоит, какой у него радиус.
 * Не зависит ни от d3-force, ни от глобального `self` — воркер использует её
 * только для учёта, а сама симуляция сил остаётся снаружи. Это разделение и
 * даёт возможность протестировать самую хрупкую часть (память позиций,
 * рождение у родителя) без эмуляции Worker и без запуска настоящей физики.
 */
export class NodeStore {
  /**
   * Все узлы, которые когда-либо появлялись, включая ушедшие. Позиция
   * ушедшего узла остаётся здесь: если файл вернётся, он всплывёт там же,
   * где исчез.
   */
  private readonly known = new Map<number, StoreNode>();
  private active: Uint8Array;
  private readonly parent: Uint32Array;
  private readonly rng: () => number;

  constructor(pathCount: number, parent: Uint32Array, seed: number) {
    this.active = new Uint8Array(pathCount);
    this.parent = parent;
    this.rng = makeRng(seed);
  }

  /**
   * Рождает узел рядом с родителем, если тот жив, иначе — на кольце вокруг
   * центра. Родитель ищется рекурсивно и рождается первым, если сам ещё не
   * существует: так порядок путей во входном списке `added` не имеет
   * значения — цепочка новых каталогов всегда собирается от корня к листу,
   * а не наоборот, как её отдаёт движок времени.
   */
  private spawn(id: number): StoreNode {
    const existing = this.known.get(id);
    if (existing) return existing;

    const parentId = this.parent[id]!;
    const parentNode =
      parentId !== id && this.active[parentId] === 1 ? this.spawn(parentId) : undefined;

    const angle = this.rng() * Math.PI * 2;
    let node: StoreNode;
    if (parentNode) {
      const jitter = 8 + this.rng() * 12;
      node = {
        id,
        x: parentNode.x + Math.cos(angle) * jitter,
        y: parentNode.y + Math.sin(angle) * jitter,
        radius: DEFAULT_RADIUS,
      };
    } else {
      const distance = Math.sqrt(this.rng()) * 400;
      node = { id, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, radius: DEFAULT_RADIUS };
    }
    this.known.set(id, node);
    return node;
  }

  /** Живая маска, как её сохранило хранилище после последнего applyUpdate. */
  get aliveMask(): Uint8Array {
    return this.active;
  }

  /** Пары x, y длиной pathCount * 2 по текущему состоянию узлов. */
  positions(): Float32Array {
    const positions = new Float32Array(this.active.length * 2);
    for (let path = 0; path < this.active.length; path++) {
      if (this.active[path] === 0) continue;
      const node = this.known.get(path);
      if (!node) continue;
      positions[path * 2] = node.x;
      positions[path * 2 + 1] = node.y;
    }
    return positions;
  }

  /**
   * Применяет разницу: заменяет маску живости на присланную, рождает новые
   * узлы (и недостающих живых предков — рекурсивно), обновляет радиусы.
   * Возвращает живые узлы (те же объекты, что уйдут в d3-force и будут им
   * мутироваться) и снимок позиций для первого кадра после обновления.
   */
  applyUpdate(update: StoreUpdate): StoreState {
    this.active = update.active;

    for (const id of update.added) {
      if (this.active[id] === 1) this.spawn(id);
    }

    for (let i = 0; i < update.radiusIds.length; i++) {
      const node = this.known.get(update.radiusIds[i]!);
      if (node) node.radius = update.radiusValues[i]!;
    }

    const nodes: StoreNode[] = [];
    for (let path = 0; path < this.active.length; path++) {
      if (this.active[path] === 0) continue;
      const node = this.known.get(path);
      if (node) nodes.push(node);
    }

    return { nodes, positions: this.positions() };
  }
}
