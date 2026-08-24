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
  /**
   * Вес узла, из которого считается его радиус: число коммитов, задевших путь
   * (см. TimeEngine.commits). У свёрнутой папки — сумма по живым потомкам,
   * поэтому она рисуется на столько, сколько работы в ней спрятано. У обычной
   * папки ноль: её потомки представляют сами себя.
   */
  weight: Int32Array;
  /** Сколько живых файлов представляет узел: у свёрнутой папки — всё, что внутри. */
  files: Int32Array;
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
  weight: Int32Array,
  spec: VisibilitySpec,
): VisibilityResult {
  const { pathCount } = pack.meta;
  const representative = new Int32Array(pathCount);
  const drawn = new Uint8Array(pathCount);
  const result = new Int32Array(pathCount);
  const files = new Int32Array(pathCount);

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

  // Вес свёрнутой папки — сумма живых потомков: узел должен выглядеть на
  // столько, сколько работы в нём спрятано. Число файлов копится тем же
  // проходом: подписи свёрнутой папки (§9) нужен именно счётчик файлов, а не
  // строк, и заводить для него отдельный обход по тем же путям было бы
  // двойной работой.
  for (let path = 0; path < pathCount; path++) {
    if (alive[path] !== 1) continue;
    const rep = representative[path];
    if (rep === HIDDEN) continue;
    result[rep] += weight[path];
    // Каталоги в счётчик не входят: пользователю нужно число файлов, а не
    // число узлов поддерева.
    if (pack.pathIsDir[path] !== 1) files[rep] += 1;
  }

  return { representative, drawn, weight: result, files };
}

/**
 * Как видимость лежит в хранилище между сессиями. Хранятся строки путей, а не
 * идентификаторы: номер пути раздаётся в порядке первого появления при обходе
 * истории, а порядок задаёт чтение журнала по дате коммита. Влилась ветка,
 * которую вели две недели, — её коммиты встают в середину истории и сдвигают
 * все последующие номера. Сохранённый вчера номер назавтра означал бы другую
 * папку, и она молча исчезла бы со сцены, а галочка стояла бы рядом с прежней:
 * ровно то молчаливое сокрытие данных, которого инструмент не должен допускать.
 *
 * Кодек живёт рядом с разрешением видимости и ничего не знает ни про DOM, ни
 * про localStorage: обращение к хранилищу (оно бросает в приватном режиме)
 * остаётся заботой точки входа, а сюда приходит уже прочитанная строка.
 */
interface StoredVisibility {
  hidden: string[];
  collapsed: string[];
}

/** Пути по идентификаторам; неизвестные номера молча выпадают. */
function pathsOf(pack: Pack, ids: ReadonlySet<number>): string[] {
  const paths: string[] = [];
  for (const id of ids) {
    const path = pack.paths[id];
    if (typeof path === 'string' && path !== '') paths.push(path);
  }
  return paths;
}

/** Идентификаторы по путям; неизвестные пути отбрасываются. */
function idsOf(pack: Pack, value: unknown): Set<number> {
  const ids = new Set<number>();
  if (!Array.isArray(value)) return ids;
  // Индекс строится заново на каждый вызов — decodeVisibility зовёт idsOf
  // дважды (для hidden и для collapsed), так что на разбор пакета выходит два
  // прохода. Это дёшево: путей десятки тысяч, а разбор бывает раз за загрузку
  // страницы.
  const index = new Map<string, number>();
  for (let path = 0; path < pack.meta.pathCount; path++) index.set(pack.paths[path]!, path);
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = index.get(item);
    if (id !== undefined && id !== 0) ids.add(id);
  }
  return ids;
}

export function encodeVisibility(pack: Pack, spec: VisibilitySpec): string {
  const stored: StoredVisibility = {
    hidden: pathsOf(pack, spec.hidden),
    collapsed: pathsOf(pack, spec.collapsed),
  };
  return JSON.stringify(stored);
}

/**
 * Каталоги, скрытые при первом открытии репозитория.
 *
 * Только `vendor` и только по имени каталога: это единственная папка, которая
 * почти всегда есть в дереве, почти никогда не интересна и при этом обычно
 * крупнее всего остального кода вместе взятого — на репозитории с вендорингом
 * первая же картинка без неё превращается в ком чужих зависимостей.
 *
 * Всё остальное из списка типового шума (`node_modules`, `dist`, `build`,
 * `target`) по-прежнему скрывается только по явному нажатию кнопки: инструмент
 * не должен молча прятать данные. И даже `vendor` прячется не молча — он виден
 * в навигаторе дерева со снятой галочкой, то есть сразу понятно, что он скрыт
 * и как его вернуть. Возвращённый однажды, он больше не прячется: любое
 * действие в панели пишет выбор в хранилище, а сохранённый выбор сильнее
 * умолчания.
 */
const HIDDEN_BY_DEFAULT = ['vendor'];

/** Видимость при первом открытии: сохранённого выбора ещё нет. */
export function defaultVisibility(pack: Pack): VisibilitySpec {
  const hidden = new Set<number>();
  for (let path = 1; path < pack.meta.pathCount; path++) {
    if (pack.pathIsDir[path] !== 1) continue;
    const full = pack.paths[path]!;
    const slash = full.lastIndexOf('/');
    const name = slash === -1 ? full : full.slice(slash + 1);
    if (HIDDEN_BY_DEFAULT.includes(name)) hidden.add(path);
  }
  return { hidden, collapsed: new Set() };
}

/**
 * Разбирает сохранённую видимость. Любое непонятное содержимое — не JSON,
 * не объект, поля не того типа — читается как «выбора ещё нет», то есть даёт
 * умолчание: выбор панели не та ценность, ради которой стоит ронять страницу.
 *
 * Разница между «выбора нет» и «выбран пустой набор» здесь значимая. Пустое
 * хранилище — это первое открытие, и тогда действует умолчание. А вот
 * сохранённые пустые списки означают, что пользователь снял скрытие руками, и
 * возвращать его обратно нельзя: иначе `vendor` воскресал бы после каждой
 * перезагрузки, и панель выглядела бы сломанной.
 */
export function decodeVisibility(pack: Pack, raw: string | null | undefined): VisibilitySpec {
  if (!raw) return defaultVisibility(pack);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultVisibility(pack);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultVisibility(pack);
  }
  const bag = parsed as Record<string, unknown>;
  return { hidden: idsOf(pack, bag.hidden), collapsed: idsOf(pack, bag.collapsed) };
}
