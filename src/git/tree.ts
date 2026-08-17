import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RepoError } from './repo.js';

const run = promisify(execFile);

/**
 * Пути всех файлов в дереве HEAD. Нужны для сверки: при `--no-merges`
 * удаление, записанное только в коммите слияния, до модели не доходит,
 * и файл остаётся живым, хотя в рабочем дереве его давно нет.
 */
export async function listHeadFiles(root: string): Promise<Set<string>> {
  try {
    const { stdout } = await run(
      'git',
      ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', 'HEAD'],
      { cwd: root, maxBuffer: 1 << 28 },
    );
    const files = new Set<string>();
    for (const line of stdout.split('\n')) {
      if (line.length > 0) files.add(line);
    }
    return files;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    const stderr = err.stderr?.trim();
    throw new RepoError(
      `Не удалось прочитать дерево HEAD: ${stderr ? stderr : err.message.trim()}`,
    );
  }
}
