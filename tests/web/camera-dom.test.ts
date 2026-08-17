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

function attached(): { camera: Camera; canvas: HTMLCanvasElement } {
  const camera = new Camera();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  detach = camera.attach(canvas);
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
