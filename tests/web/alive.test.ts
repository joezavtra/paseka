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

  it('не хоронит файл, который позже стал директорией', () => {
    // `docs` сначала обычный файл без расширения, а следующим коммитом
    // появляется `docs/guide.md` — тот же путь становится ещё и директорией.
    const grown = buildPack(
      [
        commit('d0', 100, [{ path: 'docs', kind: 'add', added: 4, deleted: 0, binary: false }]),
        commit('d1', 200, [
          { path: 'docs/guide.md', kind: 'add', added: 7, deleted: 0, binary: false },
        ]),
      ],
      { repoName: 'demo', head: 'd1' },
    );
    const docs = grown.paths.indexOf('docs');
    const guide = grown.paths.indexOf('docs/guide.md');

    expect(grown.pathIsDir[docs]).toBe(1); // флаг остаётся — он нужен рендеру
    expect(aliveAt(grown, 0)[docs]).toBe(1);
    expect(aliveAt(grown, 1)[docs]).toBe(1);
    expect(aliveAt(grown, 1)[guide]).toBe(1);
  });
});

describe('sizesAt', () => {
  it('возвращает размер файла на момент коммита', () => {
    expect(sizesAt(pack, 0)[id('src/a.ts')]).toBe(10);
    expect(sizesAt(pack, 1)[id('src/a.ts')]).toBe(14);
    expect(sizesAt(pack, 3)[id('src/a.ts')]).toBe(3);
  });

  it('не заглядывает в будущее', () => {
    // У пути должно быть несколько событий и «дыры» между ними: только так
    // двоичный поиск по событиям пути может ошибиться и вернуть более позднее
    // значение вместо значения на запрошенный момент.
    const many = buildPack(
      [
        commit('m0', 100, [{ path: 'src/b.ts', kind: 'add', added: 5, deleted: 0, binary: false }]),
        commit('m1', 200, [
          { path: 'other.txt', kind: 'add', added: 1, deleted: 0, binary: false },
        ]),
        commit('m2', 300, [
          { path: 'src/b.ts', kind: 'modify', added: 10, deleted: 2, binary: false },
        ]),
        commit('m3', 400, [
          { path: 'other.txt', kind: 'modify', added: 1, deleted: 0, binary: false },
        ]),
        commit('m4', 500, [
          { path: 'src/b.ts', kind: 'modify', added: 1, deleted: 9, binary: false },
        ]),
        commit('m5', 600, [
          { path: 'src/b.ts', kind: 'delete', added: 0, deleted: 5, binary: false },
        ]),
      ],
      { repoName: 'demo', head: 'm5' },
    );
    const b = many.paths.indexOf('src/b.ts');

    expect(sizesAt(many, 0)[b]).toBe(5); // не 13 из m2 и не 0 из m5
    expect(sizesAt(many, 1)[b]).toBe(5); // между событиями размер не меняется
    expect(sizesAt(many, 2)[b]).toBe(13);
    expect(sizesAt(many, 3)[b]).toBe(13);
    expect(sizesAt(many, 4)[b]).toBe(5);
    expect(sizesAt(many, 5)[b]).toBe(0); // удаление обнуляет размер
  });
});
