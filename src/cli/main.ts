import { parseArgs as parseNodeArgs } from 'node:util';
import { inspectRepo, RepoError } from '../git/repo.js';
import { streamCommits } from '../git/log-stream.js';
import { buildPack } from '../model/build.js';
import type { Pack } from '../model/types.js';
import type { RawCommit } from '../git/types.js';

export interface CliOptions {
  repoPath: string;
  port: number;
  open: boolean;
  stats: boolean;
}

const USAGE = `gource-reborn — интерактивная визуализация истории git

  npx gource-reborn [путь]

  --port <n>   порт локального сервера (по умолчанию 7420)
  --no-open    не открывать браузер
  --stats      напечатать сводку и выйти
  --help       показать эту справку
`;

export function parseArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      open: { type: 'boolean', default: true },
      // node:util parseArgs не умеет автоматически превращать булев флаг
      // `open` в отрицание по `--no-open` — заводим отдельную опцию и
      // объединяем значения вручную.
      'no-open': { type: 'boolean', default: false },
      stats: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
  }

  return {
    repoPath: positionals[0] ?? process.cwd(),
    port: values.port ? Number(values.port) : 7420,
    open: values['no-open'] ? false : values.open !== false,
    stats: values.stats === true,
  };
}

/** Читает историю репозитория и собирает pack, сообщая о прогрессе. */
export async function collectPack(
  repoPath: string,
  onProgress?: (commits: number) => void,
): Promise<Pack> {
  const info = await inspectRepo(repoPath);
  if (info.shallow) {
    process.stderr.write(
      'Предупреждение: репозиторий склонирован частично (shallow), история обрезана.\n',
    );
  }

  const commits: RawCommit[] = [];
  for await (const commit of streamCommits(info.root)) {
    commits.push(commit);
    if (onProgress && commits.length % 500 === 0) onProgress(commits.length);
  }
  onProgress?.(commits.length);

  return buildPack(commits, { repoName: info.name, head: info.head });
}

export function formatStats(pack: Pack): string {
  const files = [...pack.pathIsDir].filter((d) => d === 0).length;
  const span =
    pack.meta.commitCount > 0
      ? `${new Date(pack.meta.firstTs * 1000).toISOString().slice(0, 10)} — ` +
        `${new Date(pack.meta.lastTs * 1000).toISOString().slice(0, 10)}`
      : '—';
  return [
    `репозиторий: ${pack.meta.repoName} (${pack.meta.head})`,
    `коммитов: ${pack.meta.commitCount}`,
    `авторов: ${pack.authors.length}`,
    `путей: ${pack.meta.pathCount} (файлов: ${files})`,
    `изменений файлов: ${pack.eventPath.length}`,
    `период: ${span}`,
  ].join('\n');
}

export async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  try {
    const pack = await collectPack(options.repoPath, (n) => {
      process.stderr.write(`\rпрочитано коммитов: ${n}`);
    });
    process.stderr.write('\r\x1b[K');
    process.stdout.write(`${formatStats(pack)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof RepoError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
