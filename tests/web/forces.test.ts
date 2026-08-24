import { describe, it, expect } from 'vitest';
import {
  forceCones,
  forceFolderCohesion,
  forceGroupRepel,
  type ConeState,
  type FolderState,
  type MutableNode,
} from '../../web/layout/forces.js';

/**
 * Силы проверяются без d3 и без Worker: интерфейс силы в d3 — это функция от
 * alpha с `initialize`, и больше ничего. Узлы — обычные объекты.
 */
function state(parent: number[], footprint: number[], leaves: number[], area: number[]): FolderState {
  return {
    active: Uint8Array.from(parent.map(() => 1)),
    parent: Uint32Array.from(parent),
    footprint: Float32Array.from(footprint),
    leaves: Uint32Array.from(leaves),
    area: Float64Array.from(area),
    cohesion: 0.5,
    repel: 1,
    gap: 0,
  };
}

const node = (id: number, x: number, y = 0): MutableNode => ({ id, x, y, vx: 0, vy: 0 });

describe('forceFolderCohesion', () => {
  it('до инициализации состава ничего не делает', () => {
    const force = forceFolderCohesion(state([0, 0], [10, 10], [1, 1], [1, 1]));
    expect(() => force(1)).not.toThrow();
  });

  it('возвращает сбежавший узел и не трогает оставшихся внутри', () => {
    // Корень → папка(1) со следом 50 → двадцать файлов рядом с ней и один
    // сбежавший. Группа должна быть компактной: центр масс считается по её
    // членам, и один беглец на два узла увёл бы центр за собой, после чего
    // «внутренний» узел тоже оказался бы снаружи. Это не дефект силы, а
    // свойство центра масс, и фикстура обязана его учитывать.
    const parent = [0, 0];
    const footprint = [500, 50];
    const leaves = [21, 21];
    const area = [1, 1];
    const nodes = [node(0, 0), node(1, 0)];
    for (let i = 0; i < 20; i++) {
      parent.push(1);
      footprint.push(1);
      leaves.push(1);
      area.push(1);
      nodes.push(node(2 + i, i % 2 === 0 ? 10 : -10));
    }
    parent.push(1);
    footprint.push(1);
    leaves.push(1);
    area.push(1);
    const runaway = node(parent.length - 1, 400);
    nodes.push(runaway);

    const force = forceFolderCohesion(state(parent, footprint, leaves, area));
    force.initialize(nodes);
    force(1);

    expect(nodes[2]!.vx).toBe(0);
    expect(runaway.vx!).toBeLessThan(0);
  });

  it('нулевая сборка отключает силу целиком', () => {
    const folders = state([0, 0, 1], [500, 50, 1], [1, 1, 1], [1, 1, 1]);
    folders.cohesion = 0;
    const nodes = [node(0, 0), node(1, 0), node(2, 400)];
    const force = forceFolderCohesion(folders);
    force.initialize(nodes);
    force(1);
    expect(nodes[2]!.vx).toBe(0);
  });

  it('узел, ушедший из маски, не тянет центр масс своей папки', () => {
    // Позиция ушедшего узла остаётся в хранилище; на живых она влиять не должна.
    const folders = state([0, 0, 1, 1], [500, 50, 1, 1], [2, 2, 1, 1], [1, 1, 1, 1]);
    const nodes = [node(0, 0), node(1, 0), node(2, 10), node(3, 100000)];
    folders.active[3] = 0;
    const force = forceFolderCohesion(folders);
    force.initialize(nodes);
    force(1);
    expect(nodes[2]!.vx).toBe(0);
  });

  it('alpha масштабирует силу: на остывшей симуляции она затихает', () => {
    const build = (alpha: number) => {
      const folders = state([0, 0, 1], [500, 50, 1], [1, 1, 1], [1, 1, 1]);
      const nodes = [node(0, 0), node(1, 0), node(2, 400)];
      const force = forceFolderCohesion(folders);
      force.initialize(nodes);
      force(alpha);
      return Math.abs(nodes[2]!.vx!);
    };
    expect(build(0.1)).toBeLessThan(build(1));
  });
});

describe('forceGroupRepel', () => {
  /** Корень с двумя папками-сиблингами, у каждой по файлу. */
  const siblings = () => state([0, 0, 0, 1, 2], [900, 60, 60, 1, 1], [10, 5, 5, 1, 1], [1, 1, 1, 1, 1]);

  it('разводит налезшие папки вместе с их содержимым', () => {
    const folders = siblings();
    const nodes = [node(0, 0), node(1, -20), node(2, 20), node(3, -25), node(4, 25)];
    const force = forceGroupRepel(folders);
    force.initialize(nodes);
    force(1);

    expect(nodes[1]!.vx!).toBeLessThan(0);
    expect(nodes[2]!.vx!).toBeGreaterThan(0);
    // Смещение группы обязано достаться и файлам, а не только самим папкам.
    expect(nodes[3]!.vx!).toBeLessThan(0);
    expect(nodes[4]!.vx!).toBeGreaterThan(0);
  });

  it('молчит, когда папки уже разошлись', () => {
    const folders = siblings();
    const nodes = [node(0, 0), node(1, -500), node(2, 500), node(3, -505), node(4, 505)];
    const force = forceGroupRepel(folders);
    force.initialize(nodes);
    force(1);
    for (const n of nodes) expect(n.vx).toBe(0);
  });

  it('нулевое расталкивание отключает силу целиком', () => {
    const folders = siblings();
    folders.repel = 0;
    const nodes = [node(0, 0), node(1, -20), node(2, 20), node(3, -25), node(4, 25)];
    const force = forceGroupRepel(folders);
    force.initialize(nodes);
    force(1);
    for (const n of nodes) expect(n.vx).toBe(0);
  });

  it('мелкие папки в расталкивании не участвуют', () => {
    const folders = siblings();
    folders.leaves = Uint32Array.from([10, 1, 1, 1, 1]);
    const nodes = [node(0, 0), node(1, -20), node(2, 20), node(3, -25), node(4, 25)];
    const force = forceGroupRepel(folders);
    force.initialize(nodes);
    force(1);
    for (const n of nodes) expect(n.vx).toBe(0);
  });

  it('повторная инициализация состава не оставляет хвостов от прежнего', () => {
    const folders = siblings();
    const force = forceGroupRepel(folders);
    force.initialize([node(0, 0), node(1, -20), node(2, 20), node(3, -25), node(4, 25)]);
    force(1);

    const fresh = [node(0, 0), node(1, -500), node(2, 500)];
    force.initialize(fresh);
    force(1);
    for (const n of fresh) expect(n.vx).toBe(0);
  });

  it('две одинаковые сцены дают одинаковый результат', () => {
    const run = () => {
      const folders = siblings();
      const nodes = [node(0, 0), node(1, 0), node(2, 0), node(3, 0), node(4, 0)];
      const force = forceGroupRepel(folders);
      force.initialize(nodes);
      force(1);
      return nodes.map((n) => [n.vx, n.vy]);
    };
    expect(run()).toEqual(run());
  });
});
