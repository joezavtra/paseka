import { describe, it, expect } from 'vitest';
import { NOTHING, pickNode, type PickInput } from '../../web/render/pick.js';
import { makeRng } from '../../src/util/rng.js';

interface Node {
  x: number;
  y: number;
  r: number;
  drawn?: boolean;
}

function input(nodes: Node[]): PickInput {
  return {
    active: Uint8Array.from(nodes.map((n) => (n.drawn === false ? 0 : 1))),
    positions: Float32Array.from(nodes.flatMap((n) => [n.x, n.y])),
    radius: Float32Array.from(nodes.map((n) => n.r)),
  };
}

describe('pickNode', () => {
  it('выбирает узел, накрывающий точку', () => {
    const nodes = [{ x: 0, y: 0, r: 5 }];
    expect(pickNode(input(nodes), 3, 0, 0)).toBe(0);
    expect(pickNode(input(nodes), 6, 0, 0)).toBe(NOTHING);
  });

  it('из накрывающих выбирает нарисованный последним', () => {
    // Каталог (id 0) и лежащий на нём файл (id 1) в одной точке: отрисовка
    // идёт по возрастанию идентификатора, значит сверху файл — в него и целятся.
    const nodes = [
      { x: 0, y: 0, r: 30 },
      { x: 0, y: 0, r: 4 },
    ];
    expect(pickNode(input(nodes), 1, 0, 0)).toBe(1);
    // А за пределами файла остаётся каталог.
    expect(pickNode(input(nodes), 10, 0, 0)).toBe(0);
  });

  it('не выбирает нерисуемые узлы', () => {
    const nodes = [{ x: 0, y: 0, r: 5, drawn: false }];
    expect(pickNode(input(nodes), 0, 0, 10)).toBe(NOTHING);
  });

  it('допуск работает только при отсутствии прямого попадания', () => {
    const nodes = [
      { x: 0, y: 0, r: 20 }, // накрывает точку (5, 0)
      { x: 40, y: 0, r: 2 }, // рядом, но не накрывает
    ];
    // Прямое попадание сильнее близости: 1 ближе к допуску, но 0 накрывает.
    expect(pickNode(input(nodes), 5, 0, 100)).toBe(0);
  });

  it('в пределах допуска выбирает ближайший по зазору', () => {
    const nodes = [
      { x: 0, y: 0, r: 1 },
      { x: 10, y: 0, r: 1 },
    ];
    expect(pickNode(input(nodes), 8, 0, 5)).toBe(1);
    expect(pickNode(input(nodes), 3, 0, 5)).toBe(0);
    // За пределом допуска — ничего.
    expect(pickNode(input(nodes), 5, 0, 1)).toBe(NOTHING);
  });

  it('совпадает с перебором на случайных сценах', () => {
    const rng = makeRng(20260818);
    for (let round = 0; round < 2000; round++) {
      const count = 1 + Math.floor(rng() * 8);
      const nodes: Node[] = [];
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.round(rng() * 40) - 20,
          y: Math.round(rng() * 40) - 20,
          r: Math.round(rng() * 8),
          drawn: rng() > 0.2,
        });
      }
      const x = Math.round(rng() * 40) - 20;
      const y = Math.round(rng() * 40) - 20;
      const slack = Math.round(rng() * 6);
      expect(pickNode(input(nodes), x, y, slack)).toBe(oracle(nodes, x, y, slack));
    }
  });
});

/** Перебор по определению правила: медленно, зато очевидно. */
function oracle(nodes: Node[], x: number, y: number, slack: number): number {
  let covered = NOTHING;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.drawn === false) continue;
    if (Math.hypot(node.x - x, node.y - y) <= node.r) covered = i;
  }
  if (covered !== NOTHING) return covered;

  let best = NOTHING;
  let bestGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.drawn === false) continue;
    const gap = Math.hypot(node.x - x, node.y - y) - node.r;
    if (gap <= slack && gap <= bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}
