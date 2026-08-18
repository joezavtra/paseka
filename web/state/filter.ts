import type { Pack } from '../../src/model/types.js';
import { matchesGlob } from './glob.js';

/** Яркость того, что не попало под фильтр. Не ноль: дерево должно остаться целым. */
export const DIM_ALPHA = 0.12;

export interface FilterSpec {
  /** null — фильтра по авторам нет. Пустое множество — не подходит никто. */
  authors: ReadonlySet<number> | null;
  pathQuery: string;
  extensions: ReadonlySet<string> | null;
}

export const EMPTY_FILTER: FilterSpec = { authors: null, pathQuery: '', extensions: null };

export function isEmptyFilter(spec: FilterSpec): boolean {
  return spec.authors === null && spec.extensions === null && spec.pathQuery.trim().length === 0;
}

/** Расширение файла в нижнем регистре; у файла без расширения — пустая строка. */
export function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Целевая яркость каждого пути. Фильтр именно гасит, а не скрывает: увидев,
 * что нашлось, пользователь должен понимать, где это лежит в дереве. Поэтому
 * каталог берёт максимум по потомкам — иначе найденный файл висел бы на
 * погасшей ветке и выглядел бы оторванным от дерева.
 */
export function computeAlpha(pack: Pack, spec: FilterSpec): Float32Array {
  const { pathCount } = pack.meta;
  const alpha = new Float32Array(pathCount).fill(DIM_ALPHA);
  if (isEmptyFilter(spec)) return alpha.fill(1);

  const query = spec.pathQuery.trim();

  for (let path = 0; path < pathCount; path++) {
    if (pack.pathIsDir[path] === 1) continue; // каталоги получают яркость от потомков
    if (query.length > 0 && !matchesGlob(pack.paths[path]!, query)) continue;
    if (spec.extensions !== null && !spec.extensions.has(extensionOf(pack.paths[path]!))) continue;
    if (spec.authors !== null && !touchedByAny(pack, path, spec.authors)) continue;
    alpha[path] = 1;
  }

  // Идентификатор родителя всегда меньше идентификатора потомка, поэтому обход
  // по убыванию поднимает максимум от листьев к корню за один проход.
  for (let path = pathCount - 1; path >= 1; path--) {
    const parent = pack.pathParent[path];
    if (alpha[path] > alpha[parent]) alpha[parent] = alpha[path];
  }
  return alpha;
}

function touchedByAny(pack: Pack, path: number, authors: ReadonlySet<number>): boolean {
  for (let k = pack.pathEventStart[path]; k < pack.pathEventStart[path + 1]; k++) {
    const event = pack.pathEventIdx[k];
    if (authors.has(pack.commitAuthor[pack.eventCommit[event]])) return true;
  }
  return false;
}
