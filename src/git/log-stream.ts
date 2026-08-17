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

  // Ошибка чтения stdout (например, поток оборвался) запоминается, а не
  // пробрасывается сразу: причина обрыва может быть в неудачном спавне —
  // тогда приоритет у `spawnError`, — а может быть и самостоятельной проблемой
  // при штатном коде возврата. Разбираем это ниже, после `await exit`, чтобы
  // не выдать тихий успех с оборванной историей коммитов.
  const parser = new CommitParser();
  let streamError: unknown = null;
  try {
    for await (const chunk of child.stdout as AsyncIterable<string>) {
      yield* parser.push(chunk);
    }
  } catch (error) {
    streamError = error;
  } finally {
    if (child.exitCode === null) child.kill();
  }

  const code = await exit;
  // Порядок проверки — по убыванию определённости причины: сначала сбой
  // самого спавна, затем явный ненулевой код завершения git, и только потом
  // ошибка чтения потока при формально успешном (код 0) завершении.
  if (spawnError) throw spawnError;
  if (code !== 0) {
    throw new RepoError(`git log завершился с кодом ${code}:\n${stderr.trim()}`);
  }
  if (streamError) {
    const message = streamError instanceof Error ? streamError.message : String(streamError);
    throw new RepoError(`Чтение вывода git log прервалось: ${message}`);
  }
  yield* parser.flush();
}
