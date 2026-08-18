import type { Pack } from '../../src/model/types.js';
import { matchesGlob } from './glob.js';
import { HIDDEN } from './visibility.js';

/**
 * Маска совпадений по образцу. Матчер тот же, что у фильтра пути: два разных
 * правила «что считается совпадением» в одном интерфейсе — гарантированная
 * путаница, когда одна и та же строка в поле фильтра и в поле поиска находит
 * разное.
 *
 * Пустой образец не совпадает ни с чем — в отличие от фильтра, где пустая
 * строка означает «фильтра нет». Здесь наоборот: пустое поле поиска не должно
 * обводить всё дерево.
 */
export function computeHits(pack: Pack, query: string): Uint8Array {
  const hits = new Uint8Array(pack.meta.pathCount);
  const trimmed = query.trim();
  if (trimmed.length === 0) return hits;
  for (let path = 0; path < pack.meta.pathCount; path++) {
    // Наверх по дереву попадание не поднимается: обводка — точная метка
    // найденного, а не подсветка ветки. Ветку показывает яркость фильтра.
    if (matchesGlob(pack.paths[path]!, trimmed)) hits[path] = 1;
  }
  return hits;
}

/**
 * Переносит попадания на то, что действительно нарисовано: файл внутри
 * свёрнутой папки обводит папку, попадание в скрытом поддереве исчезает.
 * То же правило, по которому в срезе 5a разрешались лучи авторов.
 *
 * Живость проверяется дважды и по разным причинам. `drawn[target]` знает
 * только о живости представителя — для пути, представляющего сам себя, это
 * уже и есть его собственная живость (resolveVisibility ставит `drawn[path]`
 * только когда `alive[path] === 1`). Но у пути под свёрнутой папкой
 * представитель — сама папка, и её живость ничего не говорит о живости
 * конкретного файла внутри: файл мог ещё не родиться или уже исчезнуть на
 * текущем курсоре, а свёрнутая папка остаётся живой, пока жив хоть один её
 * потомок. Без отдельной проверки `alive[path]` образец нашёл бы файл,
 * которого на сцене в этот момент истории попросту нет, — счётчик обязан
 * говорить правду независимо от того, свёрнута ли папка.
 */
export function projectHits(
  hits: Uint8Array,
  representative: Int32Array,
  drawn: Uint8Array,
  alive: Uint8Array,
): { drawnHits: Uint8Array; first: number; count: number } {
  const drawnHits = new Uint8Array(hits.length);
  let first = -1;
  let count = 0;
  for (let path = 0; path < hits.length; path++) {
    if (hits[path] !== 1) continue;
    if (alive[path] !== 1) continue;
    const target = representative[path]!;
    if (target === HIDDEN || drawn[target] !== 1) continue;
    if (drawnHits[target] === 1) continue;
    drawnHits[target] = 1;
    count++;
    // Первое совпадение — наименьший идентификатор, а не первое встреченное:
    // камера обязана ехать в одно и то же место при одном и том же образце.
    if (first === -1 || target < first) first = target;
  }
  return { drawnHits, first, count };
}
