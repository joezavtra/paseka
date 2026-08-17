import { describe, it, expect } from 'vitest';
import { RecentEvents } from '../../web/time/recent.js';

/** Собирает всё, что буфер считает живым на момент now. */
function collect(buffer: RecentEvents, now: number) {
  const out: { path: number; author: number; strength: number }[] = [];
  buffer.forEach(now, (path, author, strength) => out.push({ path, author, strength }));
  return out;
}

describe('RecentEvents', () => {
  it('отдаёт свежее событие с полной силой', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    expect(collect(buffer, 0)).toEqual([{ path: 5, author: 1, strength: 1 }]);
  });

  it('гасит событие линейно к концу жизни', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    expect(collect(buffer, 250)[0]!.strength).toBeCloseTo(0.75, 5);
    expect(collect(buffer, 500)[0]!.strength).toBeCloseTo(0.5, 5);
  });

  it('забывает событие, когда его время вышло', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    expect(collect(buffer, 1000)).toEqual([]);
    expect(collect(buffer, 5000)).toEqual([]);
  });

  it('держит несколько событий одного пути', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(5, 1, 0);
    buffer.push(5, 2, 0);
    expect(collect(buffer, 0)).toHaveLength(2);
  });

  it('вытесняет самое старое при переполнении', () => {
    const buffer = new RecentEvents(2, 1000, 4);
    buffer.push(1, 0, 0);
    buffer.push(2, 0, 0);
    buffer.push(3, 0, 0);
    expect(collect(buffer, 0).map((e) => e.path)).toEqual([2, 3]);
  });

  it('очищается', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, 0, 0);
    buffer.clear();
    expect(collect(buffer, 0)).toEqual([]);
  });

  it('не портится от нечислового времени', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, 0, Number.NaN);
    buffer.push(2, 0, 0);
    // Событие с негодным временем просто не заводится, соседнее живёт.
    expect(collect(buffer, 0).map((e) => e.path)).toEqual([2]);
    expect(collect(buffer, Number.NaN)).toEqual([]);
  });

  it('игнорирует автора вне диапазона', () => {
    const buffer = new RecentEvents(8, 1000, 2);
    buffer.push(1, 99, 0);
    expect(collect(buffer, 0)).toEqual([]);
  });

  it('не заводит событие с нечисловым идентификатором автора', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, Number.NaN, 0);
    expect(collect(buffer, 0)).toEqual([]);
  });

  it('не заводит событие с отрицательным идентификатором автора', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(1, -1, 0);
    expect(collect(buffer, 0)).toEqual([]);
  });

  it('не заводит событие с нечисловым путём', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(Number.NaN, 0, 0);
    expect(collect(buffer, 0)).toEqual([]);
  });

  it('не заводит событие с отрицательным путём', () => {
    const buffer = new RecentEvents(8, 1000, 4);
    buffer.push(-1, 0, 0);
    expect(collect(buffer, 0)).toEqual([]);
  });
});
