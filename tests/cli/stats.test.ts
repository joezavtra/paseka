import { describe, it, expect, afterAll } from 'vitest';
import { collectPack, formatStats, parseArgs, run } from '../../src/cli/main.js';
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
  });
});
