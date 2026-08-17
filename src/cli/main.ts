import { realpathSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { parseArgs as parseNodeArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { inspectRepo, RepoError } from '../git/repo.js';
import { streamCommits } from '../git/log-stream.js';
import { listHeadFiles } from '../git/tree.js';
import { buildPack } from '../model/build.js';
import type { Pack } from '../model/types.js';
import type { RawCommit } from '../git/types.js';
import { startServer } from '../server/serve.js';
import { encodePack } from '../pack/encode.js';
import { openBrowser } from './open-browser.js';

export interface CliOptions {
  repoPath: string;
  port: number;
  open: boolean;
  stats: boolean;
  help: boolean;
}

/** Ошибка в том, как запустили команду; текст рассчитан на показ пользователю. */
export class CliError extends Error {}

const USAGE = `gource-reborn — интерактивная визуализация истории git

  npx gource-reborn [путь]

  --port <n>   порт локального сервера (по умолчанию 7420)
  --no-open    не открывать браузер
  --stats      напечатать сводку и выйти
  --help       показать эту справку
`;

const DEFAULT_PORT = 7420;
const MAX_PORT = 65535;

/**
 * Порт должен быть целым числом от 0 до 65535; ноль допустим и означает
 * «попроси свободный порт у системы». Без этой проверки `--port abc`
 * превращался в NaN, а `--port 99999` доезжал до server.listen и падал
 * англоязычным стектрейсом Node.
 */
function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;

  const text = raw.trim();
  const port = text === '' ? Number.NaN : Number(text);
  if (!Number.isInteger(port)) {
    throw new CliError(`Порт должен быть целым числом, а получено «${raw}».`);
  }
  if (port < 0 || port > MAX_PORT) {
    throw new CliError(
      `Порт должен быть в диапазоне от 0 до ${MAX_PORT}, а получено ${port}. ` +
        'Ноль означает «выбрать свободный порт автоматически».',
    );
  }
  return port;
}

export function parseArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseNodeArgs({
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
  } catch (error) {
    // node:util сообщает об опечатках в флагах по-английски — заворачиваем в
    // русскую формулировку, оставляя исходный текст как уточнение.
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      `Не удалось разобрать аргументы командной строки: ${detail}\n` +
        'Список поддерживаемых флагов: gource-reborn --help',
    );
  }

  const { values, positionals } = parsed;
  return {
    repoPath: positionals[0] ?? process.cwd(),
    port: parsePort(values.port),
    open: values['no-open'] ? false : values.open !== false,
    stats: values.stats === true,
    help: values.help === true,
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

  const headFiles = await listHeadFiles(info.root);
  return buildPack(commits, { repoName: info.name, head: info.head, headFiles });
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
    // pathCount включает синтетический корень дерева — в сводке он лишний.
    `путей: ${pack.meta.pathCount - 1} (файлов: ${files})`,
    `изменений файлов: ${pack.eventPath.length}`,
    `период: ${span}`,
  ].join('\n');
}

/**
 * Каталог собранного web-бандла. В опубликованном пакете этот файл лежит в
 * dist/node/cli, то есть бандл — на два уровня выше в dist/web. При запуске из
 * исходников через tsx файл лежит в src/cli, и путь считается от корня проекта.
 * В обоих случаях бандл должен быть собран: `npm run build:web`.
 */
function resolveWebRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return here.includes(`${sep}dist${sep}`)
    ? join(here, '..', '..', 'web')
    : join(here, '..', '..', 'dist', 'web');
}

/** Проверяет, что web-бандл собран, прежде чем поднимать сервер и открывать вкладку. */
async function hasWebBundle(webRoot: string): Promise<boolean> {
  try {
    await access(join(webRoot, 'index.html'));
    return true;
  } catch {
    return false;
  }
}

export async function run(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const packPromise = collectPack(options.repoPath, (n) => {
    process.stderr.write(`\rпрочитано коммитов: ${n}`);
  });
  // packPromise создаётся раньше, чем на него где-либо подписываются: сервер
  // стартует до того, как pack готов, чтобы вкладка открывалась сразу. Если
  // промис отклонится в этом промежутке — до `await packPromise` ниже, — node
  // расценит отклонение как необработанное и уронит процесс. Гасим это здесь;
  // настоящая обработка ошибки всё равно происходит через `await` дальше.
  packPromise.catch(() => {});

  try {
    if (options.stats) {
      const pack = await packPromise;
      process.stderr.write('\r\x1b[K');
      process.stdout.write(`${formatStats(pack)}\n`);
      return 0;
    }

    const webRoot = resolveWebRoot();
    if (!(await hasWebBundle(webRoot))) {
      process.stderr.write(
        `\r\x1b[KВеб-часть не собрана: не найден ${join(webRoot, 'index.html')}.\n` +
          'Выполните `npm run build:web` (или `npm run build`) и запустите снова.\n',
      );
      return 1;
    }

    const server = await startServer({
      webRoot,
      port: options.port,
      getPack: async () => encodePack(await packPromise),
    });

    // Сервер поднят и держит цикл событий живым — при любом исходе ниже
    // (ошибка чтения репозитория, нормальная остановка) обязаны его закрыть,
    // иначе процесс зависнет и не отдаст управление даже после вывода ошибки.
    try {
      // Адрес и вкладка — сразу, не дожидаясь конца парсинга: /api/pack ответит,
      // когда pack будет готов, а до тех пор страница показывает свой статус
      // «Читаю историю репозитория…». Иначе на больших репозиториях пользователь
      // десятки секунд смотрит в пустой терминал.
      process.stderr.write('\r\x1b[K');
      process.stdout.write(`${server.url}\nОстановить: Ctrl+C\n\n`);
      if (options.open) openBrowser(server.url);

      const pack = await packPromise;
      process.stderr.write('\r\x1b[K');
      process.stdout.write(`${formatStats(pack)}\n`);

      await new Promise<void>((done) => {
        const stop = () => done();
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return 0;
    } finally {
      await server.close();
    }
  } catch (error) {
    if (error instanceof RepoError) {
      process.stderr.write(`\r\x1b[K${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/**
 * Определяет, запущен ли модуль напрямую как исполняемый файл (а не
 * импортирован тестами). Сравнивать `import.meta.url` с сырым
 * `process.argv[1]` нельзя: npm ставит бинарники симлинками
 * (`bin.gource-reborn` в package.json), `process.argv[1]` при запуске через
 * симлинк остаётся путём симлинка, а `import.meta.url` резолвится в
 * реальный путь файла — строки никогда не совпадут. Поэтому разыменовываем
 * оба пути перед сравнением; любая неудача (файла нет, путь не задан)
 * означает «не главный модуль», а не падение CLI.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // Любая ошибка на точке входа — это сообщение пользователю, а не дамп Node:
  // без этого обработчика опечатка во флаге или сбой внутри `run` печатались
  // англоязычным стектрейсом необработанного отклонения промиса.
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`\r\x1b[KНе удалось выполнить команду: ${detail}\n`);
      process.exitCode = 1;
    },
  );
}
