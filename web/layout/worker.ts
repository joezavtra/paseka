import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import {
  branchDistanceFor,
  chargeStrengthFor,
  countChildren,
  linkDistanceFor,
  linkStrengthFor,
  radialShare,
} from './graph.js';
import { buildChildIndex, subtreeStats, type SubtreeStats } from './subtree.js';
import type { ChildIndex, ConeSettings } from './cones.js';
import {
  forceCones,
  forceFolderCohesion,
  forceGroupRepel,
  type ConeState,
  type FolderState,
} from './forces.js';
import { DEFAULT_LAYOUT_PARAMS, sanitizeParams, type LayoutParams } from './params.js';
import { NodeStore, type StoreNode } from './node-store.js';
import type { FromWorker, ToWorker } from './protocol.js';

/**
 * Бухгалтерия узлов (кто жив, где стоит, рождение у родителя) вынесена в
 * `NodeStore` — она не зависит от d3-force и от `self`, поэтому проверяется
 * тестами напрямую. Здесь остаётся только сама симуляция сил.
 */
let store: NodeStore | null = null;
/** Дерево путей: приходит один раз в `init` и нужно обходам по поддеревьям. */
let treeParent: Uint32Array = new Uint32Array(0);
let simulation: Simulation<StoreNode, SimulationLinkDatum<StoreNode>> | null = null;
let lastPost = 0;
/**
 * Номер последнего применённого `update`. Эхуется в каждом `positions`, чтобы
 * главный поток мог отличить свежий ответ от тика симуляции, отправленного до
 * того, как этот `update` был применён (см. `LayoutPositions.epoch`). Тики
 * между двумя `update` несут один и тот же номер — это не «устаревание», а
 * продолжающееся уточнение позиций в рамках уже известной главному потоку
 * маски.
 */
let lastAppliedEpoch = 0;
/**
 * Текущие настройки сил. Приходят сообщением от панели настроек; до первого
 * такого сообщения действуют замеренные умолчания.
 */
let params: LayoutParams = DEFAULT_LAYOUT_PARAMS;
/**
 * Число рисуемых потомков у каждого пути на последнем `update`. Держится
 * модульной переменной, потому что силы читают его при переинициализации —
 * а она случается внутри d3, когда мы отдаём симуляции новый состав узлов.
 */
let childCount: Uint32Array = new Uint32Array(0);
/**
 * Рёбра последнего `update`. Хранятся потому, что силу рёбер приходится
 * собирать заново и при смене настроек, а не только при смене состава.
 */
let lastLinks: SimulationLinkDatum<StoreNode>[] = [];
/**
 * След поддерева на последнем `update`: сколько места требует каждая папка со
 * всем, что внутри. Из него выводится длина ребра. Пересчитывается вместе с
 * составом, потому что зависит и от маски, и от радиусов.
 */
let stats: SubtreeStats | null = null;
/** Рисуемая маска последнего `update`: нужна для пересчёта следов. */
let lastActive: Uint8Array = new Uint8Array(0);
/** Радиусы по идентификатору пути: у узлов они лежат в объектах, а следам нужен массив. */
let lastRadius: Float32Array = new Float32Array(0);
/**
 * Дети каждого пути последнего `update`. Нужны и следу (кольцо считается по
 * ветвящимся детям), и угловой силе, поэтому строятся один раз на состав.
 */
let childIndex: ChildIndex = { start: new Uint32Array(1), items: new Uint32Array(0) };

/** Угловая часть настроек: панель хранит зазор в градусах, геометрия — в радианах. */
function coneSettings(): ConeSettings {
  return {
    backGuard: (params.coneGap * Math.PI) / 180,
    branchBudget: params.branchBudget,
  };
}
/**
 * Состояние групповых сил. Один объект, который силы держат по ссылке: при
 * смене состава и настроек он переписывается на месте, и пересобирать сами
 * силы ради этого не нужно — их переинициализирует d3, когда меняется состав.
 */
const folders: FolderState = {
  active: new Uint8Array(0),
  parent: new Uint32Array(0),
  footprint: new Float32Array(0),
  leaves: new Uint32Array(0),
  area: new Float64Array(0),
  cohesion: DEFAULT_LAYOUT_PARAMS.groupCohesion,
  repel: DEFAULT_LAYOUT_PARAMS.groupRepel,
  gap: DEFAULT_LAYOUT_PARAMS.groupGap,
};

/**
 * Состояние угловой силы. Держится так же, как `folders`, и по той же причине:
 * силу переинициализирует сам d3 при смене состава, и пересобирать её ради
 * новых чисел не нужно.
 */
