import { describe, it, expect } from 'vitest';
import { aliveAt, sizesAt } from '../../web/time/alive.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

function commit(hash: string, ts: number, changes: RawCommit['changes']): RawCommit {
  return {
    hash,
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: ts,
    subject: hash,
    changes,
  };
}

const pack = buildPack(
  [
    commit('c0', 100, [
      { path: 'src/a.ts', kind: 'add', added: 10, deleted: 0, binary: false },
      { path: 'README.md', kind: 'add', added: 2, deleted: 0, binary: false },
    ]),
    commit('c1', 200, [
      { path: 'src/a.ts', kind: 'modify', added: 5, deleted: 1, binary: false },
    ]),
    commit('c2', 300, [
      { path: 'src/a.ts', kind: 'delete', added: 0, deleted: 14, binary: false },
    ]),
    commit('c3', 400, [
      { path: 'src/a.ts', kind: 'add', added: 3, deleted: 0, binary: false },
    ]),
  ],
  { repoName: 'demo', head: 'c3' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('aliveAt', () => {
  it('оживляет файлы с их первого коммита', () => {
    const alive = aliveAt(pack, 0);
    expect(alive[id('src/a.ts')]).toBe(1);
    expect(alive[id('README.md')]).toBe(1);
  });

  it('хоронит файл в коммите удаления и воскрешает при повторном создании', () => {
    expect(aliveAt(pack, 1)[id('src/a.ts')]).toBe(1);
    expect(aliveAt(pack, 2)[id('src/a.ts')]).toBe(0);
    expect(aliveAt(pack, 3)[id('src/a.ts')]).toBe(1);
  });

  it('держит директорию живой, пока жив хоть один потомок', () => {
    expect(aliveAt(pack, 1)[id('src')]).toBe(1);
    expect(aliveAt(pack, 2)[id('src')]).toBe(0);
    expect(aliveAt(pack, 2)[0]).toBe(1); // корень жив, пока жив README.md
  });
});

describe('sizesAt', () => {
  it('возвращает размер файла на момент коммита', () => {
    expect(sizesAt(pack, 0)[id('src/a.ts')]).toBe(10);
    expect(sizesAt(pack, 1)[id('src/a.ts')]).toBe(14);
    expect(sizesAt(pack, 3)[id('src/a.ts')]).toBe(3);
  });

  it('не заглядывает в будущее', () => {
    expect(sizesAt(pack, 0)[id('src/a.ts')]).toBe(10);
  });
});
