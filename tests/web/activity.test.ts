import { describe, it, expect } from 'vitest';
import { deriveActivity, type ActivityScene } from '../../web/render/activity.js';
import { RecentEvents } from '../../web/time/recent.js';

/** Сцена из n узлов: все живы, узел i стоит в (i * 10, i), каждый представляет сам себя. */
function sceneOf(n: number): ActivityScene {
  const positions = new Float32Array(n * 2);
  const representative = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    positions[i * 2] = i * 10;
    positions[i * 2 + 1] = i;
    representative[i] = i;
  }
  return { active: new Uint8Array(n).fill(1), positions, representative };
}

describe('deriveActivity', () => {
  it('на пустом буфере не даёт ни вспышек, ни лучей, ни целей', () => {
    const frame = deriveActivity(new RecentEvents(8, 1000, 4), sceneOf(4), 0, 8);
    expect(frame).toEqual({ flashes: [], beams: [], targets: [] });
  });

  it('заводит вспышку, луч и цель на одно событие', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(2, 1, 0);

    const frame = deriveActivity(recent, sceneOf(4), 0, 8);

    expect(frame.flashes).toEqual([{ path: 2, strength: 1 }]);
    expect(frame.beams).toEqual([{ author: 1, toX: 20, toY: 2, strength: 1 }]);
    expect(frame.targets).toEqual([{ author: 1, x: 20, y: 2 }]);
  });

  it('разрешает конец луча в координаты узла, а не оставляет идентификатор', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(3, 0, 0);
    const scene = sceneOf(4);
    scene.positions[6] = -77;
    scene.positions[7] = 55;

    const frame = deriveActivity(recent, scene, 0, 8);

    expect(frame.beams[0]!.toX).toBe(-77);
    expect(frame.beams[0]!.toY).toBe(55);
  });

  it('молчит про мёртвый путь: ни вспышки, ни луча, ни автора', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(1, 0, 0);
    const scene = sceneOf(4);
    scene.active[1] = 0;

    const frame = deriveActivity(recent, scene, 0, 8);

    expect(frame.flashes).toEqual([]);
    expect(frame.beams).toEqual([]);
    expect(frame.targets).toEqual([]);
  });

  it('считает автора видимым только по живым путям', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(1, 0, 0); // путь умрёт
    recent.push(2, 1, 0);
    const scene = sceneOf(4);
    scene.active[1] = 0;

    // Автор 0 в буфере есть, но на экране его нет — счётчик обязан
    // совпадать с картинкой, иначе строка состояния врёт.
    expect(deriveActivity(recent, scene, 0, 8).targets.map((t) => t.author)).toEqual([1]);
  });

  it('ставит цель в центроид задетых автором файлов', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(0, 2, 0); // (0, 0)
    recent.push(2, 2, 0); // (20, 2)

    const frame = deriveActivity(recent, sceneOf(4), 0, 8);

    expect(frame.targets).toHaveLength(1);
    expect(frame.targets[0]!.x).toBeCloseTo(10, 5);
    expect(frame.targets[0]!.y).toBeCloseTo(1, 5);
  });

  it('в центроид входят только живые пути', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(0, 2, 0);
    recent.push(2, 2, 0);
    const scene = sceneOf(4);
    scene.active[2] = 0;

    const frame = deriveActivity(recent, scene, 0, 8);

    expect(frame.targets[0]!.x).toBeCloseTo(0, 5);
    expect(frame.targets[0]!.y).toBeCloseTo(0, 5);
  });

  it('на один путь даёт одну вспышку — самую сильную', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(1, 0, 0); // к моменту 500 сила 0.5
    recent.push(1, 1, 400); // к моменту 500 сила 0.9

    const frame = deriveActivity(recent, sceneOf(4), 500, 8);

    expect(frame.flashes).toHaveLength(1);
    expect(frame.flashes[0]!.path).toBe(1);
    expect(frame.flashes[0]!.strength).toBeCloseTo(0.9, 5);
  });

  it('порядок вспышек не зависит от того, какое событие пришло раньше', () => {
    const early = new RecentEvents(8, 1000, 4);
    early.push(1, 0, 400);
    early.push(1, 1, 0);

    const frame = deriveActivity(early, sceneOf(4), 500, 8);

    expect(frame.flashes).toHaveLength(1);
    expect(frame.flashes[0]!.strength).toBeCloseTo(0.9, 5);
  });

  it('на каждое событие даёт свой луч, даже если путь один', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(1, 0, 0);
    recent.push(1, 1, 0);

    const frame = deriveActivity(recent, sceneOf(4), 0, 8);

    expect(frame.beams.map((b) => b.author)).toEqual([0, 1]);
  });

  it('гасит луч и вспышку вместе с возрастом события', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(1, 0, 0);

    expect(deriveActivity(recent, sceneOf(4), 750, 8).beams[0]!.strength).toBeCloseTo(0.25, 5);
    expect(deriveActivity(recent, sceneOf(4), 1000, 8).beams).toEqual([]);
    expect(deriveActivity(recent, sceneOf(4), 1000, 8).targets).toEqual([]);
  });

  it('не заводит лучей сверх потолка, но цели и вспышки считает по всем событиям', () => {
    const recent = new RecentEvents(16, 1000, 4);
    for (let path = 0; path < 6; path++) recent.push(path, path % 2, 0);

    const frame = deriveActivity(recent, sceneOf(8), 0, 2);

    expect(frame.beams).toHaveLength(2);
    expect(frame.flashes).toHaveLength(6);
    expect(frame.targets.map((t) => t.author)).toEqual([0, 1]);
  });

  it('отдаёт цели по возрастанию идентификатора автора', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(0, 3, 0);
    recent.push(1, 1, 0);
    recent.push(2, 2, 0);

    const frame = deriveActivity(recent, sceneOf(4), 0, 8);

    expect(frame.targets.map((t) => t.author)).toEqual([1, 2, 3]);
  });

  it('переживает нечисловой момент времени', () => {
    const recent = new RecentEvents(8, 1000, 4);
    recent.push(1, 0, 0);
    expect(deriveActivity(recent, sceneOf(4), Number.NaN, 8)).toEqual({
      flashes: [],
      beams: [],
      targets: [],
    });
  });

  it('луч свёрнутой папки бьёт в неё, а не в спрятанный внутри файл', () => {
    const recent = new RecentEvents(8, 1000, 2);
    recent.push(3, 0, 0); // файл внутри свёрнутой папки
    const scene = {
      active: Uint8Array.from([1, 1, 0, 0]),
      positions: Float32Array.from([0, 0, 10, 10, 20, 20, 30, 30]),
      // Путь 3 представлен путём 1: папка свёрнута.
      representative: Int32Array.from([0, 1, 1, 1]),
    };

    const frame = deriveActivity(recent, scene, 0, 8);
    expect(frame.beams).toHaveLength(1);
    expect(frame.beams[0]!.toX).toBe(10);
    expect(frame.beams[0]!.toY).toBe(10);
    expect(frame.flashes[0]!.path).toBe(1);
    expect(frame.targets[0]!.x).toBe(10);
  });

  it('событие скрытого пути не даёт ни луча, ни вспышки, даже если сам путь жив', () => {
    const recent = new RecentEvents(8, 1000, 2);
    recent.push(2, 0, 0);
    const frame = deriveActivity(
      recent,
      {
        // Путь 2 сам по себе жив (active[2] = 1) — старая проверка «жив ли
        // сам путь», без представителя, здесь ошиблась бы и дала событие.
        // Скрывает его именно представитель HIDDEN.
        active: Uint8Array.from([1, 1, 1]),
        positions: Float32Array.from([0, 0, 10, 10, 20, 20]),
        representative: Int32Array.from([0, 1, -1]),
      },
      0,
      8,
    );
    expect(frame.beams).toHaveLength(0);
    expect(frame.flashes).toHaveLength(0);
    expect(frame.targets).toHaveLength(0);
  });

  it('событие пути с мёртвым представителем не даёт ни луча, ни вспышки', () => {
    const recent = new RecentEvents(8, 1000, 2);
    recent.push(2, 0, 0);
    const frame = deriveActivity(
      recent,
      {
        // Путь 2 представлен путём 1, но сам представитель не рисуется
        // (active[1] = 0) — например, свернулся между событием и кадром.
        active: Uint8Array.from([1, 0, 1]),
        positions: Float32Array.from([0, 0, 10, 10, 20, 20]),
        representative: Int32Array.from([0, 1, 1]),
      },
      0,
      8,
    );
    expect(frame.beams).toHaveLength(0);
    expect(frame.flashes).toHaveLength(0);
    expect(frame.targets).toHaveLength(0);
  });
});
