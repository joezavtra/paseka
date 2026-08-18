import { describe, it, expect } from 'vitest';
import { DIR_COLOR_INDEX, PALETTE, paletteIndexForPath } from '../../web/render/palette.js';
import { extensionOf } from '../../web/state/filter.js';
import { hashString } from '../../src/util/hash.js';

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

describe('paletteIndexForPath и фильтр — одно определение расширения', () => {
  // Правило «какое у пути расширение» живёт в одном месте — в фильтре. Этот
  // тест стоит сторожем: цвет узла обязан выводиться ровно из того расширения,
  // которое видит чип фильтра. Разойдись эти два определения — пользователь
  // выберет чип `js` и увидит, что часть файлов не того цвета.
  //
  // Ожидание считается по строке от `extensionOf`, а не через сам
  // `paletteIndexForPath` от образцового имени: иначе вторая копия определения
  // сократилась бы с первой и тест ничего бы не поймал.
  it('цвет пути выводится из расширения, которое видит фильтр', () => {
    const paths = [
      'src/a.ts',
      'src/b.min.js',
      'deep/dir/c.TS',
      'weird.tar.gz',
      'README',
      '.gitignore',
      'dir/.env',
      'no/dot/here',
    ];
    // Цвета файлов идут сразу за цветом каталога — тем же порядком, что и в
    // самой палитре.
    const fileColorStart = DIR_COLOR_INDEX + 1;
    for (const path of paths) {
      const ext = extensionOf(path);
      const expected =
        ext === ''
          ? DIR_COLOR_INDEX
          : fileColorStart + (hashString(ext) % (PALETTE.length - fileColorStart));
      expect(paletteIndexForPath(path), path).toBe(expected);
    }
  });
});
