import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import { chargeStrengthFor, countChildren, linkDistanceFor, linkStrengthFor } from './graph.js';
import { DEFAULT_LAYOUT_PARAMS, sanitizeParams, type LayoutParams } from './params.js';
import { NodeStore, type StoreNode } from './node-store.js';
import type { FromWorker, ToWorker } from './protocol.js';

/**
 * Бухгалтерия узлов (кто жив, где стоит, рождение у родителя) вынесена в
 * `NodeStore` — она не зависит от d3-force и от `self`, поэтому проверяется
 * тестами напрямую. Здесь остаётся только сама симуляция сил.
 */
let store: NodeStore | null = null;
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
  target
    .force(
      'charge',
      forceManyBody<StoreNode>()
        .strength((node) => chargeStrengthFor(node.radius, childCount[node.id] ?? 0, params))
        .distanceMax(params.chargeDistanceMax),
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
    .force(
      'link',
      forceLink<StoreNode, SimulationLinkDatum<StoreNode>>(lastLinks)
        .distance((link) => linkDistanceFor(branching(link), params))
        .strength((link) => linkStrengthFor(branching(link), params)),
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
    lastPost = 0;
    lastAppliedEpoch = 0;
    lastLinks = [];
    childCount = new Uint32Array(0);
    simulation?.stop();
    simulation = null;
    return;
  }

  if (message.type === 'params') {
    // Чужие и негодные значения отсекаются здесь, а не только в панели:
    // сообщение приходит из другого потока, и NaN в силе — это молча
    // застывшая раскладка без единого следа.
    params = sanitizeParams(message.params);
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
  applyForces(simulation);

  // Подогреваем: новые узлы должны разойтись, а не остаться в точке рождения.
  simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  post(simulation.alpha());
};
