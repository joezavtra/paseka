import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { buildPack } from '../../src/model/build.js';
import { listHeadFiles } from '../../src/git/tree.js';
import { streamCommits } from '../../src/git/log-stream.js';
import { ALIVE } from '../../src/model/history.js';
import type { RawCommit } from '../../src/git/types.js';

const run = promisify(execFile);
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/**
 * Репозиторий с расхождением: b.txt удалён на main, затем изменён на ветке,
 * слияние разрешено в пользу удаления. Удаление записано только в коммите
 * слияния, который --no-merges не видит.
 */
async function makeDivergentRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gr-merge-')));
  dirs.push(root);
  let stamp = 1_700_000_000;
  const git = (args: string[]) =>
    run('git', args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'f@e.com',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'f@e.com',
        GIT_AUTHOR_DATE: `${(stamp += 100)} +0000`,
        GIT_COMMITTER_DATE: `${stamp} +0000`,
      },
    });
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };

  await git(['init', '-q', '-b', 'main']);
  await write('a.txt', 'a\n');
  await write('b.txt', 'b\n');
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'первый']);

  await git(['checkout', '-q', '-b', 'feature']);
  await git(['checkout', '-q', 'main']);
  await git(['rm', '-q', 'b.txt']);
  await git(['commit', '-q', '-m', 'удалил b на main']);

  await git(['checkout', '-q', 'feature']);
  await write('b.txt', 'b\nb2\n');
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', 'правил b на ветке']);

  await git(['checkout', '-q', 'main']);
  // Конфликт «изменён против удалён» — разрешаем в пользу удаления.
  await git(['merge', '--no-commit', '--no-ff', 'feature']).catch(() => undefined);
  await git(['rm', '-q', '-f', 'b.txt']).catch(() => undefined);
  await git(['commit', '-q', '-m', 'слияние: оставил удаление']);
  return root;
}

async function collect(root: string): Promise<RawCommit[]> {
  const out: RawCommit[] = [];
  for await (const commit of streamCommits(root)) out.push(commit);
  return out;
}

describe('сверка с деревом HEAD', () => {
  it('без сверки путь остаётся живым, хотя в HEAD его нет', async () => {
    const root = await makeDivergentRepo();
    const pack = buildPack(await collect(root), { repoName: 'demo', head: 'head' });
    const b = pack.paths.indexOf('b.txt');
    expect(b).toBeGreaterThan(0);
    const last = pack.lifetimeStart[b + 1] - 1;
    expect(pack.lifetimeDeath[last]).toBe(ALIVE);
  });

  it('со сверкой путь закрывается на последнем коммите', async () => {
    const root = await makeDivergentRepo();
    const headFiles = await listHeadFiles(root);
    expect(headFiles.has('a.txt')).toBe(true);
    expect(headFiles.has('b.txt')).toBe(false);

    const pack = buildPack(await collect(root), {
      repoName: 'demo',
      head: 'head',
      headFiles,
    });
    const b = pack.paths.indexOf('b.txt');
    const last = pack.lifetimeStart[b + 1] - 1;
    expect(pack.lifetimeDeath[last]).toBe(pack.meta.commitCount - 1);

    const a = pack.paths.indexOf('a.txt');
    const aLast = pack.lifetimeStart[a + 1] - 1;
    expect(pack.lifetimeDeath[aLast]).toBe(ALIVE);
  });

  it('пустая история не ломается сверкой', () => {
    const pack = buildPack([], { repoName: 'x', head: '0', headFiles: new Set(['a.txt']) });
    expect(pack.meta.commitCount).toBe(0);
    expect(pack.eventPath.length).toBe(0);
  });
});
