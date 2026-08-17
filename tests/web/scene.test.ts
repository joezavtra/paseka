import { describe, it, expect } from 'vitest';
import { Camera } from '../../web/render/camera.js';
import {
  DIR_COLOR_INDEX,
  PALETTE,
  drawScene,
  paletteIndexForPath,
  type SceneInput,
} from '../../web/render/scene.js';

/** Заглушка контекста canvas: запоминает, какой кистью что залито. */
function stubContext(): { ctx: CanvasRenderingContext2D; fills: string[] } {
  const fills: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    arc: () => undefined,
    fill() {
      fills.push(String((ctx as { fillStyle: string }).fillStyle));
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

describe('paletteIndexForPath', () => {
  it('возвращает числовой индекс внутри палитры', () => {
    const index = paletteIndexForPath('src/a.ts');
    expect(Number.isInteger(index)).toBe(true);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(PALETTE.length);
  });

  it('даёт одинаковый цвет одному расширению независимо от папки', () => {
    expect(paletteIndexForPath('src/a.ts')).toBe(paletteIndexForPath('lib/deep/b.ts'));
  });

  it('разводит распространённые расширения по разным цветам', () => {
    // Палитра конечна, отдельные коллизии допустимы — проверяем разброс, а не
    // неравенство конкретной пары, иначе тест держится на значении хэша.
    const extensions = ['ts', 'js', 'md', 'json', 'css', 'html', 'py', 'go', 'rs', 'yml'];
    const colors = new Set(extensions.map((ext) => PALETTE[paletteIndexForPath(`file.${ext}`)]));
    expect(colors.size).toBeGreaterThanOrEqual(5);
  });

  it('не падает на файле без расширения и отдаёт цвет каталога', () => {
    expect(paletteIndexForPath('Makefile')).toBe(DIR_COLOR_INDEX);
    expect(PALETTE[paletteIndexForPath('Makefile')]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('палитра — единственное место, где живут строки цветов', () => {
    for (const color of PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(PALETTE.length).toBeGreaterThan(1);
  });
});

describe('drawScene', () => {
  it('берёт строку кисти из палитры по числовому индексу узла', () => {
    const { ctx, fills } = stubContext();
    const camera = new Camera();
    const input: SceneInput = {
      active: Uint8Array.from([1, 1]),
      positions: Float32Array.from([0, 0, 10, 10]),
      radius: Float32Array.from([3, 3]),
      // Цвет — индекс в палитре, а не строка: в срезе 5 его придётся умножать
      // на альфу гашения покадрово, и строки для этого негодны.
      color: Uint8Array.from([DIR_COLOR_INDEX, 3]),
      linkSource: new Uint32Array(0),
      linkTarget: new Uint32Array(0),
      flash: new Float32Array(2),
      beams: {
        count: 0,
        fromX: new Float32Array(0),
        fromY: new Float32Array(0),
        toPath: new Uint32Array(0),
        author: new Uint32Array(0),
        strength: new Float32Array(0),
      },
      actors: {
        positions: new Float32Array(0),
        active: new Uint8Array(0),
        color: [],
        initials: [],
        name: [],
      },
    };

    drawScene(ctx, camera, input, 800, 600);

    expect(fills).toEqual([PALETTE[DIR_COLOR_INDEX], PALETTE[3]]);
  });
});
