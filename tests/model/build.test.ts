import { describe, it, expect } from 'vitest';
import { buildPack } from '../../src/model/build.js';
import { ALIVE, KIND_ADD, KIND_DELETE } from '../../src/model/history.js';
import { FLAG_BINARY } from '../../src/model/types.js';
import type { RawCommit } from '../../src/git/types.js';

const commits: RawCommit[] = [
  {
    hash: 'aaa111',
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: 100,
    subject: 'первый',
    changes: [
      { path: 'src/a.ts', kind: 'add', added: 10, deleted: 0, binary: false },
      { path: 'README.md', kind: 'add', added: 2, deleted: 0, binary: false },
    ],
  },
  {
    hash: 'bbb222',
    authorName: 'Бо',
    authorEmail: 'bo@example.com',
    timestamp: 200,
    subject: 'второй',
    changes: [
      { path: 'src/a.ts', kind: 'delete', added: 0, deleted: 10, binary: false },
      { path: 'logo.png', kind: 'add', added: 0, deleted: 0, binary: true },
    ],
  },
];

describe('buildPack', () => {
  it('заполняет метаданные', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    expect(pack.meta).toEqual({
      repoName: 'demo',
      head: 'bbb222',
      commitCount: 2,
      pathCount: pack.paths.length,
      firstTs: 100,
      lastTs: 200,
    });
  });

  it('строит пул путей вместе с директориями', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    expect(pack.paths).toEqual(['', 'src', 'src/a.ts', 'README.md', 'logo.png']);
    expect([...pack.pathIsDir]).toEqual([1, 1, 0, 0, 0]);
    expect(pack.pathParent[2]).toBe(1);
  });

  it('дедуплицирует авторов по email', () => {
    const pack = buildPack([...commits, { ...commits[0]!, hash: 'ccc333', timestamp: 300 }], {
      repoName: 'demo',
      head: 'ccc333',
    });
    expect(pack.authors.map((a) => a.email)).toEqual(['anya@example.com', 'bo@example.com']);
    expect([...pack.commitAuthor]).toEqual([0, 1, 0]);
  });

  it('дедуплицирует авторов по email без учёта регистра', () => {
    const caseVariants: RawCommit[] = [
      {
        hash: 'ddd444',
        authorName: 'Аня',
        authorEmail: 'anya@example.com',
        timestamp: 400,
        subject: 'третий',
        changes: [],
      },
      {
        hash: 'eee555',
        authorName: 'Anya',
        authorEmail: '  Anya@Example.com  ',
        timestamp: 500,
        subject: 'четвёртый',
        changes: [],
      },
    ];
    const pack = buildPack(caseVariants, { repoName: 'demo', head: 'eee555' });
    expect(pack.authors.length).toBe(1);
    expect(pack.authors[0]).toEqual({ name: 'Аня', email: 'anya@example.com' });
    expect([...pack.commitAuthor]).toEqual([0, 0]);
  });

  it('раскладывает события в CSR по коммитам', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    expect([...pack.commitEventStart]).toEqual([0, 2, 4]);
    expect([...pack.eventCommit]).toEqual([0, 0, 1, 1]);
    expect([...pack.eventKind]).toEqual([KIND_ADD, KIND_ADD, KIND_DELETE, KIND_ADD]);
  });

  it('помечает бинарные файлы флагом', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    const png = pack.paths.indexOf('logo.png');
    const event = [...pack.eventPath].indexOf(png);
    expect(pack.eventFlags[event] & FLAG_BINARY).toBe(FLAG_BINARY);
  });

  it('прокидывает времена жизни из history', () => {
    const pack = buildPack(commits, { repoName: 'demo', head: 'bbb222' });
    const a = pack.paths.indexOf('src/a.ts');
    const readme = pack.paths.indexOf('README.md');
    expect(pack.lifetimeDeath[pack.lifetimeStart[a]]).toBe(1);
    expect(pack.lifetimeDeath[pack.lifetimeStart[readme]]).toBe(ALIVE);
  });

  it('переживает пустую историю', () => {
    const pack = buildPack([], { repoName: 'empty', head: '0000000' });
    expect(pack.meta.commitCount).toBe(0);
    expect(pack.paths).toEqual(['']);
    expect([...pack.commitEventStart]).toEqual([0]);
  });
});
