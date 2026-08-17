import { describe, it, expect } from 'vitest';
import { BEFORE_HISTORY, TimeEngine } from '../../web/time/engine.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

function commit(hash: string, changes: RawCommit['changes']): RawCommit {
  return {
    hash,
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: 100,
    subject: hash,
    changes,
  };
}

const pack = buildPack(
  [
    commit('c0', [
      { path: 'src/a.ts', kind: 'add', added: 10, deleted: 0, binary: false },
      { path: 'README.md', kind: 'add', added: 2, deleted: 0, binary: false },
    ]),
    commit('c1', [{ path: 'src/a.ts', kind: 'modify', added: 5, deleted: 1, binary: false }]),
    commit('c2', [{ path: 'src/a.ts', kind: 'delete', added: 0, deleted: 14, binary: false }]),
    commit('c3', [{ path: 'src/deep/b.ts', kind: 'add', added: 3, deleted: 0, binary: false }]),
  ],
  { repoName: 'demo', head: 'c3' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('TimeEngine.seek', () => {
  it('до начала истории не живо ничего', () => {
    const engine = new TimeEngine(pack);
    expect(engine.cursor).toBe(BEFORE_HISTORY);
    expect([...engine.alive].every((v) => v === 0)).toBe(true);
  });

  it('оживляет пути и их предков', () => {
    const engine = new TimeEngine(pack);
    engine.seek(0);
    expect(engine.alive[id('src/a.ts')]).toBe(1);
    expect(engine.alive[id('src')]).toBe(1);
    expect(engine.alive[0]).toBe(1);
    expect(engine.sizes[id('src/a.ts')]).toBe(10);
  });

  it('хоронит директорию вместе с последним потомком', () => {
    const engine = new TimeEngine(pack);
    engine.seek(2);
    expect(engine.alive[id('src/a.ts')]).toBe(0);
    expect(engine.alive[id('src')]).toBe(0);
    expect(engine.alive[id('README.md')]).toBe(1);
    expect(engine.alive[0]).toBe(1);
  });

  it('оживляет цепочку директорий на глубоком пути', () => {
    const engine = new TimeEngine(pack);
    engine.seek(3);
    expect(engine.alive[id('src/deep/b.ts')]).toBe(1);
    expect(engine.alive[id('src/deep')]).toBe(1);
    expect(engine.alive[id('src')]).toBe(1);
    expect(engine.alive[id('src/a.ts')]).toBe(0);
  });

  it('возвращает разницу живого множества', () => {
    const engine = new TimeEngine(pack);
    engine.seek(1);
    const delta = engine.seek(2);
    expect([...delta.removed].sort((a, b) => a - b)).toEqual(
      [id('src'), id('src/a.ts')].sort((a, b) => a - b),
    );
    expect([...delta.added]).toEqual([]);
  });

  it('зажимает курсор в границы истории', () => {
    const engine = new TimeEngine(pack);
    engine.seek(999);
    expect(engine.cursor).toBe(pack.meta.commitCount - 1);
    engine.seek(-999);
    expect(engine.cursor).toBe(BEFORE_HISTORY);
    expect([...engine.alive].every((v) => v === 0)).toBe(true);
  });

  it('не заглядывает в будущее по размеру', () => {
    const engine = new TimeEngine(pack);
    engine.seek(0);
    expect(engine.sizes[id('src/a.ts')]).toBe(10);
    engine.seek(1);
    expect(engine.sizes[id('src/a.ts')]).toBe(14);
  });
});
