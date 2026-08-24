/**
 * След поддерева: сколько места на сцене требует папка со всем, что внутри.
 *
 * Один производный факт, из которого выводится и длина ребра, и граница папки,
 * и радиус группы при расталкивании. Считается в воркере, а не приходит из
 * главного потока, по двум причинам. Во-первых, у воркера уже есть всё нужное
 * (дерево из `init`, рисуемая маска и радиусы из `update`), и слать ещё один
 * массив на каждый коммит значило бы гонять по шестьдесят килобайт ради того
 * же прохода. Во-вторых, у главного потока есть похожее число `visibility.files`,
 * и оно тут не годится: у свёрнутой папки там всё спрятанное внутри, а места
 * на сцене она занимает ровно один кружок.
 */

import { angularBudget, ringRadius, type ChildIndex, type ConeSettings } from './cones.js';

/**
 * Дети каждого пути одним плоским массивом: `items[start[p] .. start[p + 1])`.
 *
 * Нужен угловому плану: тот раскладывает детей по кольцу и обязан обходить их
 * в фиксированном порядке, а из одного массива родителей порядок детей не
 * достать иначе как повторным проходом по всему дереву на каждую папку.
 *
 * Дети внутри родителя выходят по возрастанию идентификатора, потому что
 * заполняющий проход идёт по возрастанию пути. Порядок здесь не украшение:
 * на нём держится обещание, что новый ребёнок встаёт в кольцо последним и не
 * перетасовывает уже стоящих (см. planSectors).
 */
export function buildChildIndex(active: Uint8Array, parent: Uint32Array): ChildIndex {
  const pathCount = active.length;
  const start = new Uint32Array(pathCount + 1);
  for (let path = 1; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;
    start[p + 1] = start[p + 1]! + 1;
  }
  for (let path = 0; path < pathCount; path++) start[path + 1] = start[path + 1]! + start[path]!;

  const items = new Uint32Array(start[pathCount]!);
  const cursor = start.slice(0, pathCount);
  for (let path = 1; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;
    items[cursor[p]!] = path;
    cursor[p] = cursor[p]! + 1;
  }
  return { start, items };
}

/** Результат обхода: всё индексируется идентификатором пути. */
export interface SubtreeStats {
  /** Сумма площадей кружков поддерева, в квадратных пикселях мира. */
  area: Float64Array;
  /** Число рисуемых узлов без потомков: файлы, свёрнутые папки, пустые каталоги. */
  leaves: Uint32Array;
  /** Радиус круга, в который поддерево укладывается. */
  footprint: Float32Array;
  /**
   * Расстояние, ближе которого ветвящиеся дети этого пути стоять не должны:
   * иначе их конусы налезут друг на друга и секторов на всех не хватит. Ноль
   * значит «ограничения нет».
   */
  ring: Float64Array;
}

/**
 * Радиус следа по площади поддерева и следу самого крупного ребёнка.
 *
 * Кольцо — неверная модель: условие «k равных кружков на одном кольце» даёт
 * радиус, растущий линейно по k, и для папки на две тысячи файлов обещало бы
 * кольцо радиусом в тысячи пикселей там, где физически наблюдается диск в
 * четыре сотни. Поэтому диск: площадь поддерева, делённая на плотность
 * упаковки.
 *
 * Слагаемое `Rmax` нужно, чтобы формула была точна на вырожденном случае: у
 * папки с единственным ребёнком остаток под корнем — ноль, и след папки
 * совпадает со следом ребёнка. Отсюда транзитные цепочки каталогов
 * (`internal/app/service/domain/...`) сами собой остаются короткими, без
 * единой отдельной ветки в коде.
 *
 * Собственный кружок узла в упаковку не входит и учитывается отдельно, нижней
 * границей. Иначе плотность упаковки раздувала бы одинокий узел: у листа и у
 * свёрнутой папки нет детей, которые надо укладывать, и след обязан равняться
 * их собственному радиусу, а не ему же, делённому на плотность.
 *
 * Сверено с точными значениями упаковки равных кругов в круге: при k = 7
 * формула даёт 3.74 радиуса против точных 3.0, при k = 2000 — 50.9 против
 * 45.3. Запас в 12–25% — не ошибка счёта, а слабина, которая дальше служит
 * мягкой границей папки: внутри неё содержимое свободно, а сила включается
 * только на выходе за след.
 */
