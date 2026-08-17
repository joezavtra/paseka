/** Главный поток → воркер: однократная настройка размера мира. */
export interface LayoutInit {
  type: 'init';
  /** Длина всех массивов по узлам; индекс — идентификатор пути. */
  pathCount: number;
  /** Фиксированный seed: два запуска на одном репозитории дают похожую картинку. */
  seed: number;
}

/**
 * Главный поток → воркер: изменение состава и геометрии.
 * Передаётся именно разница, а не полный набор: только так у узла сохраняется
 * позиция между кадрами, а вернувшийся файл всплывает там же, где исчез.
 */
export interface LayoutUpdate {
  type: 'update';
  /** Идентификаторы путей, вошедших в симуляцию. */
  added: Uint32Array;
  /** Идентификаторы путей, покинувших симуляцию. */
  removed: Uint32Array;
  /** Пути, у которых изменился радиус, и сами радиусы — параллельные массивы. */
  radiusIds: Uint32Array;
  radiusValues: Float32Array;
  /** Активные рёбра в идентификаторах путей. */
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
  /** Родитель каждого добавленного узла: новый узел появляется рядом с папкой. */
  parentOf: Uint32Array;
}

/** Воркер → главный поток: пары x, y длиной pathCount * 2, индекс — путь. */
export interface LayoutPositions {
  type: 'positions';
  positions: Float32Array;
  /** «Температура» симуляции; ниже 0.02 картинка практически замерла. */
  alpha: number;
}

export type ToWorker = LayoutInit | LayoutUpdate;
export type FromWorker = LayoutPositions;
