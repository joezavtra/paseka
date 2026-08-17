import { describe, it, expect } from 'vitest';
import { beamControl, flashRadius } from '../../web/render/scene.js';

describe('flashRadius', () => {
  it('без вспышки оставляет радиус как есть', () => {
    expect(flashRadius(10, 0)).toBe(10);
  });

  it('на полной вспышке заметно увеличивает узел', () => {
    expect(flashRadius(10, 1)).toBeGreaterThan(13);
    expect(flashRadius(10, 1)).toBeLessThan(20);
  });

  it('растёт монотонно по силе вспышки', () => {
    expect(flashRadius(10, 0.5)).toBeGreaterThan(flashRadius(10, 0.2));
  });

  it('не даёт отрицательного радиуса на мусорном входе', () => {
    expect(flashRadius(10, -5)).toBeGreaterThanOrEqual(0);
    expect(flashRadius(-3, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe('beamControl', () => {
  it('уводит контрольную точку в сторону от прямой', () => {
    const [cx, cy] = beamControl(0, 0, 100, 0);
    expect(cx).toBeCloseTo(50, 3);
    expect(Math.abs(cy)).toBeGreaterThan(1);
  });

  it('на нулевой длине не даёт нечисловых координат', () => {
    const [cx, cy] = beamControl(7, 7, 7, 7);
    expect(Number.isFinite(cx)).toBe(true);
    expect(Number.isFinite(cy)).toBe(true);
  });

  it('изгиб растёт вместе с длиной луча', () => {
    const short = beamControl(0, 0, 20, 0)[1];
    const long = beamControl(0, 0, 400, 0)[1];
    expect(Math.abs(long)).toBeGreaterThan(Math.abs(short));
  });
});
