/**
 * Групповая физика: папка ведёт себя как целое.
 *
 * Пользовательская жалоба звучала так: файлы одной папки должны отталкиваться
 * от файлов других папок сильнее, чем внутри папки. Буквально это не
 * реализуемо: `forceManyBody` работает через квадродерево Барнса — Хата и
 * приближает далёкую группу узлов одной точкой, а групповой принадлежности в
 * такой аппроксимации уже нет. Зато то же самое дёшево делается наоборот —
 * считать не «узел против узла», а «папка против папки», и раздавать
 * результат членам.
 *
 * Отсюда две силы. Первая держит содержимое в границах своей папки, вторая
 * разводит папки, чьи следы налезли друг на друга. Обе живут здесь, в чистых
 * функциях над типизированными массивами: воркер только собирает симуляцию,
 * а вся математика проверяется тестами без d3 и без `self`.
 */

/**
 * Минимальное число файлов, при котором папка участвует в расталкивании.
 *
 * Не выразительное средство, а защита стоимости: без порога папка с двумя
 * тысячами файлов-детей дала бы под четыре миллиона пар на тик. С порогом
 * пары считаются только между содержательными папками — замерено на
 * синтетическом монорепозитории из 8263 узлов: 278 пар при максимуме 10 групп
 * у одного родителя, то есть работа этой силы теряется в шуме тика.
 */
export const MIN_GROUP_LEAVES = 4;

/**
 * Предохранитель на вырожденного родителя: если папок-детей больше, пары для
 * него не строятся вовсе. Тысяча сиблингов дала бы полмиллиона пар на тик —
 * там дешевле оставить работу заряду.
 */
export const MAX_SIBLING_GROUPS = 256;

/**
 * Центр масс каждого поддерева: сумма координат, взвешенная площадью кружков.
 *
 * Проход по убыванию идентификатора — родитель всегда меньше потомка, поэтому
 * к моменту обработки пути все его потомки уже отдали ему свои суммы. Порядок
 * фиксирован, а значит и результат воспроизводим: детерминизм здесь держится
 * на порядке обхода, а не на устойчивости сложения.
 *
 * `x` и `y` индексируются идентификатором пути; узлов, которых нет в маске,
 * это не касается — их координаты в накопление не попадают.
 */
export function accumulateCentroids(
  active: Uint8Array,
  parent: Uint32Array,
  x: Float64Array,
  y: Float64Array,
  mass: Float64Array,
  outX: Float64Array,
  outY: Float64Array,
  outMass: Float64Array,
): void {
  const pathCount = active.length;
  outX.fill(0);
  outY.fill(0);
  outMass.fill(0);

  for (let path = 0; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    const m = mass[path]!;
    outX[path] = x[path]! * m;
    outY[path] = y[path]! * m;
    outMass[path] = m;
  }

  for (let path = pathCount - 1; path >= 1; path--) {
    if (active[path] !== 1) continue;
    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;
    outX[p] += outX[path]!;
    outY[p] += outY[path]!;
    outMass[p] += outMass[path]!;
  }
}

/**
 * Мягкая граница папки: ноль внутри следа, линейный возврат снаружи.
 *
 * Прямое притяжение каждого узла к центру масс папки было бы скрытым
 * укорачиванием ребра и дралось бы с силой пружин: обе действуют вдоль одного
 * направления, одна внутрь, другая наружу, и два параметра управляли бы одним
 * и тем же. Здесь узел внутри своего следа не чувствует ничего — пружины и
 * разведение кружков работают в неизменном режиме, — а сила включается только
 * на выходе за границу.
 *
 * Это и есть прямой ответ на исходную жалобу: перемешивание — это узлы вне
 * следа своей папки, и сила действует ровно на них.
 *
 * Группировка по прямому родителю: узел принадлежит ровно одной группе, а дед
 * охватывает его через саму папку, которая тоже член его группы. Двойного
 * учёта нет по построению.
 */
export function containmentDeltas(
  active: Uint8Array,
  parent: Uint32Array,
  x: Float64Array,
  y: Float64Array,
  footprint: Float32Array,
  centroidX: Float64Array,
  centroidY: Float64Array,
  strength: number,
  alpha: number,
  vx: Float64Array,
  vy: Float64Array,
): void {
  if (strength <= 0) return;
  const pathCount = active.length;
  for (let path = 1; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;

    const dx = x[path]! - centroidX[p]!;
    const dy = y[path]! - centroidY[p]!;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) continue;

    const excess = distance + footprint[path]! - footprint[p]!;
    if (excess <= 0) continue;

    const pull = (excess * strength * alpha) / distance;
    vx[path] -= dx * pull;
    vy[path] -= dy * pull;
  }
}

