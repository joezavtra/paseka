import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectRepo, RepoError } from '../../src/git/repo.js';
import { streamCommits } from '../../src/git/log-stream.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';
import type { RawCommit } from '../../src/git/types.js';

afterAll(cleanupRepos);

async function collect(root: string): Promise<RawCommit[]> {
  const out: RawCommit[] = [];
  for await (const commit of streamCommits(root)) out.push(commit);
  return out;
}

/** Полностью вычитывает генератор, но отбрасывает результат — нужен только для проверки ошибок. */
async function drain(root: string): Promise<void> {
  for await (const _commit of streamCommits(root)) {
    // намеренно ничего не делаем — интересует только факт ошибки/её отсутствия
  }
}

describe('streamCommits', () => {
  it('отдаёт коммиты от старых к новым с правильными статусами', async () => {
    const root = await makeRepo([
      { message: 'первый', write: { 'a.txt': 'l1\nl2\nl3\n', 'src/b.ts': 'x\n' } },
      {
        message: 'второй',
        author: { name: 'Бо', email: 'bo@example.com' },
        write: { 'a.txt': 'l1\nl2\nl3\nl4\n' },
        writeBinary: { 'bin.dat': [0, 1, 2] },
        remove: ['src/b.ts'],
      },
    ]);

    const commits = await collect(root);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.subject).toBe('первый');
    expect(commits[0]!.changes.map((c) => [c.path, c.kind])).toEqual([
      ['a.txt', 'add'],
      ['src/b.ts', 'add'],
    ]);

    expect(commits[1]!.authorEmail).toBe('bo@example.com');
    const second = new Map(commits[1]!.changes.map((c) => [c.path, c]));
    expect(second.get('src/b.ts')!.kind).toBe('delete');
    expect(second.get('bin.dat')!.binary).toBe(true);
    expect(second.get('a.txt')!.added).toBe(1);
  });

  it('переживает пустой коммит', async () => {
    const root = await makeRepo([
      { message: 'первый', write: { 'a.txt': 'x\n' } },
      { message: 'пустой' },
    ]);
    const commits = await collect(root);
    expect(commits).toHaveLength(2);
    expect(commits[1]!.changes).toEqual([]);
  });

  it('даёт RepoError с текстом от git, если git log завершился ненулевым кодом', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gource-reborn-not-a-repo-'));
    try {
      let caught: unknown;
      try {
        await drain(dir);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RepoError);
      const message = (caught as RepoError).message;
      expect(message).not.toBe('');
      expect(message).toMatch(/git log/);
      expect(message).toMatch(/not a git repository/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('репортит RepoError при недоступном git и не роняет процесс необработанным реджектом', async () => {
    const emptyPathDir = await mkdtemp(join(tmpdir(), 'gource-reborn-empty-path-'));
    const originalPath = process.env.PATH;
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      process.env.PATH = emptyPathDir;
      let caught: unknown;
      try {
        await drain('.');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RepoError);
      expect((caught as RepoError).message).toBe(
        'git не найден в PATH. Установите git и повторите.',
      );
      // Даём шанс всплыть отложенному unhandledRejection, если он всё же случится:
      // само событие срабатывает асинхронно, через микротаск(и) после реджекта.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.env.PATH = originalPath;
      process.off('unhandledRejection', onUnhandledRejection);
      await rm(emptyPathDir, { recursive: true, force: true });
    }
  });
});

describe('inspectRepo', () => {
  it('возвращает корень, имя и HEAD', async () => {
    const root = await makeRepo([{ message: 'первый', write: { 'a.txt': 'x\n' } }]);
    const info = await inspectRepo(join(root, '.'));
    expect(info.root).toBe(root);
    expect(info.head).toMatch(/^[0-9a-f]{7,}$/);
    expect(info.shallow).toBe(false);
  });

  it('внятно ругается, если это не репозиторий', async () => {
    await expect(inspectRepo('/')).rejects.toBeInstanceOf(RepoError);
  });
});
