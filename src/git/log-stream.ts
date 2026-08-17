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

  const exit = new Promise<number>((resolveExit, rejectExit) => {
    child.on('error', (error: NodeJS.ErrnoException) => {
      rejectExit(
        error.code === 'ENOENT'
          ? new RepoError('git не найден в PATH. Установите git и повторите.')
          : new RepoError(error.message),
      );
    });
    child.on('close', (code) => resolveExit(code ?? 0));
  });

  const parser = new CommitParser();
  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      yield* parser.push(chunk);
    }
  } finally {
    if (child.exitCode === null) child.kill();
  }

  const code = await exit;
  if (code !== 0) {
    throw new RepoError(`git log завершился с кодом ${code}:\n${stderr.trim()}`);
  }
  yield* parser.flush();
}
