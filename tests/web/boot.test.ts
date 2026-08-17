import { describe, it, expect } from 'vitest';
import { describePack } from '../../web/boot.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const commits: RawCommit[] = [
  {
    hash: 'aaa111',
    authorName: 'Аня',
    authorEmail: 'anya@example.com',
    timestamp: 1_700_000_000,
    subject: 'первый',
    changes: [{ path: 'src/a.ts', kind: 'add', added: 4, deleted: 0, binary: false }],
  },
];

describe('describePack', () => {
  it('описывает репозиторий одной строкой', () => {
    const text = describePack(buildPack(commits, { repoName: 'demo', head: 'aaa111' }));
    expect(text).toContain('demo');
    expect(text).toContain('1 коммит');
    expect(text).toContain('1 файл');
  });
});
