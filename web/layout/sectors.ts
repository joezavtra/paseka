/**
 * Угловой план дерева: кому вокруг папки какой сектор.
 *
 * Пересечения рёбер берутся не из «плохой физики», а из того, что углами в
 * раскладке не управляет ничто: пружины держат расстояние, разведение — контакт
 * кружков, групповые силы — налегание следов, и ни одна из них не про угол.
 * Дерево же планарно по построению, и нарисовано без пересечений оно ровно
 * тогда, когда вокруг каждого узла поддеревья занимают непересекающиеся угловые
 * секторы и каждое остаётся внутри своего. Второе уже обеспечено следами
 * (см. groups.ts), недостаёт первого.
 *
 * План — чистая функция от дерева, маски, следов и настроек: позиций здесь нет
 * ни в одном аргументе, и это существенно. Сектор, выведенный из текущих
 * координат, менялся бы от тика к тику и превратил бы возвращающую силу в
 * генератор шума; план же пересчитывается только при смене состава.
 */

const TAU = Math.PI * 2;

/** Угол в (−π, π]: разность направлений всегда берётся по короткой дуге. */
export function wrapPi(angle: number): number {
  const wrapped = angle % TAU;
  if (wrapped > Math.PI) return wrapped - TAU;
  if (wrapped <= -Math.PI) return wrapped + TAU;
  return wrapped;
}

/**
 * Полуугол конуса, в котором поддерево видно из своего родителя.
 *
 * Ребёнок со следом `R` на расстоянии `d` вместе со всем содержимым лежит
 * внутри конуса с вершиной в родителе и полууглом `asin(R/d)`. Если след
 * накрыл саму вершину, конус вырождается в полную плоскость — у транзитной
 * папки, стоящей вплотную к родителю, никакого «направления» просто нет.
 */
export function requiredHalfAngle(footprint: number, distance: number): number {
  const r = Math.max(0, footprint);
  if (!(distance > 0) || r >= distance) return Math.PI;
  return Math.asin(r / distance);
}

/**
 * Наименьший радиус кольца, на котором конусы детей укладываются в бюджет.
 *
 * Это и есть ответ на вопрос «а что, если угла не хватает»: угол добирается
 * радиусом. Сумма ширин конусов `2·asin(R_i/d)` монотонно убывает по `d`,
 * поэтому наименьшее годное `d` находится делением пополам, а не подбором.
 *
 * Единственному ветвящемуся ребёнку кольцо не нужно вовсе: конусы разводят
 * между собой, а разводить нечего. Это не мелкая оптимизация, а условие
 * сохранности транзитных цепочек: общая формула потребовала бы от одинокого
 * ребёнка отойти на собственный след, и цепочка каталогов растянулась бы ровно
 * тем растягиванием, ради избавления от которого длина ребра когда-то и стала
 * выводиться из следов.
 *
 * Кольцо — нижняя граница расстояния, а не предписание. Ребёнок, стоящий
 * дальше, виден под ещё более узким конусом и в свой сектор попадает с
 * запасом; нарушить сектор способно только приближение.
 *
 * Дорогой случай формула не смягчает: если у папки два ребёнка и один из них
 * огромен, он обязан отойти дальше собственного следа, иначе накроет вершину и
 * второму не останется ни градуса. Это честная цена планарности, а не изъян
 * счёта.
 */
export function ringRadius(footprints: readonly number[], budget: number): number {
  if (footprints.length < 2) return 0;
  let maxFootprint = 0;
  let sum = 0;
  for (const value of footprints) {
    const r = Math.max(0, value);
    sum += r;
    if (r > maxFootprint) maxFootprint = r;
  }
  if (maxFootprint <= 0) return 0;

  const width = (d: number): number => {
    let total = 0;
    for (const value of footprints) total += 2 * requiredHalfAngle(value, d);
    return total;
  };

  let low = 0;
  if (width(low) <= budget) return 0;
  // Для больших d ширина ведёт себя как 2·ΣR/d, отсюда верхняя оценка. Удвоение
  // остаётся страховкой на случай, когда приближение ещё не работает.
  let high = Math.max(maxFootprint * 2, (4 * sum) / Math.max(budget, 1e-6));
  for (let guard = 0; guard < 40 && width(high) > budget; guard++) high *= 2;

  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (width(mid) > budget) low = mid;
    else high = mid;
  }
  return high;
}

/** Дети каждого пути в сжатом виде: `items[start[p] .. start[p + 1])`. */
export interface ChildIndex {
  start: Uint32Array;
  items: Uint32Array;
}

/** Всё, чем управляет пользователь в угловой части раскладки. */
export interface SectorSettings {
  /** Зазор вокруг направления на родителя, радианы. */
  backGuard: number;
  /** Доля круга под ветвящихся детей; остаток достаётся файлам. */
  branchBudget: number;
  /** Насколько сектор шире собственного конуса, в долях соседнего зазора. */
  margin: number;
}

/** Настройки, приведённые к годным значениям: границы проверяются один раз. */
function normalize(settings: SectorSettings) {
  return {
    guard: Math.min(Math.PI / 3, Math.max(0, settings.backGuard)),
    budget: Math.min(1, Math.max(0, settings.branchBudget)),
    margin: Math.min(1, Math.max(0, settings.margin)),
  };
}

