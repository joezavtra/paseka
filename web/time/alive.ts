import { ALIVE } from '../../src/model/history.js';
import type { Pack } from '../../src/model/types.js';

/**
 * Какие пути существуют на момент коммита `commitIndex` включительно.
 * Собственная жизнь пути определяется его интервалами жизни, а не флагом
 * `pathIsDir`: флаг означает «путь когда-либо был родителем» и живёт до конца
 * истории, поэтому файл без расширения, ставший позже каталогом (`docs`, а
 * затем `docs/guide.md`), по флагу исчез бы из живого множества навсегда.
 * Флаг остаётся исключительно для рендера.
 *
 * Директория живёт, пока жив хотя бы один её потомок, поэтому от каждого
 * живого пути поднимаемся к корню с ранним выходом на уже помеченном узле.
 * У пути с собственными интервалами и потомками работают оба правила: он жив,
 * если жив сам или жив хоть один потомок.
 */
export function aliveAt(pack: Pack, commitIndex: number): Uint8Array {
  const { pathCount } = pack.meta;
  const alive = new Uint8Array(pathCount);

  for (let path = 0; path < pathCount; path++) {
    const from = pack.lifetimeStart[path];
    const to = pack.lifetimeStart[path + 1];
    for (let k = from; k < to; k++) {
      const birth = pack.lifetimeBirth[k];
      if (birth > commitIndex) break; // интервалы идут по возрастанию
      const death = pack.lifetimeDeath[k];
      if (death === ALIVE || death > commitIndex) {
        alive[path] = 1;
        break;
      }
    }
    if (alive[path] === 0) continue;

    for (let node = pack.pathParent[path]; alive[node] === 0; node = pack.pathParent[node]) {
      alive[node] = 1;
      if (node === 0) break;
    }
  }

  return alive;
}

/** Размер каждого файла в строках на момент коммита; директории получают 0. */
export function sizesAt(pack: Pack, commitIndex: number): Int32Array {
  const sizes = new Int32Array(pack.meta.pathCount);

  for (let path = 0; path < pack.meta.pathCount; path++) {
    const from = pack.pathEventStart[path];
    const to = pack.pathEventStart[path + 1];
    if (from === to) continue;

    // Последнее событие пути, попавшее в [0, commitIndex] — двоичным поиском.
    let lo = from;
    let hi = to - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pack.eventCommit[pack.pathEventIdx[mid]] <= commitIndex) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found !== -1) sizes[path] = pack.pathEventLines[found];
  }
  return sizes;
}