/** Пары папок-сиблингов в плоском виде: `a[i]` и `b[i]` — одна пара. */
export interface SiblingPairs {
  a: Uint32Array;
  b: Uint32Array;
}

/**
 * Пары папок, конкурирующих за место вокруг общего родителя.
 *
 * Все папки попарно — это квадрат по их числу: на полутора тысячах папок два
 * с лишним миллиона пар на тик. Сиблинги — это сумма квадратов по родителям, и
 * в дереве репозитория она на порядки меньше. Физика при этом правильнее: за
 * место вокруг общего родителя конкурируют именно сиблинги, а неродственники
 * разъезжаются рекурсивно вслед за своими предками.
 */
export function siblingPairs(
  active: Uint8Array,
  parent: Uint32Array,
  leaves: Uint32Array,
  minLeaves: number = MIN_GROUP_LEAVES,
  maxGroups: number = MAX_SIBLING_GROUPS,
): SiblingPairs {
  const pathCount = active.length;
  const byParent = new Map<number, number[]>();
  for (let path = 1; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    if (leaves[path]! < minLeaves) continue;
    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;
    const group = byParent.get(p);
    if (group) group.push(path);
    else byParent.set(p, [path]);
  }

  const a: number[] = [];
  const b: number[] = [];
  // Обход по возрастанию родителя, а не по порядку вставки в Map: порядок пар
  // не должен зависеть от того, в каком порядке встретились дети.
  for (const p of [...byParent.keys()].sort((first, second) => first - second)) {
    const group = byParent.get(p)!;
    if (group.length > maxGroups) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        a.push(group[i]!);
        b.push(group[j]!);
      }
    }
  }
  return { a: Uint32Array.from(a), b: Uint32Array.from(b) };
}

/**
 * Расталкивание папок по контакту следов: сила включается только при
 * фактическом наложении.
 *
 * Контактность отвечает и на вопрос о двойном счёте с зарядом: заряд действует
 * всегда и везде, а эта сила — ровно там, где заряд уже не справился. Так же,
 * как разведение кружков сосуществует с зарядом на уровне узлов.
 *
 * Совпавшие центры (два следа в одной точке) разводятся по направлению,
 * выведенному из идентификатора: `Math.random()` в проекте запрещён, а делить
 * на ноль нельзя — иначе в скорости появится NaN и раскладка молча застынет.
 */
export function repelSiblings(
  pairs: SiblingPairs,
  centroidX: Float64Array,
  centroidY: Float64Array,
  footprint: Float32Array,
  mass: Float64Array,
  gap: number,
  strength: number,
  alpha: number,
  pushX: Float64Array,
  pushY: Float64Array,
): void {
  if (strength <= 0) return;
  for (let i = 0; i < pairs.a.length; i++) {
    const a = pairs.a[i]!;
    const b = pairs.b[i]!;
    let dx = centroidX[b]! - centroidX[a]!;
    let dy = centroidY[b]! - centroidY[a]!;
    let distance = Math.hypot(dx, dy);
    if (distance <= 1e-6) {
      const angle = ((a * 2654435761) % 1000) / 1000 * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }
    const overlap = footprint[a]! + footprint[b]! + gap - distance;
    if (overlap <= 0) continue;

    const massA = Math.max(1e-9, mass[a]!);
    const massB = Math.max(1e-9, mass[b]!);
    const shareA = massB / (massA + massB);
    const move = (overlap * strength * alpha) / distance;
    pushX[a] -= dx * move * shareA;
    pushY[a] -= dy * move * shareA;
    pushX[b] += dx * move * (1 - shareA);
    pushY[b] += dy * move * (1 - shareA);
  }
}

/**
 * Раздаёт смещение группы всем её членам.
 *
 * Списка членов не нужно: проход по возрастанию идентификатора, где каждый
 * узел прибавляет к себе смещение родителя, доносит сдвиг до всего поддерева
 * ровно по разу. Вложенные сдвиги при этом складываются — жёсткий сдвиг
 * композируется, и это верно физически: если поехал дед, едет и внук.
 */
export function propagateDown(
  active: Uint8Array,
  parent: Uint32Array,
  pushX: Float64Array,
  pushY: Float64Array,
): void {
  const pathCount = active.length;
  for (let path = 1; path < pathCount; path++) {
    if (active[path] !== 1) continue;
    const p = parent[path]!;
    if (p === path || active[p] !== 1) continue;
    pushX[path] += pushX[p]!;
    pushY[path] += pushY[p]!;
  }
}
