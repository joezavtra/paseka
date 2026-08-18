import type { Pack } from '../../src/model/types.js';

/**
 * Отображаемое имя пути без каталогов; у корня (пустой путь) — имя
 * репозитория. Общий помощник для карточки узла, подписи на сцене
 * (web/main.ts) и панели дерева (web/ui/sidebar.ts): пользователь видит имя
 * одного и того же узла сразу в нескольких местах интерфейса, и они обязаны
 * называть его одинаково — второе независимое вычисление здесь было бы шансом
 * разойтись с первым при следующей правке любого из мест.
 */
export function basenameOf(pack: Pack, path: number): string {
  const fullPath = pack.paths[path] ?? '';
  if (fullPath === '') return pack.meta.repoName;
  return fullPath.slice(fullPath.lastIndexOf('/') + 1);
}

export interface Contributor {
  author: number;
  /** Сколько коммитов этого автора задели узел или его поддерево. */
  commits: number;
}

export interface NodeInfo {
  path: number;
  fullPath: string;
  /** Имя без пути; у корня — имя репозитория. */
  name: string;
  isDir: boolean;
  alive: boolean;
  /** Строк сейчас: у каталога — сумма по живому поддереву. */
  lines: number;
  /** Живых файлов: у файла 1 или 0, у каталога — сколько внутри. */
  files: number;
  /**
   * Сколько файлов из этого поддерева представлено на сцене одним этим
   * кружком прямо сейчас — только когда узел является свёрнутой папкой,
   * иначе `undefined` (вопрос неприменим). Значение приходит снаружи через
   * `NodeInfoOptions.represented` и просто переносится в вывод: у карточки
   * нет доступа к спецификации видимости, чтобы посчитать его самой, а
   * дублировать это правило было бы риском разойтись со сценой — тем самым
   * узлом, который пользователь и сравнивает глазами с этой карточкой.
   * Может быть меньше `files`, если внутри свёрнутой папки есть скрытое
   * поддерево: тогда карточка обязана назвать разницу явно, а не молча
   * показать число, которое не совпадает с подписью на сцене.
   */
  represented?: number;
  /** Индекс коммита, в котором путь впервые появился; -1, если ещё не появился. */
  birthCommit: number;
  /** Последний коммит не позже курсора, задевший узел; -1, если таких нет. */
  lastCommit: number;
  /** Сколько всего коммитов задели узел до курсора включительно. */
  commits: number;
  contributors: Contributor[];
  /** Индексы последних коммитов, свежие первыми. */
  recentCommits: number[];
  /** Объём изменений по корзинам оси индексов коммитов — той же, что у слайдера. */
  sparkline: Uint32Array;
}

export interface NodeInfoOptions {
  /** Сколько авторов оставить в топе. */
  contributors?: number;
  /**
   * Сколько последних коммитов перечислить. Не путать с полем `commits` в
   * NodeInfo: там их общее число, здесь — длина списка.
   */
  recent?: number;
  /** На сколько корзин делить ось истории. */
  buckets?: number;
  /**
   * Сколько файлов узел представляет на сцене прямо сейчас — тот же `files`
   * из `resolveVisibility` (web/state/visibility.ts), что уже использован для
   * подписи узла. Передаётся, а не пересчитывается: у `describeNode` нет (и
   * не должно быть) доступа к спецификации видимости, только к живости и
   * размерам. `undefined`, если вопрос неприменим (узел — не свёрнутая папка).
   */
  represented?: number;
}

/**
 * Всё, что карточка узла показывает про путь на текущем курсоре.
 *
 * Одна область видимости на всю карточку: и размер, и авторы, и коммиты, и
 * спарклайн считаются по событиям не позже курсора. Пользователь читает
 * карточку как срез момента, и столбик активности из будущего означал бы, что
 * и число строк оттуда же.
 *
 * У каталога своих событий не бывает — они пишутся на файлы, — поэтому
 * каталог описывается суммой поддерева. Принадлежность поддереву считается
 * одним восходящим проходом: идентификатор родителя всегда меньше
 * идентификатора потомка.
 *
 * Стоимость — O(числа путей + числа событий поддерева) на вызов. Это цена
 * клика и наведения, а не кадра: результат не пересобирается, пока
 * пользователь не выбрал другой узел или не сдвинул курсор.
 */
export function describeNode(
  pack: Pack,
  path: number,
  cursor: number,
  alive: Uint8Array,
  sizes: Int32Array,
  options: NodeInfoOptions = {},
): NodeInfo {
  const topContributors = options.contributors ?? 5;
  const recentLimit = options.recent ?? 5;
  const buckets = Math.max(1, options.buckets ?? 32);
  const { pathCount, commitCount } = pack.meta;

  const isDir = pack.pathIsDir[path] === 1;
  const fullPath = pack.paths[path] ?? '';
  const name = basenameOf(pack, path);

  // Члены поддерева: сам путь и всё, что ниже. Один проход по возрастанию.
  const member = new Uint8Array(pathCount);
  member[path] = 1;
  for (let p = path + 1; p < pathCount; p++) {
    if (member[pack.pathParent[p]!] === 1) member[p] = 1;
  }

  let lines = 0;
  let files = 0;
  let birthCommit = -1;
  let lastCommit = -1;
  const sparkline = new Uint32Array(buckets);
  /** Коммиты, задевшие поддерево: множество, потому что один коммит трогает много файлов. */
  const touchedCommits = new Set<number>();

  for (let p = path; p < pathCount; p++) {
    if (member[p] !== 1) continue;
    if (pack.pathIsDir[p] === 1) continue; // события и размеры есть только у файлов
    if (alive[p] === 1) {
      lines += sizes[p]!;
      files++;
    }
    for (let k = pack.pathEventStart[p]!; k < pack.pathEventStart[p + 1]!; k++) {
      const event = pack.pathEventIdx[k]!;
      const commit = pack.eventCommit[event]!;
      // События пути лежат по возрастанию коммита, поэтому дальше смотреть
      // незачем: всё остальное — будущее относительно курсора.
      if (commit > cursor) break;
      touchedCommits.add(commit);
      if (birthCommit === -1 || commit < birthCommit) birthCommit = commit;
      if (commit > lastCommit) lastCommit = commit;
      const bucket = Math.min(buckets - 1, Math.floor((commit / Math.max(1, commitCount)) * buckets));
      sparkline[bucket]!++;
    }
  }

  const perAuthor = new Map<number, number>();
  for (const commit of touchedCommits) {
    const author = pack.commitAuthor[commit]!;
    perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
  }
  const contributors = [...perAuthor.entries()]
    .map(([author, commits]) => ({ author, commits }))
    .sort((a, b) => b.commits - a.commits || a.author - b.author)
    .slice(0, Math.max(0, topContributors));

  const recentCommits = [...touchedCommits].sort((a, b) => b - a).slice(0, Math.max(0, recentLimit));

  return {
    path,
    fullPath,
    name,
    isDir,
    alive: alive[path] === 1,
    lines,
    files,
    represented: options.represented,
    birthCommit,
    lastCommit,
    commits: touchedCommits.size,
    contributors,
    recentCommits,
    sparkline,
  };
}
