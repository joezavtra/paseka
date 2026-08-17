import { describe, it, expect } from 'vitest';
import { HIDDEN, resolveVisibility } from '../../web/state/visibility.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const commit = (hash: string, changes: RawCommit['changes']): RawCommit => ({
  hash,
  authorName: 'A',
  authorEmail: 'a@e.com',
  timestamp: 1,
  subject: hash,
  changes,
});

const add = (path: string, added: number) => ({
  path,
  kind: 'add' as const,
  added,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [commit('c0', [add('src/deep/a.ts', 10), add('src/b.ts', 20), add('docs/c.md', 5)])],
  { repoName: 'demo', head: 'c0' },
);

const id = (path: string) => pack.paths.indexOf(path);
const alive = new Uint8Array(pack.meta.pathCount).fill(1);

function sizesOf(): Int32Array {
  const sizes = new Int32Array(pack.meta.pathCount);
  sizes[id('src/deep/a.ts')] = 10;
  sizes[id('src/b.ts')] = 20;
  sizes[id('docs/c.md')] = 5;
  return sizes;
}

const NOTHING = { hidden: new Set<number>(), collapsed: new Set<number>() };

describe('resolveVisibility', () => {
  it('без спецификации каждый путь представляет сам себя', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), NOTHING);
    for (let path = 0; path < pack.meta.pathCount; path++) {
      expect(result.representative[path], pack.paths[path]).toBe(path);
      expect(result.drawn[path], pack.paths[path]).toBe(1);
    }
  });

  it('скрытая папка уносит с собой всё поддерево', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([id('src')]),
      collapsed: new Set(),
    });
    for (const path of ['src', 'src/deep', 'src/deep/a.ts', 'src/b.ts']) {
      expect(result.representative[id(path)], path).toBe(HIDDEN);
      expect(result.drawn[id(path)], path).toBe(0);
    }
    expect(result.drawn[id('docs/c.md')]).toBe(1);
  });

  it('свёрнутая папка остаётся на экране и представляет потомков', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.drawn[id('src')]).toBe(1);
    expect(result.representative[id('src')]).toBe(id('src'));
    for (const path of ['src/deep', 'src/deep/a.ts', 'src/b.ts']) {
      expect(result.representative[id(path)], path).toBe(id('src'));
      expect(result.drawn[id(path)], path).toBe(0);
    }
  });

  it('свёрнутая папка вбирает размеры живых потомков', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.sizes[id('src')]).toBe(30);
    expect(result.sizes[id('docs/c.md')]).toBe(5);
  });

  it('вложенное сворачивание представляет верхним свёрнутым', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src'), id('src/deep')]),
    });
    expect(result.representative[id('src/deep/a.ts')]).toBe(id('src'));
    expect(result.representative[id('src/deep')]).toBe(id('src'));
    expect(result.drawn[id('src/deep')]).toBe(0);
  });

  it('скрытие сильнее сворачивания', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([id('src/deep')]),
      collapsed: new Set([id('src')]),
    });
    expect(result.representative[id('src/deep/a.ts')]).toBe(HIDDEN);
    expect(result.sizes[id('src')]).toBe(20);
  });

  it('мёртвые пути не рисуются и не попадают в размер представителя', () => {
    const partly = new Uint8Array(alive);
    partly[id('src/b.ts')] = 0;
    const result = resolveVisibility(pack, partly, sizesOf(), {
      hidden: new Set(),
      collapsed: new Set([id('src')]),
    });
    expect(result.drawn[id('src/b.ts')]).toBe(0);
    expect(result.sizes[id('src')]).toBe(10);
  });

  it('скрытый корень убирает всё', () => {
    const result = resolveVisibility(pack, alive, sizesOf(), {
      hidden: new Set([0]),
      collapsed: new Set(),
    });
    expect([...result.drawn].every((value) => value === 0)).toBe(true);
  });

  it('не падает на пустом пакете', () => {
    const empty = buildPack([], { repoName: 'x', head: '0' });
    const result = resolveVisibility(empty, new Uint8Array(1), new Int32Array(1), NOTHING);
    expect(result.representative).toHaveLength(1);
  });
});
