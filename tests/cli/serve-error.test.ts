import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Запускаем CLI на заведомо несуществующем пути через tsx по исходникам —
 * это не требует `npm run build:node`. Но `run` проверяет наличие web-бандла
 * (dist/web/index.html) раньше, чем стартует сервер: если бандла нет, CLI
 * выходит по этой более ранней ветке и код, который тест призван защищать
 * (закрытие сервера при RepoError через `finally`), вообще не исполняется —
 * при этом код возврата всё равно ненулевой и таймаута нет, тест «проходит»,
 * ничего не проверив. Поэтому здесь гарантируется минимальная заглушка
 * dist/web/index.html (без реального `npm run build:web`) и, вдобавок к коду
 * возврата, проверяется точный текст сообщения об ошибке в stderr — именно
 * про репозиторий, а не про несобранный бандл. Так подмена пути становится
 * заметной: если она произойдёт, упадёт assert на содержимом stderr.
 */
const distWebDir = join(process.cwd(), 'dist', 'web');
const indexHtml = join(distWebDir, 'index.html');
let createdDistWebDir = false;
let createdIndexHtml = false;

beforeAll(async () => {
  try {
    await access(indexHtml);
  } catch {
    try {
      await access(distWebDir);
    } catch {
      createdDistWebDir = true;
    }
    await mkdir(distWebDir, { recursive: true });
    await writeFile(indexHtml, '<!doctype html><title>stub for tests</title>');
    createdIndexHtml = true;
  }
});

afterAll(async () => {
  if (createdIndexHtml) await rm(indexHtml, { force: true });
  if (createdDistWebDir) await rm(distWebDir, { recursive: true, force: true });
});

describe('run (процесс)', () => {
  it(
    'при ошибке репозитория закрывает сервер сам, не подвешивая процесс',
    async () => {
      const child = spawn(
        'npx',
        ['tsx', 'src/cli/main.ts', '/does/not/exist/gource-reborn-e2e', '--port', '0', '--no-open'],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );

      let stderr = '';
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve({ code: null, timedOut: true });
        }, 15_000);
        child.once('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, timedOut: false });
        });
      });

      expect(result.timedOut).toBe(false);
      expect(result.code).not.toBe(0);
      // Утверждаем именно путь через RepoError (см. src/git/repo.ts), а не
      // отсутствие web-бандла — иначе тест не отличит защищаемый сценарий от
      // совершенно другого раннего выхода с тем же итоговым кодом.
      expect(stderr).toContain('не является git-репозиторием');
      expect(stderr).not.toContain('Веб-часть не собрана');
    },
    20_000,
  );
});
