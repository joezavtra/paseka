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

describe('Camera — свободная полоса слева под боковую панель', () => {
  // Панель лежит поверх холста и почти непрозрачна: вписывать дерево во всю
  // ширину окна значит спрятать его левый край под панелью. Полоса под HUD
  // вычитается из высоты точно так же, но снизу вычитания хватает — начало
  // отсчёта сверху; слева же нужно ещё и сдвинуть картинку.
  it('fit сдвигает облако правее зарезервированной полосы', () => {
    const camera = new Camera();
    const left = 280;
    camera.fit(Float32Array.from([-100, -100, 100, 100]), 1280 - left, 800, left);

    const [ax] = camera.toScreen(-100, -100);
    const [bx] = camera.toScreen(100, 100);
    expect(ax).toBeGreaterThan(left);
    expect(bx).toBeLessThan(1280);
  });

  it('fitActive передаёт смещение дальше в fit', () => {
    const camera = new Camera();
    const left = 300;
    camera.fitActive(
      Float32Array.from([-10, -10, 10, 10, 100000, 100000]),
      Uint8Array.from([1, 1, 0]),
      1000 - left,
      600,
      left,
    );

    const [ax] = camera.toScreen(-10, -10);
    expect(ax).toBeGreaterThan(left);
  });

  it('autoFit передаёт смещение дальше в fitActive', () => {
    const camera = new Camera();
    const left = 260;
    camera.autoFit(
      Float32Array.from([-5, -5, 5, 5]),
      Uint8Array.from([1, 1]),
      900 - left,
      600,
      left,
    );

    const [ax] = camera.toScreen(-5, -5);
    expect(ax).toBeGreaterThan(left);
  });

  it('без смещения вписывает по-прежнему от левого края', () => {
    const camera = new Camera();
    camera.fit(Float32Array.from([-100, -100, 100, 100]), 800, 600);
    const [ax] = camera.toScreen(-100, -100);
    expect(ax).toBeGreaterThan(0);
    expect(ax).toBeLessThan(200);
  });
});

describe('Camera.focusOn', () => {
  it('ставит точку мира ровно в центр отведённого прямоугольника', () => {
    const camera = new Camera();
    camera.scale = 3;
    camera.focusOn(12, -7, 800, 600);
    const [sx, sy] = camera.toScreen(12, -7);
    expect(sx).toBeCloseTo(400, 5);
    expect(sy).toBeCloseTo(300, 5);
  });

  it('учитывает левую полосу при центрировании', () => {
    const camera = new Camera();
    camera.scale = 2;
    const left = 280;
    camera.focusOn(5, 5, 1000 - left, 600, left);
    const [sx, sy] = camera.toScreen(5, 5);
    expect(sx).toBeCloseTo(left + (1000 - left) / 2, 5);
    expect(sy).toBeCloseTo(300, 5);
  });

  it('не меняет масштаб', () => {
    const camera = new Camera();
    camera.scale = 4.5;
    camera.focusOn(1, 1, 800, 600);
    expect(camera.scale).toBe(4.5);
  });

  it('объявляет камеру управляемой вручную: autoFit после этого молчит', () => {
    const camera = new Camera();
    camera.focusOn(0, 0, 800, 600);
    const fitted = camera.autoFit(
      Float32Array.from([-5, -5, 5, 5]),
      Uint8Array.from([1, 1]),
      800,
      600,
    );
    expect(fitted).toBe(false);
  });
});
