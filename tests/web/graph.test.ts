import { describe, it, expect } from 'vitest';
import { buildLayoutGraph, radiusFor } from '../../web/layout/graph.js';

describe('buildLayoutGraph', () => {
  it('берёт только живые узлы', () => {
    const alive = Uint8Array.from([1, 1, 0, 1]);
    const parent = Uint32Array.from([0, 0, 1, 1]);
    const graph = buildLayoutGraph(alive, parent);
    expect([...graph.nodeIds]).toEqual([0, 1, 3]);
  });

  it('строит рёбра родитель → потомок в локальных индексах', () => {
    const alive = Uint8Array.from([1, 1, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const graph = buildLayoutGraph(alive, parent);
    expect([...graph.linkSource]).toEqual([0, 1]);
    expect([...graph.linkTarget]).toEqual([1, 2]);
  });

  it('не создаёт петлю у корня', () => {
    const graph = buildLayoutGraph(Uint8Array.from([1]), Uint32Array.from([0]));
    expect(graph.linkSource).toHaveLength(0);
  });

  it('пропускает ребро, если родитель мёртв', () => {
    const alive = Uint8Array.from([1, 0, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const graph = buildLayoutGraph(alive, parent);
    expect(graph.linkSource).toHaveLength(0);
  });
});

describe('radiusFor', () => {
  it('растёт как корень из числа строк', () => {
    expect(radiusFor(0, false)).toBeCloseTo(2.5, 1);
    expect(radiusFor(100, false)).toBeGreaterThan(radiusFor(25, false));
    expect(radiusFor(1_000_000, false)).toBeLessThanOrEqual(40);
  });

  it('делает директории мелкими и одинаковыми', () => {
    expect(radiusFor(0, true)).toBe(radiusFor(9999, true));
  });
});