/**
 * Сколько угла отводится ветвящимся детям этого узла.
 *
 * Считается здесь, а не в двух местах, потому что этим числом пользуются и
 * след поддерева (кольцо входит в радиус папки), и сам план. Разойдись они —
 * и папка обещала бы детям кольцо, в которое сама не помещается, а сборка
 * группы тянула бы их обратно внутрь ровно против выданного сектора.
 *
 * У корня направления на родителя нет, поэтому и защищать нечего: круг
 * доступен целиком.
 */
export function angularBudget(isRoot: boolean, settings: SectorSettings): number {
  const { guard, budget } = normalize(settings);
  return (isRoot ? TAU : TAU - 2 * guard) * budget;
}

/** Угловой план: всё индексируется идентификатором пути. */
export interface SectorPlan {
  /** Направление сектора, отсчитанное от направления на родителя. */
  bearing: Float64Array;
  /** Полуширина сектора: за её пределами включается возвращающая сила. */
  halfWidth: Float64Array;
  /** Есть ли у пути свой сектор. Файлу он не нужен — ему хватает чужих границ. */
  hasSector: Uint8Array;
  /**
   * Ребёнок, задающий систему отсчёта для узла без родителя, или −1.
   * Заполняется только у корня: всем остальным отсчёт задаёт их родитель.
   */
  anchor: Int32Array;
}

/**
 * Раздаёт секторы ветвящимся детям каждой папки.
 *
 * Сектор нужен не всякому ребёнку, а только тому, у кого есть своё содержимое:
 * файл занимает точку, и его достаточно не пускать в чужой конус. Иначе
 * пришлось бы делить круг между двумя тысячами файлов и получать кольцо в
 * тысячи пикселей там, где физически наблюдается диск в четыре сотни.
 *
 * Порядок — по возрастанию идентификатора пути, и это не «просто
 * детерминированно». Идентификаторы раздаёт `PathTable` в порядке первого
 * появления в истории и не меняет за сессию, поэтому новый ребёнок всегда
 * получает наибольший идентификатор и встаёт последним в кольце: относительный
 * порядок уже стоящих не меняется никогда, и перетасовки не бывает по
 * построению. Порядок по размеру давал бы её на каждом коммите, порядок по
 * текущему углу зависел бы от истории тиков и не воспроизводился между
 * сессиями.
 *
 * У корня направления на родителя нет, поэтому систему отсчёта задаёт его
 * младший ветвящийся ребёнок: он получает сектор с направлением 0 и потому
 * никакой силы, а остальные раскладываются вокруг него. Так глобальный поворот
 * сцены остаётся свободным — привяжи мы отсчёт к оси мира, сцена медленно
 * доворачивалась бы к ней без всякой причины.
 */
export function planSectors(
  active: Uint8Array,
  children: ChildIndex,
  footprint: Float32Array,
  ring: Float64Array,
  settings: SectorSettings,
): SectorPlan {
  const pathCount = active.length;
  const plan: SectorPlan = {
    bearing: new Float64Array(pathCount),
    halfWidth: new Float64Array(pathCount),
    hasSector: new Uint8Array(pathCount),
    anchor: new Int32Array(pathCount).fill(-1),
  };
  const { guard, margin } = normalize(settings);

  for (let parent = 0; parent < pathCount; parent++) {
    if (active[parent] !== 1) continue;
    const from = children.start[parent]!;
    const to = children.start[parent + 1]!;
    if (to === from) continue;

    const branches: number[] = [];
    const footprints: number[] = [];
    for (let i = from; i < to; i++) {
      const child = children.items[i]!;
      if (children.start[child + 1]! === children.start[child]!) continue;
      branches.push(child);
      footprints.push(footprint[child]!);
    }
    if (branches.length === 0) continue;

    const isRoot = parent === 0;
    const arc = isRoot ? TAU : TAU - 2 * guard;
    let needed = 0;
    const widths: number[] = [];
    for (const value of footprints) {
      const width = 2 * requiredHalfAngle(value, ring[parent]!);
      widths.push(width);
      needed += width;
    }
    const gap = Math.max(0, arc - needed) / branches.length;

    // У корня младший ребёнок стоит по направлению 0 и задаёт отсчёт, а зазоры
    // ложатся между секторами: последний замыкается на первого через круг.
    // У остальных отсчёт задаёт родитель, и по половине зазора кладётся с
    // каждой стороны сектора — иначе крайний сектор упирался бы в границу
    // защитного зазора вокруг родителя и запас выталкивал бы его за неё.
    if (isRoot) {
      plan.bearing[branches[0]!] = 0;
      plan.anchor[parent] = branches[0]!;
      let cursor = widths[0]! / 2;
      for (let i = 1; i < branches.length; i++) {
        cursor += gap;
        plan.bearing[branches[i]!] = cursor + widths[i]! / 2;
        cursor += widths[i]!;
      }
    } else {
      let cursor = guard;
      for (let i = 0; i < branches.length; i++) {
        cursor += gap / 2;
        plan.bearing[branches[i]!] = cursor + widths[i]! / 2;
        cursor += widths[i]! + gap / 2;
      }
    }

    // Запас берётся из соседнего зазора и с обеих сторон сразу, поэтому при
    // запасе не выше единицы секторы в худшем случае касаются, но не налезают.
    for (let i = 0; i < branches.length; i++) {
      plan.halfWidth[branches[i]!] = widths[i]! / 2 + (margin * gap) / 2;
      plan.hasSector[branches[i]!] = 1;
    }
  }

  return plan;
}
