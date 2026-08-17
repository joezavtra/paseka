import { spawn } from 'node:child_process';
import { CommitParser, GIT_LOG_ARGS } from './parse.js';
import { RepoError } from './repo.js';
import type { RawCommit } from './types.js';

/**
 * Читает историю репозитория, не удерживая вывод git целиком:
 * stdout приходит чанками, парсер держит только хвост незавершённой записи.
 */
export async function* streamCommits(root: string): AsyncGenerator<RawCommit> {
  const child = spawn('git', GIT_LOG_ARGS, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let stderr = '';
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 4096) stderr += chunk;
  });

  // `exit` никогда не отклоняется: ошибка спавна запоминается в `spawnError`,
  // а промис в любом случае резолвится. Иначе при ENOENT/EACCES реджект случится
  // раньше, чем кто-либо начнёт ждать `exit` (см. цикл чтения stdout ниже), и
  // Node сочтёт его необработанным ещё до того, как мы дойдём до `await exit`.
  let spawnError: RepoError | null = null;
  const exit = new Promise<number>((resolveExit) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError =
        error.code === 'ENOENT'
          ? new RepoError('git не найден в PATH. Установите git и повторите.')
          : new RepoError(error.message);
      resolveExit(-1);
    });
    child.on('close', (code) => resolveExit(code ?? 0));
  });

  const parser = new CommitParser();
  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      yield* parser.push(chunk);
    }
  } catch {
    // При неудачном спавне stdout может оборваться с ошибкой вместо тихого
    // завершения — разбираться в причине будем ниже, по `spawnError`/коду выхода.
  } finally {
    if (child.exitCode === null) child.kill();
  }

  const code = await exit;
  if (spawnError) throw spawnError;
  if (code !== 0) {
    throw new RepoError(`git log завершился с кодом ${code}:\n${stderr.trim()}`);
  }
  yield* parser.flush();
}
