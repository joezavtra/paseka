import { describe, it, expect } from 'vitest';
import { NodeStore, type StoreUpdate } from '../../web/layout/node-store.js';

function update(partial: Partial<StoreUpdate> & { active: Uint8Array }): StoreUpdate {
  return {
    added: new Uint32Array(0),
    radiusIds: new Uint32Array(0),
    radiusValues: new Float32Array(0),
    ...partial,
  };
}

function distance(a: Float32Array, ia: number, b: Float32Array, ib: number): number {
  const dx = a[ia * 2]! - b[ib * 2]!;
  const dy = a[ia * 2 + 1]! - b[ib * 2 + 1]!;
  return Math.hypot(dx, dy);
}

describe('NodeStore', () => {
  it('возвращает ушедший узел на прежнее место', () => {
    const parent = Uint32Array.from([0, 0]);
    const store = new NodeStore(2, parent, 7);

    const first = store.applyUpdate(
      update({ active: Uint8Array.from([1, 1]), added: Uint32Array.from([0, 1]) }),
    );
    const bornX = first.positions[2]!;
    const bornY = first.positions[3]!;
    expect(bornX !== 0 || bornY !== 0).toBe(true); // родился не в нуле по случайности

    store.applyUpdate(update({ active: Uint8Array.from([1, 0]) })); // путь 1 умер
    const revived = store.applyUpdate(
      update({ active: Uint8Array.from([1, 1]), added: Uint32Array.from([1]) }),
    );

    expect(revived.positions[2]).toBe(bornX);
    expect(revived.positions[3]).toBe(bornY);
  });

  it('рождает узел рядом с родителем независимо от порядка в added', () => {
    // path 0 — корень (без родителя), path 1 — папка, path 2 — файл в ней.
    const parent = Uint32Array.from([0, 0, 1]);

    const forward = new NodeStore(3, parent, 11);
    const forwardState = forward.applyUpdate(
      update({ active: Uint8Array.from([1, 1, 1]), added: Uint32Array.from([0, 1, 2]) }),
    );

    // Движок времени отдаёт обратный порядок: сначала лист, потом предки.
    const backward = new NodeStore(3, parent, 11);
    const backwardState = backward.applyUpdate(
      update({ active: Uint8Array.from([1, 1, 1]), added: Uint32Array.from([2, 1, 0]) }),
    );

    for (const state of [forwardState, backwardState]) {
      const gap = distance(state.positions, 1, state.positions, 2);
      expect(gap).toBeLessThanOrEqual(20); // 8 + 12 максимум по формуле jitter
      expect(gap).toBeGreaterThan(0);
    }
  });

  it('собирает цепочку из нескольких новых каталогов подряд', () => {
    // 0 — корень, 1 — src, 2 — src/deep, 3 — src/deep/nest, 4 — .../a.ts
    const parent = Uint32Array.from([0, 0, 1, 2, 3]);
    const store = new NodeStore(5, parent, 3);

    // Ровно так, как отдаёт движок времени при подъёме по дереву: лист первым.
    const state = store.applyUpdate(
      update({ active: Uint8Array.from([1, 1, 1, 1, 1]), added: Uint32Array.from([4, 3, 2, 1, 0]) }),
    );

    expect(distance(state.positions, 0, state.positions, 1)).toBeLessThanOrEqual(20);
    expect(distance(state.positions, 1, state.positions, 2)).toBeLessThanOrEqual(20);
    expect(distance(state.positions, 2, state.positions, 3)).toBeLessThanOrEqual(20);
    expect(distance(state.positions, 3, state.positions, 4)).toBeLessThanOrEqual(20);
  });

  it('маска хранилища совпадает с авторитетной после серии обновлений', () => {
    const parent = Uint32Array.from([0, 0, 0, 2]);
    const store = new NodeStore(4, parent, 5);

    const masks = [
      Uint8Array.from([1, 1, 0, 0]),
      Uint8Array.from([1, 0, 1, 1]),
      Uint8Array.from([0, 0, 1, 0]),
      Uint8Array.from([1, 1, 1, 1]),
    ];
    let previousActive = new Uint8Array(4);
    for (const active of masks) {
      const added: number[] = [];
      for (let path = 0; path < active.length; path++) {
        if (active[path] === 1 && previousActive[path] === 0) added.push(path);
      }
      store.applyUpdate(update({ active, added: Uint32Array.from(added) }));
      expect([...store.aliveMask]).toEqual([...active]);
      previousActive = active;
    }
  });

  it('применяет радиусы к уже рождённым узлам', () => {
    const parent = Uint32Array.from([0]);
    const store = new NodeStore(1, parent, 1);
    store.applyUpdate(update({ active: Uint8Array.from([1]), added: Uint32Array.from([0]) }));

    const state = store.applyUpdate(
      update({
        active: Uint8Array.from([1]),
        radiusIds: Uint32Array.from([0]),
        radiusValues: Float32Array.from([17.5]),
      }),
    );

    expect(state.nodes[0]!.radius).toBe(17.5);
  });

  it('позиции имеют длину pathCount * 2, а мёртвые пути дают нули', () => {
    const parent = Uint32Array.from([0, 0, 0]);
    const store = new NodeStore(3, parent, 2);
    const state = store.applyUpdate(
      update({ active: Uint8Array.from([1, 0, 1]), added: Uint32Array.from([0, 2]) }),
    );

    expect(state.positions.length).toBe(6);
    expect(state.positions[2]).toBe(0); // путь 1 никогда не был жив
    expect(state.positions[3]).toBe(0);
  });
});