export function footprintRadius(
  childArea: number,
  maxChildFootprint: number,
  ownRadius: number,
  packFill: number,
): number {
  const fill = packFill > 0 ? packFill : 1;
  const base = Math.max(0, maxChildFootprint);
  const rest = Math.max(0, childArea - base * base);
  return Math.max(Math.max(0, ownRadius), base + Math.sqrt(rest / fill));
}

/**
 * Считает площади, число листьев и следы для всех рисуемых путей.
 *
 * Один проход по убыванию идентификатора: родитель всегда меньше потомка,
 * значит к моменту обработки пути все его потомки уже посчитаны и отдали ему
 * свою площадь. В том же проходе след узла окончателен — площадь поддерева
 * собрана, самый крупный ребёнок известен.
 *
 * Предикат «оба конца в маске» намеренно повторяет `buildActiveLinks`: агрегат
 * должен описывать ровно то дерево, которое ушло в силу рёбер. Учти узел, у
 * которого нет пружины, — и длина ребра разойдётся с набором пружин.
 */
export function subtreeStats(
  active: Uint8Array,
  parent: Uint32Array,
  radius: Float32Array,
  padding: number,
  packFill: number,
  children: ChildIndex,
  settings: ConeSettings,
): SubtreeStats {
  const pathCount = active.length;
  const area = new Float64Array(pathCount);
  const leaves = new Uint32Array(pathCount);
  const footprint = new Float32Array(pathCount);
  const ring = new Float64Array(pathCount);
  /** Следы ветвящихся детей одного узла; массив переиспользуется на каждый узел. */
  const branchFootprints: number[] = [];

  /**
   * Поправка на кольцо: папка обязана вмещать своих ветвящихся детей там, где
   * они на самом деле встанут.
   *
   * Площадная модель отвечает на вопрос «сколько места нужно кружкам», а
   * угловая — на другой: «насколько далеко их приходится отодвинуть, чтобы
   * хватило углов». Оба ответа верны, и брать надо больший. Если этого не
   * сделать, папка выдаст детям кольцо, в которое сама не помещается, и сборка
   * группы потащит их обратно внутрь — против только что выданного сектора.
   */
  const applyRing = (path: number): void => {
    branchFootprints.length = 0;
    let maxBranch = 0;
    const from = children.start[path]!;
    const to = children.start[path + 1]!;
    for (let i = from; i < to; i++) {
      const child = children.items[i]!;
      if (children.start[child + 1]! === children.start[child]!) continue;
      const value = footprint[child]!;
      branchFootprints.push(value);
      if (value > maxBranch) maxBranch = value;
    }
    if (branchFootprints.length === 0) return;
    const radiusOfRing = ringRadius(branchFootprints, angularBudget(path === 0, settings));
    ring[path] = radiusOfRing;
    const needed = radiusOfRing + maxBranch;
    if (needed > footprint[path]!) footprint[path] = needed;
  };
  /** След самого крупного ребёнка; заполняется потомками по ходу обхода. */
  const maxChild = new Float32Array(pathCount);
  /** Есть ли у пути рисуемые потомки: лист — тот, у кого их нет. */
  const hasChildren = new Uint8Array(pathCount);

  for (let path = 0; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    const own = Math.max(0, radius[path]!) + padding;
    area[path] = own * own;
  }

  for (let path = pathCount - 1; path >= 1; path--) {
    if (active[path] !== 1) continue;
    const own = Math.max(0, radius[path]!) + padding;
    footprint[path] = footprintRadius(area[path]! - own * own, maxChild[path]!, own, packFill);
    applyRing(path);
    if (hasChildren[path] === 0) leaves[path] = 1;

    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;
    hasChildren[p] = 1;
    area[p] += area[path]!;
    leaves[p] += leaves[path]!;
    if (footprint[path]! > maxChild[p]!) maxChild[p] = footprint[path]!;
  }

  if (pathCount > 0 && active[0] === 1) {
    const own = Math.max(0, radius[0]!) + padding;
    footprint[0] = footprintRadius(area[0]! - own * own, maxChild[0]!, own, packFill);
    applyRing(0);
    if (hasChildren[0] === 0) leaves[0] = 1;
  }

  return { area, leaves, footprint, ring };
}
