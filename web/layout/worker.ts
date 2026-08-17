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
  index: number;
  x: number;
  y: number;
  radius: number;
}

let simulation: Simulation<Node, undefined> | null = null;
let nodes: Node[] = [];
let lastPost = 0;

function post(alpha: number): void {
  const positions = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    positions[i * 2] = nodes[i]!.x;
    positions[i * 2 + 1] = nodes[i]!.y;
  }
  const message: FromWorker = { type: 'positions', positions, alpha };
  (self as unknown as Worker).postMessage(message, [positions.buffer]);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type !== 'init') return;

  const rng = makeRng(message.seed);
  nodes = Array.from({ length: message.nodeCount }, (_, index) => ({
    index,
    // Стартуем кольцом, а не точкой: из точки d3-force расталкивает узлы долго.
    x: Math.cos(rng() * Math.PI * 2) * 400 * Math.sqrt(rng()),
    y: Math.sin(rng() * Math.PI * 2) * 400 * Math.sqrt(rng()),
    radius: message.radius[index] ?? 3,
  }));

  // d3-force принимает числовые source/target и сам заменяет их на узлы по индексу.
  const links: SimulationLinkDatum<Node>[] = Array.from(
    { length: message.linkSource.length },
    (_, i) => ({ source: message.linkSource[i]!, target: message.linkTarget[i]! }),
  );

  simulation?.stop();
  simulation = forceSimulation(nodes)
    .force('charge', forceManyBody<Node>().strength((node) => -30 - node.radius * 4))
    .force(
      'link',
      forceLink<Node, SimulationLinkDatum<Node>>(links).distance(24).strength(0.7),
    )
    .force('center', forceCenter(0, 0))
    .alphaDecay(0.015)
    .on('tick', () => {
      // Ограничиваем поток сообщений: рендер всё равно не успевает чаще ~30 Гц.
      const now = performance.now();
      if (now - lastPost < 33) return;
      lastPost = now;
      post(simulation!.alpha());
    })
    .on('end', () => post(0));
};
