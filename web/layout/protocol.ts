/** Главный поток → воркер: полный набор узлов и рёбер для симуляции. */
export interface LayoutInit {
  type: 'init';
  nodeCount: number;
  linkSource: Uint32Array;
  linkTarget: Uint32Array;
  radius: Float32Array;
  /** Фиксированный seed: два запуска на одном репозитории дают похожую картинку. */
  seed: number;
}

/** Воркер → главный поток: пары x, y длиной nodeCount * 2. */
export interface LayoutPositions {
  type: 'positions';
  positions: Float32Array;
  /** Текущая «температура» симуляции; ниже 0.02 картинка практически замерла. */
  alpha: number;
}

export type ToWorker = LayoutInit;
export type FromWorker = LayoutPositions;
