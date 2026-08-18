// @vitest-environment happy-dom
//
// Единственный тестовый файл камеры, которому нужен DOM: только здесь
// проверяется `attach` — реакция на колесо и перетаскивание. Остальные тесты
// камеры живут в среде `node` (см. tests/web/camera.test.ts и vitest.config.ts),
// поэтому окружение переключено докблоком только для этого файла.
import { describe, it, expect, afterEach } from 'vitest';
import { Camera } from '../../web/render/camera.js';

let detach: (() => void) | null = null;

afterEach(() => {
  detach?.();
  detach = null;
  document.body.replaceChildren();
});

function attached(onManualControl?: () => void): { camera: Camera; canvas: HTMLCanvasElement } {
  const camera = new Camera();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  detach = camera.attach(canvas, onManualControl);
  return { camera, canvas };
}

describe('Camera.attach — ручное управление отключает автовписывание', () => {
  it('колесо прекращает автоматическое вписывание', () => {
    const { camera, canvas } = attached();
    expect(camera.autoFit(Float32Array.from([-5, -5, 5, 5]), Uint8Array.from([1, 1]), 800, 600)).toBe(
      true,
    );

    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));

    expect(camera.autoFit(Float32Array.from([-500, -500, 500, 500]), Uint8Array.from([1, 1]), 800, 600)).toBe(
      false,
    );
  });

  it('перетаскивание прекращает автоматическое вписывание', () => {
    const { camera, canvas } = attached();
    const scaleBefore = camera.scale;

    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    expect(camera.autoFit(Float32Array.from([-500, -500, 500, 500]), Uint8Array.from([1, 1]), 800, 600)).toBe(
      false,
    );
    expect(camera.scale).toBe(scaleBefore);
  });

  it('до вмешательства пользователя вписывание работает', () => {
    const { camera } = attached();
    expect(camera.autoFit(Float32Array.from([-5, -5, 5, 5]), Uint8Array.from([1, 1]), 800, 600)).toBe(
      true,
    );
  });
});

describe('Camera.attach — onManualControl', () => {
  // Поиск (срез 5) вешает сюда снятие отложенного фокуса: жест пользователя
  // должен перекрывать намерение, оставшееся от Enter, отправленного раньше.
  it('зовётся на колесо', () => {
    let calls = 0;
    const { canvas } = attached(() => calls++);

    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));

    expect(calls).toBe(1);
  });

  it('зовётся на перетаскивание', () => {
    let calls = 0;
    const { canvas } = attached(() => calls++);

    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    expect(calls).toBe(1);
  });

  it('не зовётся на одиночный клик без перемещения (клик по узлу — не жест камерой)', () => {
    let calls = 0;
    const { canvas } = attached(() => calls++);

    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));

    expect(calls).toBe(0);
  });

  it('не зовётся до всякого взаимодействия', () => {
    let calls = 0;
    attached(() => calls++);
    expect(calls).toBe(0);
  });

  it('необязателен: attach без колбэка не падает на тех же жестах', () => {
    const { canvas } = attached();
    expect(() => {
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));
    }).not.toThrow();
  });
});