const cones: ConeState = {
  active: new Uint8Array(0),
  parent: new Uint32Array(0),
  footprint: new Float32Array(0),
  children: { start: new Uint32Array(1), items: new Uint32Array(0) },
  strength: DEFAULT_LAYOUT_PARAMS.coneStrength,
  maxStep: DEFAULT_LAYOUT_PARAMS.coneMaxStep,
  guard: (DEFAULT_LAYOUT_PARAMS.coneGap * Math.PI) / 180,
};

/** Переносит свежие следы и настройки в состояния, которые читают силы по ссылке. */
function syncFolders(): void {
  folders.active = lastActive;
  folders.parent = treeParent;
  folders.cohesion = params.groupCohesion;
  folders.repel = params.groupRepel;
  folders.gap = params.groupGap;
  if (stats) {
    folders.footprint = stats.footprint;
    folders.leaves = stats.leaves;
    folders.area = stats.area;
  }

  cones.active = lastActive;
  cones.parent = treeParent;
  cones.children = childIndex;
  cones.strength = params.coneStrength;
  cones.maxStep = params.coneMaxStep;
  cones.guard = (params.coneGap * Math.PI) / 180;
  if (stats) cones.footprint = stats.footprint;
}

/**
 * Пересобирает силы по текущим настройкам.
 *
 * Именно пересобирает, а не «обновляет»: d3 вычисляет силу узла один раз, в
 * `initialize`, поэтому подмена замыкания уже созданной силе ничего не даёт —
 * старые значения остались бы в её внутренних массивах до следующей смены
 * состава узлов. Дешевле и честнее собрать силы заново: их три, а узлы и их
 * позиции при этом не трогаются.
 */
function applyForces(target: Simulation<StoreNode, SimulationLinkDatum<StoreNode>>): void {
  const branching = (link: SimulationLinkDatum<StoreNode>): number => {
    const source = link.source as StoreNode;
    return childCount[source.id] ?? 0;
  };
  // Групповые силы не только не подорожали, но и окупились: замер на
  // синтетическом монорепозитории (8263 узла) даёт медианный тик 36 мс против
  // 44 мс до перехода на следы поддерева — ослабленный заряд листьев с
  // укороченным радиусом действия экономит больше, чем стоят два прохода по
  // путям.
  //
  // Порядок вставки значим: d3 хранит силы в Map и обходит их в порядке
  // первого добавления, и каждая следующая читает уже накопленную за этот тик
  // скорость. Разведение стоит последним: за фактическое наложение кружков
  // отвечает оно, и групповой сдвиг не должен идти следом и снова их сближать.
  //
  // Величина эффекта замерена, а не предположена, и она мала: на пересобранном
  // стенде того же размера (8186 узлов) перенос разведения в конец даёт 13 619 пар
  // задетых кружков против 14 198 — минус 4% при среднем проникновении 0.31 px
  // против 0.32. Число устойчиво по сидам, в отличие от пересечений рёбер: те
  // гуляют на шесть процентных пунктов от одной начальной раскладки к другой,
  // и по одному прогону про них ничего сказать нельзя.
  target
    .force(
      'charge',
      forceManyBody<StoreNode>()
        .strength((node) => chargeStrengthFor(node.radius, childCount[node.id] ?? 0, params))
        .distanceMax(params.chargeDistanceMax),
    )
    .force('groupRepel', forceGroupRepel(folders))
    .force('groupCohesion', forceFolderCohesion(folders))
    .force('cones', forceCones(cones))
    .force(
      'link',
      forceLink<StoreNode, SimulationLinkDatum<StoreNode>>(lastLinks)
        .distance((link) => {
          if (!stats) return params.linkMin;
          const source = link.source as StoreNode;
          const target = link.target as StoreNode;
          const parentFootprint = stats.footprint[source.id] ?? 0;
          const childFootprint = stats.footprint[target.id] ?? 0;
          // Развилка «папка или файл»: подпапка идёт на кольцо, где её конус
          // узок и предсказуем, файл — на случайную глубину диска. Случайная
          // доля радиуса подпапке прямо вредна: она задавала бы ей произвольную
          // угловую потребность.
          if ((childCount[target.id] ?? 0) > 0) {
            return branchDistanceFor(parentFootprint, childFootprint, stats.ring[source.id] ?? 0, params);
          }
          return linkDistanceFor(parentFootprint, childFootprint, params, radialShare(target.id));
        })
        .strength((link) => linkStrengthFor(branching(link), params)),
    )
    // Узлы не должны налезать друг на друга: отталкивание зарядом держит их на
    // расстоянии в среднем, но не мешает крупному узлу накрыть соседа — а
    // накрытый узел и не кликается, и не читается.
    // Цена измерена, а не прикинута: на 7500 узлов тик дорожает с 28 до 38 мс
    // (+34%). Раскладка живёт в воркере и кадры не задерживает, поэтому платим
    // временем сходимости, а не частотой отрисовки.
    .force(
      'collide',
      forceCollide<StoreNode>()
        .radius((node) => node.radius + params.collidePadding)
        .strength(params.collideStrength),
    )
    .alphaDecay(params.alphaDecay)
    .velocityDecay(params.velocityDecay);
}

