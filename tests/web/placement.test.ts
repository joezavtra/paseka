import { describe, it, expect } from 'vitest';
import { applyPositions, createPlacementTracker, recordEpoch } from '../../web/layout/placement.js';

describe('placement', () => {
  it('переносит позиции и поднимает placed только для путей, живых на момент этой эпохи', () => {
    const tracker = createPlacementTracker();
    recordEpoch(tracker, 1, Uint8Array.from([1, 1, 0]));

    const positions = new Float32Array(6);
    const placed = new Uint8Array(3);
    const incoming = Float32Array.from([10, 20, 30, 40, 999, 999]);

    applyPositions(tracker, 1, incoming, positions, placed);

    expect([...positions.slice(0, 4)]).toEqual([10, 20, 30, 40]);
    expect(placed[0]).toBe(1);
    expect(placed[1]).toBe(1);
    // Путь 2 не входил в маску этой эпохи: ни позиция, ни placed не трогаются,
    // даже если во входящем массиве для него что-то есть.
    expect(placed[2]).toBe(0);
    expect(positions[4]).toBe(0);
    expect(positions[5]).toBe(0);
  });

  it(
    'РЕГРЕССИЯ (ревью): путь, родившийся уже после отправки эпохи, не помечается ' +
      'размещённым устаревшим тиком — воспроизводит сценарий из находки A',
    () => {
      // Путь 1 рождается в главном потоке ПОСЛЕ отправки эпохи 1: эпоха 1 знает
      // только про путь 0. Ответ воркера, эхующий эпоху 1, пришёл уже после
      // того, как главный поток отправил эпоху 2 (путь 1 родился), но сам
      // относится к состоянию ДО рождения пути 1 — ровно гонка из брифа
      // ревьюера (тик, отправленный воркером до применения им эпохи 2).
      const tracker = createPlacementTracker();
      recordEpoch(tracker, 1, Uint8Array.from([1, 0]));
      recordEpoch(tracker, 2, Uint8Array.from([1, 1]));

      const positions = new Float32Array(4);
      const placed = new Uint8Array(2);
      // Путь 1 унаследовал позицию родителя синхронно в главном потоке — уже
      // стоит на месте до всякого ответа воркера.
      positions[2] = 55;
      positions[3] = 66;
      placed[1] = 1;

      // Устаревший ответ воркера: эхует эпоху 1, знает только про путь 0.
      // NodeStore.positions() у него залил бы позицию пути 1 нулём — этого
      // тихого нуля во входящем массиве достаточно, чтобы проверить, что он
      // не просочился в scene.positions.
      const staleIncoming = Float32Array.from([100, 200, 0, 0]);
      applyPositions(tracker, 1, staleIncoming, positions, placed);

      // Путь 0 — данные эпохи 1 применились как обычно.
      expect(positions[0]).toBe(100);
      expect(positions[1]).toBe(200);
      // Путь 1 не входил в маску эпохи 1: унаследованная позиция и флаг
      // placed остались как были, устаревший тик их не тронул.
      expect(positions[2]).toBe(55);
      expect(positions[3]).toBe(66);
      expect(placed[1]).toBe(1);

      // Наивная альтернатива (как было в предыдущей правке до этого круга
      // ревью) выглядела бы так: "любой ответ воркера поднимает placed для
      // всех путей, активных ПРЯМО СЕЙЧАС в главном потоке, и целиком
      // заменяет scene.positions присланным массивом". Подставим её здесь же,
      // чтобы явно показать, что она даёт другой (неверный) результат на тех
      // же входных данных — то есть тест действительно различает поведения,
      // а не проверяет тривиальность.
      const naivePositions = Float32Array.from([0, 0, 55, 66]);
      const naivePlaced = Uint8Array.from([0, 1]);
      const currentMainThreadActive = Uint8Array.from([1, 1]); // главный поток уже знает про путь 1
      naivePositions.set(staleIncoming); // scene.positions = event.data.positions — целиком
      for (let path = 0; path < currentMainThreadActive.length; path++) {
        if (currentMainThreadActive[path] === 1) naivePlaced[path] = 1;
      }
      // Наивный путь ошибочно решает, что путь 1 размещён, и стирает его
      // унаследованную позицию нулём устаревшего тика — ровно баг из находки.
      expect(naivePlaced[1]).toBe(1);
      expect(naivePositions[2]).toBe(0);
      expect(naivePositions[3]).toBe(0);
    },
  );

  it('следующая, более новая эпоха размещает путь, который предыдущая эпоха ещё не знала', () => {
    const tracker = createPlacementTracker();
    recordEpoch(tracker, 1, Uint8Array.from([1, 0]));
    recordEpoch(tracker, 2, Uint8Array.from([1, 1]));

    const positions = new Float32Array(4);
    const placed = new Uint8Array(2);

    applyPositions(tracker, 1, Float32Array.from([100, 200, 0, 0]), positions, placed);
    applyPositions(tracker, 2, Float32Array.from([101, 201, 5, 6]), positions, placed);

    expect(positions[2]).toBe(5);
    expect(positions[3]).toBe(6);
    expect(placed[1]).toBe(1);
  });

  it('повторный тик той же эпохи продолжает применяться (эпоха не удаляется сама на себя)', () => {
    const tracker = createPlacementTracker();
    recordEpoch(tracker, 1, Uint8Array.from([1]));

    const positions = new Float32Array(2);
    const placed = new Uint8Array(1);

    applyPositions(tracker, 1, Float32Array.from([1, 2]), positions, placed);
    applyPositions(tracker, 1, Float32Array.from([3, 4]), positions, placed);

    expect(positions[0]).toBe(3);
    expect(positions[1]).toBe(4);
    expect(placed[0]).toBe(1);
  });

  it('старые эпохи вычищаются: память не растёт бесконечно', () => {
    const tracker = createPlacementTracker();
    recordEpoch(tracker, 1, Uint8Array.from([1]));
    recordEpoch(tracker, 2, Uint8Array.from([1]));
    recordEpoch(tracker, 3, Uint8Array.from([1]));

    applyPositions(tracker, 3, Float32Array.from([1, 1]), new Float32Array(2), new Uint8Array(1));

    expect(tracker.pending.has(1)).toBe(false);
    expect(tracker.pending.has(2)).toBe(false);
    expect(tracker.pending.has(3)).toBe(true);
  });

  it('неизвестная эпоха молча ничего не делает', () => {
    const tracker = createPlacementTracker();
    const positions = Float32Array.from([7, 8]);
    const placed = Uint8Array.from([1]);

    expect(() =>
      applyPositions(tracker, 99, Float32Array.from([0, 0]), positions, placed),
    ).not.toThrow();
    expect([...positions]).toEqual([7, 8]);
    expect(placed[0]).toBe(1);
  });
});
