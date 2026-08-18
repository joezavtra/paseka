import { describe, it, expect } from 'vitest';
import { computeAlpha, DIM_ALPHA, extensionOf, isEmptyFilter } from '../../web/state/filter.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const change = (path: string) => ({
  path,
  kind: 'add' as const,
  added: 1,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1,
      subject: 'c0',
      changes: [change('src/a.ts'), change('docs/b.md')],
    },
    {
      hash: 'c1',
      authorName: 'Бо',
      authorEmail: 'bo@e.com',
      timestamp: 2,
      subject: 'c1',
      changes: [change('src/deep/c.ts')],
    },
  ],
  { repoName: 'demo', head: 'c1' },
);

const id = (path: string) => pack.paths.indexOf(path);
const EMPTY = { authors: null, pathQuery: '', extensions: null };

describe('extensionOf', () => {
  it('берёт расширение в нижнем регистре', () => {
    expect(extensionOf('src/A.TS')).toBe('ts');
  });

  it('файл без расширения и точечный файл дают пустую строку', () => {
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('isEmptyFilter', () => {
  it('пустой фильтр распознаётся', () => {
    expect(isEmptyFilter(EMPTY)).toBe(true);
    expect(isEmptyFilter({ ...EMPTY, pathQuery: '  ' })).toBe(true);
  });

  it('любое ограничение делает фильтр непустым', () => {
    expect(isEmptyFilter({ ...EMPTY, authors: new Set([0]) })).toBe(false);
    expect(isEmptyFilter({ ...EMPTY, extensions: new Set(['ts']) })).toBe(false);
    expect(isEmptyFilter({ ...EMPTY, pathQuery: 'src' })).toBe(false);
  });
});

describe('computeAlpha', () => {
  it('без фильтра всё в полную яркость', () => {
    const alpha = computeAlpha(pack, EMPTY);
    expect([...alpha].every((value) => value === 1)).toBe(true);
  });

  it('фильтр по расширению гасит непопавшее, но не убирает', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, extensions: new Set(['ts']) });
    expect(alpha[id('src/a.ts')]).toBe(1);
    expect(alpha[id('docs/b.md')]).toBeCloseTo(DIM_ALPHA, 5);
    expect(alpha[id('docs/b.md')]).toBeGreaterThan(0);
  });

  it('каталог берёт максимум по потомкам, чтобы путь к находке был виден', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, pathQuery: 'deep/c' });
    expect(alpha[id('src/deep/c.ts')]).toBe(1);
    expect(alpha[id('src/deep')]).toBe(1);
    expect(alpha[id('src')]).toBe(1);
    expect(alpha[0]).toBe(1);
    expect(alpha[id('docs')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('фильтр по автору оставляет только его файлы', () => {
    const anya = pack.authors.findIndex((author) => author.email === 'anya@e.com');
    const alpha = computeAlpha(pack, { ...EMPTY, authors: new Set([anya]) });
    expect(alpha[id('src/a.ts')]).toBe(1);
    expect(alpha[id('docs/b.md')]).toBe(1);
    expect(alpha[id('src/deep/c.ts')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('ограничения складываются по «и»', () => {
    const anya = pack.authors.findIndex((author) => author.email === 'anya@e.com');
    const alpha = computeAlpha(pack, {
      authors: new Set([anya]),
      pathQuery: '',
      extensions: new Set(['ts']),
    });
    expect(alpha[id('src/a.ts')]).toBe(1);
    expect(alpha[id('docs/b.md')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('фильтр, под который ничего не попало, гасит всё, но ничего не прячет', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, pathQuery: 'ничего-такого-нет' });
    expect([...alpha].every((value) => value > 0)).toBe(true);
    expect(alpha[id('src/a.ts')]).toBeCloseTo(DIM_ALPHA, 5);
  });

  it('пустой набор авторов гасит всё: это не то же самое, что отсутствие фильтра', () => {
    const alpha = computeAlpha(pack, { ...EMPTY, authors: new Set<number>() });
    expect(alpha[id('src/a.ts')]).toBeCloseTo(DIM_ALPHA, 5);
  });
});