function post(alpha: number): void {
  if (!store) return;
  const positions = store.positions();
  const message: FromWorker = { type: 'positions', positions, alpha, epoch: lastAppliedEpoch };
  (self as unknown as Worker).postMessage(message, [positions.buffer]);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  if (message.type === 'init') {
    store = new NodeStore(message.pathCount, message.parent, message.seed);
    treeParent = message.parent;
    lastPost = 0;
    lastAppliedEpoch = 0;
    lastLinks = [];
    childCount = new Uint32Array(0);
    stats = null;
    lastActive = new Uint8Array(0);
    lastRadius = new Float32Array(0);
    childIndex = { start: new Uint32Array(1), items: new Uint32Array(0) };
    simulation?.stop();
    simulation = null;
    return;
  }

  if (message.type === 'params') {
    // Чужие и негодные значения отсекаются здесь, а не только в панели:
    // сообщение приходит из другого потока, и NaN в силе — это молча
    // застывшая раскладка без единого следа.
    params = sanitizeParams(message.params);
    // Следы зависят от настроек упаковки и зазора, поэтому пересчитываются
    // вместе с ними, а не только при смене состава.
    if (lastActive.length > 0) {
      stats = subtreeStats(
        lastActive,
        treeParent,
        lastRadius,
        params.collidePadding,
        params.packFill,
        childIndex,
        coneSettings(),
      );
    }
    syncFolders();
    if (simulation) {
      applyForces(simulation);
      // Подогреваем: без этого новые силы просто не на чем было бы применить —
      // остывшая симуляция не двигает узлы вовсе, и панель выглядела бы
      // сломанной.
      simulation.alpha(Math.max(simulation.alpha(), 0.5)).restart();
    }
    return;
  }

  if (!store) return; // 'update' до 'init' — воркер ещё не готов, сообщение отбрасываем

  const nodes = store.applyUpdate({
    active: message.active,
    added: message.added,
    radiusIds: message.radiusIds,
    radiusValues: message.radiusValues,
  });
  // До первого post() ниже: любой ответ с этого момента относится уже к
  // этому update, а не к предыдущему.
  lastAppliedEpoch = message.epoch;

  const byId = new Map<number, StoreNode>();
  for (const node of nodes) byId.set(node.id, node);
  const links: SimulationLinkDatum<StoreNode>[] = [];
  for (let i = 0; i < message.linkSource.length; i++) {
    const source = byId.get(message.linkSource[i]!);
    const target = byId.get(message.linkTarget[i]!);
    if (source && target) links.push({ source, target });
  }

  if (!simulation) {
    simulation = forceSimulation<StoreNode>(nodes)
      .force('center', forceCenter(0, 0))
      .on('tick', () => {
        // Рендер всё равно не успевает чаще ~30 Гц, а сообщения не бесплатны.
        const now = performance.now();
        if (now - lastPost < 33) return;
        lastPost = now;
        post(simulation!.alpha());
      })
      .on('end', () => post(0));
  } else {
    simulation.nodes(nodes);
  }

  // Длина и жёсткость ребра зависят от ветвления папки: транзитная папка с
  // единственным ребёнком стоит к нему вплотную и держится жёстко, ветвящейся
  // нужно кольцо пошире. Ветвление считается по тем же рёбрам, что уходят в
  // силу, то есть по видимому дереву, а не по истории.
  childCount = countChildren(message.linkSource, message.active.length);
  lastLinks = links;
  // Радиусы живут в объектах узлов, а следам нужен массив по идентификатору.
  lastActive = message.active;
  lastRadius = new Float32Array(message.active.length);
  for (const node of nodes) lastRadius[node.id] = node.radius;
  childIndex = buildChildIndex(lastActive, treeParent);
  stats = subtreeStats(
    lastActive,
    treeParent,
    lastRadius,
    params.collidePadding,
    params.packFill,
    childIndex,
    coneSettings(),
  );
  syncFolders();
  applyForces(simulation);

  // Подогреваем: новые узлы должны разойтись, а не остаться в точке рождения.
  simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  post(simulation.alpha());
};
