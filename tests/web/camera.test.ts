import { describe, it, expect } from 'vitest';
import { Camera } from '../../web/render/camera.js';

describe('Camera', () => {
  it('переводит мир в экран и обратно без потерь', () => {
    const camera = new Camera();
    camera.scale = 2.5;
    camera.x = 100;
    camera.y = -40;
    const [sx, sy] = camera.toScreen(12, 34);
    const [wx, wy] = camera.toWorld(sx, sy);
    expect(wx).toBeCloseTo(12, 6);
    expect(wy).toBeCloseTo(34, 6);
  });

  it('удерживает точку под курсором при зуме', () => {
    const camera = new Camera();
    const before = camera.toWorld(300, 200);
    camera.zoomAt(300, 200, 1.7);
    const after = camera.toWorld(300, 200);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('не даёт зуму уйти за пределы разумного', () => {
    const camera = new Camera();
    for (let i = 0; i < 200; i++) camera.zoomAt(0, 0, 2);
    expect(camera.scale).toBeLessThanOrEqual(40);
    for (let i = 0; i < 400; i++) camera.zoomAt(0, 0, 0.5);
    expect(camera.scale).toBeGreaterThanOrEqual(0.01);
  });

  it('вписывает облако точек в вид', () => {
    const camera = new Camera();
    camera.fit(Float32Array.from([-100, -100, 100, 100]), 800, 600);
    const [ax, ay] = camera.toScreen(-100, -100);
    const [bx, by] = camera.toScreen(100, 100);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
    expect(bx).toBeLessThan(800);
    expect(by).toBeLessThan(600);
  });

  it('справляется с единственной точкой', () => {
    const camera = new Camera();
    camera.fit(Float32Array.from([5, 5]), 800, 600);
    expect(Number.isFinite(camera.scale)).toBe(true);
    expect(camera.scale).toBeGreaterThan(0);
  });
});

// Цвета переехали в tests/web/scene.test.ts вместе с переходом сцены на
// числовые индексы палитры.

describe('Camera.fitActive', () => {
  it('вписывает только активные узлы', () => {
    const camera = new Camera();
    // Мёртвый узел лежит далеко: если он попадёт в расчёт, масштаб рухнет.
    const positions = Float32Array.from([-10, -10, 10, 10, 100000, 100000]);
    const active = Uint8Array.from([1, 1, 0]);
    camera.fitActive(positions, active, 800, 600);

    const [ax, ay] = camera.toScreen(-10, -10);
    const [bx, by] = camera.toScreen(10, 10);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
    expect(bx).toBeLessThan(800);
    expect(by).toBeLessThan(600);
    expect(camera.scale).toBeGreaterThan(1);
  });

  it('не трогает камеру, если активных узлов нет, и сообщает об этом', () => {
    const camera = new Camera();
    const before = camera.scale;
    const fitted = camera.fitActive(Float32Array.from([1, 1]), Uint8Array.from([0]), 800, 600);
    expect(fitted).toBe(false);
    expect(camera.scale).toBe(before);
  });

  it('сообщает об успешном вписывании', () => {
    const camera = new Camera();
    const fitted = camera.fitActive(
      Float32Array.from([-5, -5, 5, 5]),
      Uint8Array.from([1, 1]),
      800,
      600,
    );
    expect(fitted).toBe(true);
  });
});

describe('Camera.autoFit', () => {
  it('следует за раскладкой, а не защёлкивается на первом вписывании', () => {
    // Дерево стартует плотным комком (узел рождается рядом с родителем) и
    // расходится за несколько сообщений раскладки. Если камера вписывает
    // только первое из них, разошедшееся дерево уезжает за экран.
    const camera = new Camera();
    const active = Uint8Array.from([1, 1]);

    camera.autoFit(Float32Array.from([-5, -5, 5, 5]), active, 800, 600);
    const tight = camera.scale;

    camera.autoFit(Float32Array.from([-500, -500, 500, 500]), active, 800, 600);
    expect(camera.scale).toBeLessThan(tight);

    const [ax, ay] = camera.toScreen(-500, -500);
    const [bx, by] = camera.toScreen(500, 500);
    expect(ax).toBeGreaterThan(0);
    expect(ay).toBeGreaterThan(0);
    expect(bx).toBeLessThan(800);
    expect(by).toBeLessThan(600);
  });

  it('прекращается навсегда, как только пользователь взял камеру в свои руки', () => {
    const camera = new Camera();
    const active = Uint8Array.from([1, 1]);
    camera.autoFit(Float32Array.from([-5, -5, 5, 5]), active, 800, 600);
    const before = camera.scale;

    camera.takeManualControl();

    const fitted = camera.autoFit(Float32Array.from([-500, -500, 500, 500]), active, 800, 600);
    expect(fitted).toBe(false);
    expect(camera.scale).toBe(before);
  });

  it('не считает камеру настроенной, если активных узлов не было', () => {
    const camera = new Camera();
    expect(camera.autoFit(Float32Array.from([1, 1]), Uint8Array.from([0]), 800, 600)).toBe(false);
  });
});
