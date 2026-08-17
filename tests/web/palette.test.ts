import { describe, it, expect } from 'vitest';
import { DIR_COLOR_INDEX, PALETTE, paletteIndexForPath } from '../../web/render/palette.js';

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
