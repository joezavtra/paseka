import { describe, it, expect } from 'vitest';
import { buildActiveLinks, radiusFor } from '../../web/layout/graph.js';

describe('buildActiveLinks', () => {
  it('строит рёбра родитель → потомок в идентификаторах путей', () => {
    const active = Uint8Array.from([1, 1, 1]);
    const parent = Uint32Array.from([0, 0, 1]);
    const links = buildActiveLinks(active, parent);
    expect([...links.source]).toEqual([0, 1]);
    expect([...links.target]).toEqual([1, 2]);
  });

  it('не создаёт петлю у корня', () => {
    const links = buildActiveLinks(Uint8Array.from([1]), Uint32Array.from([0]));
    expect(links.source.length).toBe(0);
  });

  it('пропускает ребро, если родитель мёртв', () => {
    const links = buildActiveLinks(Uint8Array.from([1, 0, 1]), Uint32Array.from([0, 0, 1]));
    expect(links.source.length).toBe(0);
  });

  it('пропускает мёртвые узлы', () => {
    const links = buildActiveLinks(Uint8Array.from([1, 1, 0]), Uint32Array.from([0, 0, 1]));
    expect([...links.source]).toEqual([0]);
    expect([...links.target]).toEqual([1]);
  });

  it('не падает на пустом живом множестве', () => {
    const links = buildActiveLinks(new Uint8Array(4), Uint32Array.from([0, 0, 1, 2]));
    expect(links.source.length).toBe(0);
    expect(links.target.length).toBe(0);
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

  it('клэмпит отрицательное число строк', () => {
    expect(radiusFor(-50, false)).toBeCloseTo(2.5, 1);
  });
});
