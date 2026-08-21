import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface FixtureCommit {
  message: string;
  author?: { name: string; email: string };
  write?: Record<string, string>;
  writeBinary?: Record<string, number[]>;
  remove?: string[];
}

const created: string[] = [];

/**
 * Создаёт временный репозиторий с заданной историей. Время коммитов детерминировано.
 * Путь канонизируется: на macOS `/var` и `/tmp` — симлинки в `/private`, mkdtemp
 * возвращает путь со ссылкой, а `git rev-parse --show-toplevel` — всегда настоящий.
 * Без realpath сравнение корня репозитория со строкой из git никогда не сойдётся.
 */
export async function makeRepo(commits: FixtureCommit[]): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paseka-')));
  created.push(root);
  const git = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    run('git', args, { cwd: root, env: { ...process.env, ...env } });

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'user.email', 'fixture@example.com']);

  let stamp = 1_700_000_000;
  for (const commit of commits) {
    for (const [path, text] of Object.entries(commit.write ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    for (const [path, bytes] of Object.entries(commit.writeBinary ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), Buffer.from(bytes));
    }
    for (const path of commit.remove ?? []) {
      await git(['rm', '-q', '-f', path]);
    }
    await git(['add', '-A']);
    const date = `${stamp} +0000`;
    stamp += 100;
    await git(
      ['commit', '-q', '--allow-empty', '-m', commit.message],
      {
        GIT_AUTHOR_NAME: commit.author?.name ?? 'Fixture',
        GIT_AUTHOR_EMAIL: commit.author?.email ?? 'fixture@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_DATE: date,
      },
    );
  }
  return root;
}

/** Вызывается из глобального afterAll в тестах, которые создают репозитории. */
export async function cleanupRepos(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
