import { describe, it, expect, afterEach, vi } from 'vitest';
import { describePack, loadPack } from '../../web/boot.js';
import { buildPack } from '../../src/model/build.js';
import { PackError } from '../../src/pack/decode.js';
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

describe('loadPack', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('оборачивает сетевой сбой fetch в понятную русскую ошибку', async () => {
    const networkError = new TypeError('Failed to fetch');
    globalThis.fetch = vi.fn(() => Promise.reject(networkError));

    await expect(loadPack()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PackError);
      const message = (error as Error).message;
      expect(message).toMatch(/[а-яё]/i);
      expect(message).toContain('Failed to fetch');
      return true;
    });
  });
});
