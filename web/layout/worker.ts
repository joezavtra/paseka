import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
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
    simulation?.stop();
    simulation = null;
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
      .force('charge', forceManyBody<StoreNode>().strength((node) => -30 - node.radius * 4))
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.015)
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

  simulation.force(
    'link',
    forceLink<StoreNode, SimulationLinkDatum<StoreNode>>(links).distance(24).strength(0.7),
  );
  // Подогреваем: новые узлы должны разойтись, а не остаться в точке рождения.
  simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  post(simulation.alpha());
};
