import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import { makeRng } from '../../src/util/rng.js';
import type { FromWorker, ToWorker } from './protocol.js';

interface Node {
  /** Идентификатор пути; сохраняется на всё время сессии. */
  id: number;
  x: number;
  y: number;
  radius: number;
}

/**
 * Все узлы, которые когда-либо появлялись, включая ушедшие. Позиция ушедшего
 * узла остаётся здесь: если файл вернётся, он всплывёт там же, где исчез.
 */
const known = new Map<number, Node>();
let active: Uint8Array = new Uint8Array(0);
let simulation: Simulation<Node, SimulationLinkDatum<Node>> | null = null;
let rng: () => number = makeRng(1);
let lastPost = 0;

function post(alpha: number): void {
  const positions = new Float32Array(active.length * 2);
  for (let path = 0; path < active.length; path++) {
    if (active[path] === 0) continue;
    const node = known.get(path);
    if (!node) continue;
    positions[path * 2] = node.x;
    positions[path * 2 + 1] = node.y;
  }
  const message: FromWorker = { type: 'positions', positions, alpha };
  (self as unknown as Worker).postMessage(message, [positions.buffer]);
}

/** Новый узел рождается рядом с родителем, если тот на сцене, иначе на кольце. */
function spawn(id: number, parentId: number, radius: number): Node {
  const parent = active[parentId] === 1 ? known.get(parentId) : undefined;
  const angle = rng() * Math.PI * 2;
  if (parent) {
    const jitter = 8 + rng() * 12;
    return { id, x: parent.x + Math.cos(angle) * jitter, y: parent.y + Math.sin(angle) * jitter, radius };
  }
  const distance = Math.sqrt(rng()) * 400;
  return { id, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, radius };
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;

  if (message.type === 'init') {
    known.clear();
    active = new Uint8Array(message.pathCount);
    rng = makeRng(message.seed);
    lastPost = 0;
    simulation?.stop();
    simulation = null;
    return;
  }

  for (const id of message.removed) active[id] = 0;
  for (let i = 0; i < message.added.length; i++) {
    const id = message.added[i]!;
    active[id] = 1;
    if (!known.has(id)) {
      known.set(id, spawn(id, message.parentOf[i]!, 3));
    }
  }
  for (let i = 0; i < message.radiusIds.length; i++) {
    const node = known.get(message.radiusIds[i]!);
    if (node) node.radius = message.radiusValues[i]!;
  }

  const nodes: Node[] = [];
  for (let path = 0; path < active.length; path++) {
    if (active[path] === 1) {
      const node = known.get(path);
      if (node) nodes.push(node);
    }
  }

  const byId = new Map<number, Node>();
  for (const node of nodes) byId.set(node.id, node);
  const links: SimulationLinkDatum<Node>[] = [];
  for (let i = 0; i < message.linkSource.length; i++) {
    const source = byId.get(message.linkSource[i]!);
    const target = byId.get(message.linkTarget[i]!);
    if (source && target) links.push({ source, target });
  }

  if (!simulation) {
    simulation = forceSimulation<Node>(nodes)
      .force('charge', forceManyBody<Node>().strength((node) => -30 - node.radius * 4))
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

  simulation.force('link', forceLink<Node, SimulationLinkDatum<Node>>(links).distance(24).strength(0.7));
  // Подогреваем: новые узлы должны разойтись, а не остаться в точке рождения.
  simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  post(simulation.alpha());
};
