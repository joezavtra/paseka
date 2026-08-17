import type { Pack } from '../../src/model/types.js';

/** Путь не показывается вовсе: он сам или его предок скрыт. */
export const HIDDEN = -1;

export interface VisibilitySpec {
  /** Папки, убранные со сцены вместе с поддеревом. */
  hidden: ReadonlySet<number>;
  /** Папки, схлопнутые в один узел. */
  collapsed: ReadonlySet<number>;
}

export interface VisibilityResult {
  /** Кто представляет путь на экране: он сам, свёрнутый предок, либо HIDDEN. */
  representative: Int32Array;
  /** Рисуемые узлы: путь жив и представляет сам себя. */
  drawn: Uint8Array;
  /** Размер узла в строках; у свёрнутой папки — сумма живых потомков. */
  sizes: Int32Array;
}

/**
 * Скрытие и сворачивание — разные операции. Скрытая папка исчезает вместе с
 * поддеревом, и граф занимает освободившееся место. Свёрнутая остаётся на
 * экране и становится представителем всего, что внутри: в неё же бьют лучи
 * авторов, работавших внутри, иначе луч уходил бы в невидимый узел.
 *
 * Один проход по возрастанию идентификатора: родитель всегда меньше потомка,
 * поэтому к моменту обработки пути его предок уже разрешён.
 */
export function resolveVisibility(
  pack: Pack,
  alive: Uint8Array,
  sizes: Int32Array,
  spec: VisibilitySpec,
): VisibilityResult {
  const { pathCount } = pack.meta;
  const representative = new Int32Array(pathCount);
  const drawn = new Uint8Array(pathCount);
  const result = new Int32Array(pathCount);

  if (pathCount > 0) {
    representative[0] = spec.hidden.has(0) ? HIDDEN : 0;
  }
  for (let path = 1; path < pathCount; path++) {
    // Скрытие проверяем для самого пути раньше, чем смотрим на родителя:
    // иначе скрытая папка внутри свёрнутой молча унаследует представителя
    // родителя вместо того, чтобы пропасть — скрытие сильнее сворачивания.
    if (spec.hidden.has(path)) {
      representative[path] = HIDDEN;
      continue;
    }
    const parent = pack.pathParent[path];
    const parentRep = representative[parent];
    if (parentRep === HIDDEN) {
      representative[path] = HIDDEN;
    } else if (parentRep !== parent) {
      // Родитель сам представлен свёрнутым предком — потомок наследует его.
      representative[path] = parentRep;
    } else if (spec.collapsed.has(parent)) {
      representative[path] = parent;
    } else {
      representative[path] = path;
    }
  }

  for (let path = 0; path < pathCount; path++) {
    if (alive[path] === 1 && representative[path] === path) drawn[path] = 1;
  }

  // Размер свёрнутой папки — сумма живых потомков: узел должен выглядеть на
  // столько, сколько кода в нём спрятано.
  for (let path = 0; path < pathCount; path++) {
    if (alive[path] !== 1) continue;
    const rep = representative[path];
    if (rep === HIDDEN) continue;
    result[rep] += sizes[path];
  }

  return { representative, drawn, sizes: result };
}
