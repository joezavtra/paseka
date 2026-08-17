import { describe, it, expect, afterAll } from 'vitest';
import { CliError, collectPack, formatStats, parseArgs, run } from '../../src/cli/main.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

afterAll(cleanupRepos);

describe('parseArgs', () => {
  it('по умолчанию берёт текущую папку и открывает браузер', () => {
    const o = parseArgs([]);
    expect(o.repoPath).toBe(process.cwd());
    expect(o.open).toBe(true);
    expect(o.stats).toBe(false);
  });

  it('читает путь и флаги', () => {
    const o = parseArgs(['/tmp/x', '--port', '9000', '--no-open', '--stats']);
    expect(o).toEqual({
      repoPath: '/tmp/x',
      port: 9000,
      open: false,
      stats: true,
      help: false,
    });
  });

  it('отвергает нечисловой порт понятным сообщением', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(CliError);
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/целым числом/);
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/abc/);
    expect(() => parseArgs(['--port', '80.5'])).toThrow(/целым числом/);
    expect(() => parseArgs(['--port', ''])).toThrow(/целым числом/);
  });

  it('отвергает порт вне диапазона 0..65535', () => {
    expect(() => parseArgs(['--port', '99999'])).toThrow(CliError);
    expect(() => parseArgs(['--port', '99999'])).toThrow(/от 0 до 65535/);
    // Отрицательное значение приходится писать через «=»: иначе node:util
    // считает `-1` отдельным флагом, а не аргументом `--port`.
    expect(() => parseArgs(['--port=-1'])).toThrow(/от 0 до 65535/);
  });

  it('оставляет 0 допустимым портом — это просьба выбрать свободный', () => {
    expect(parseArgs(['--port', '0']).port).toBe(0);
    expect(parseArgs(['--port', '65535']).port).toBe(65535);
  });

  it('объясняет по-русски неизвестный флаг', () => {
    expect(() => parseArgs(['--porrt', '9000'])).toThrow(CliError);
    expect(() => parseArgs(['--porrt', '9000'])).toThrow(/Не удалось разобрать аргументы/);
  });
});

describe('run', () => {
  it('--help печатает справку, возвращает 0 и не трогает репозиторий', async () => {
    const code = await run(['--help', '/does/not/exist']);
    expect(code).toBe(0);
  });
});

describe('collectPack', () => {
  it('собирает pack из настоящего репозитория', async () => {
    const root = await makeRepo([
      { message: 'первый', write: { 'src/a.ts': 'x\ny\n', 'README.md': 'hi\n' } },
      { message: 'второй', remove: ['src/a.ts'] },
    ]);

    const pack = await collectPack(root);
    expect(pack.meta.commitCount).toBe(2);
    expect(pack.paths).toContain('README.md');
    expect(pack.paths).toContain('src/a.ts');

    const summary = formatStats(pack);
    expect(summary).toContain('коммитов: 2');
    expect(summary).toContain('авторов: 1');
    // Пути: 'src', 'src/a.ts', 'README.md'; синтетический корень не в счёт.
    expect(summary).toContain('путей: 3 (файлов: 2)');
  });
});
