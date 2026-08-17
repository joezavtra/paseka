import { describe, it, expect } from 'vitest';
import { bucketActivity, bucketCountForWidth } from '../../web/ui/histogram.js';

/** Смещения событий по коммитам (CSR): по n изменений в каждом коммите. */
function offsets(changesPerCommit: number[]): Uint32Array {
  const out = [0];
  for (const n of changesPerCommit) out.push(out[out.length - 1]! + n);
  return Uint32Array.from(out);
}

describe('bucketActivity', () => {
  it('раскладывает активность по индексу коммита, а не по времени', () => {
    // Четыре коммита по одному изменению — четыре корзины по единице.
    const counts = bucketActivity(offsets([1, 1, 1, 1]), 4);
    expect([...counts]).toEqual([1, 1, 1, 1]);
  });

  it('высота корзины — число изменений файлов, а не число коммитов', () => {
    // Коммиты равномерны по индексу, но объём изменений у них разный:
    // именно объём и есть активность, плотность коммитов бесполезна.
    const counts = bucketActivity(offsets([1, 1, 40, 1]), 4);
    expect([...counts]).toEqual([1, 1, 40, 1]);
  });

  it('суммирует изменения всех коммитов корзины', () => {
    const counts = bucketActivity(offsets([1, 2, 3, 4, 5, 6]), 3);
    expect([...counts]).toEqual([3, 7, 11]);
  });

  it('кладёт крайний правый коммит в последнюю корзину, а не за неё', () => {
    // 5 коммитов на 4 корзины: хвост не должен потеряться при делении.
    const counts = bucketActivity(offsets([1, 1, 1, 1, 7]), 4);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(11);
    expect(counts[3]).toBeGreaterThanOrEqual(7);
  });

  it('всплеск изменений виден в той же доле дорожки, где стоит его коммит', () => {
    // Всплеск — в коммитах 40..44 из 100, то есть во второй трети слайдера.
    const perCommit = new Array(100).fill(1);
    for (let i = 40; i < 45; i++) perCommit[i] = 50;
    const counts = bucketActivity(offsets(perCommit), 10);
    let peak = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[peak]!) peak = i;
    expect(peak).toBe(4); // корзина 4 из 10 — коммиты 40..49
  });

  it('переживает пустую историю', () => {
    expect([...bucketActivity(Uint32Array.from([0]), 4)]).toEqual([0, 0, 0, 0]);
    expect([...bucketActivity(new Uint32Array(0), 4)]).toEqual([0, 0, 0, 0]);
  });

  it('переживает историю из одного коммита', () => {
    const counts = bucketActivity(offsets([3]), 4);
    expect([...counts].reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('не бросает на отрицательном числе корзин, а возвращает пустой массив', () => {
    expect(() => bucketActivity(offsets([1, 2, 3]), -1)).not.toThrow();
    expect([...bucketActivity(offsets([1, 2, 3]), -1)]).toEqual([]);
  });

  it('не бросает на нецелом числе корзин', () => {
    expect(() => bucketActivity(offsets([1, 2, 3]), 4.5)).not.toThrow();
    expect([...bucketActivity(offsets([1, 2, 3]), 4.5)]).toEqual([]);
  });
});

describe('bucketCountForWidth', () => {
  it('на узкой дорожке корзин меньше, чем на широкой', () => {
    expect(bucketCountForWidth(320)).toBeLessThan(bucketCountForWidth(1400));
  });

  it('держится в пределах, при которых расчёт и отрисовка осмысленны', () => {
    for (const width of [0, -10, Number.NaN, 1, 40, 320, 1400, 100_000]) {
      const buckets = bucketCountForWidth(width);
      expect(Number.isInteger(buckets)).toBe(true);
      expect(buckets).toBeGreaterThanOrEqual(1);
      expect(buckets).toBeLessThanOrEqual(1024);
    }
  });

  it('на реальной ширине даёт столбик шире пикселя', () => {
    for (const width of [320, 700, 1400]) {
      expect(width / bucketCountForWidth(width)).toBeGreaterThanOrEqual(3);
    }
  });
});
