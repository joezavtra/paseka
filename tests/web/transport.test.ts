import { describe, it, expect } from 'vitest';
import { formatCommitLabel } from '../../web/ui/transport.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const commits: RawCommit[] = [
  {
    hash: 'aaa111bbb222',
    authorName: 'Аня',
    authorEmail: 'a@e.com',
    timestamp: 1_700_000_000,
    subject: 'первый коммит',
    changes: [{ path: 'a.txt', kind: 'add', added: 1, deleted: 0, binary: false }],
  },
  {
    hash: 'ccc333ddd444',
    authorName: 'Бо',
    authorEmail: 'b@e.com',
    timestamp: 1_700_086_400,
    subject: '',
    changes: [],
  },
];

const pack = buildPack(commits, { repoName: 'demo', head: 'ccc333' });

describe('formatCommitLabel', () => {
  it('показывает дату, хэш и тему', () => {
    const label = formatCommitLabel(pack, 0);
    expect(label).toContain('2023-11-14');
    expect(label).toContain('aaa111');
    expect(label).toContain('первый коммит');
  });

  it('переживает пустую тему', () => {
    const label = formatCommitLabel(pack, 1);
    expect(label).toContain('ccc333');
    expect(label).not.toContain('undefined');
  });

  it('сообщает о положении до начала истории', () => {
    expect(formatCommitLabel(pack, -1)).toBe('до начала истории');
  });

  it('зажимает индекс за границей истории', () => {
    expect(formatCommitLabel(pack, 999)).toBe(formatCommitLabel(pack, 1));
  });
});
