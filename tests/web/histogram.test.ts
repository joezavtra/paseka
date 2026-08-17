import { describe, it, expect } from 'vitest';
import { bucketCommits } from '../../web/ui/histogram.js';

describe('bucketCommits', () => {
  it('раскладывает равномерные времена по корзинам', () => {
    const counts = bucketCommits(Uint32Array.from([0, 25, 50, 75, 100]), 5);
    expect(counts.length).toBe(5);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts[0]).toBe(1);
    expect(counts[4]).toBe(1);
  });

  it('не зависит от порядка времён', () => {
    // Даты автора немонотонны после rebase: раскладка идёт по значению.
    const sorted = bucketCommits(Uint32Array.from([10, 20, 30, 40]), 4);
    const shuffled = bucketCommits(Uint32Array.from([30, 10, 40, 20]), 4);
    expect([...shuffled]).toEqual([...sorted]);
  });

  it('кладёт последнее значение в последнюю корзину, а не за неё', () => {
    const counts = bucketCommits(Uint32Array.from([0, 100]), 4);
    expect(counts[3]).toBe(1);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('переживает одинаковые времена', () => {
    const counts = bucketCommits(Uint32Array.from([7, 7, 7]), 3);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('переживает пустую историю', () => {
    expect([...bucketCommits(new Uint32Array(0), 4)]).toEqual([0, 0, 0, 0]);
  });

  it('концентрирует всплеск активности в одной корзине', () => {
    const ts = Uint32Array.from([0, 100, 101, 102, 103, 104, 200]);
    const counts = bucketCommits(ts, 4);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(5);
  });
});
