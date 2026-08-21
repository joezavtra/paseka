import { execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Ошибка с текстом, который не стыдно показать пользователю в терминале. */
export class RepoError extends Error {}

export interface RepoInfo {
  root: string;
  name: string;
  head: string;
  shallow: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 1 << 20 });
    return stdout.trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === 'ENOENT') {
      throw new RepoError('git не найден в PATH. Установите git и повторите.');
    }
    const stderrText = err.stderr?.trim();
    throw new RepoError(stderrText ? stderrText : err.message.trim());
  }
}

export async function inspectRepo(cwd: string): Promise<RepoInfo> {
  const dir = resolve(cwd);
  let root: string;
  try {
    root = await git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new RepoError(
      `${dir} не является git-репозиторием. Запустите paseka внутри репозитория ` +
        'или укажите путь к нему аргументом.',
    );
  }

  let head: string;
  try {
    head = await git(root, ['rev-parse', '--short', 'HEAD']);
  } catch {
    throw new RepoError('В репозитории нет ни одного коммита — визуализировать нечего.');
  }

  const shallow = (await git(root, ['rev-parse', '--is-shallow-repository'])) === 'true';
  return { root, name: basename(root), head, shallow };
}
