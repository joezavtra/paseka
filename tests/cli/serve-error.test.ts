import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

describe('run (процесс)', () => {
  it(
    'при ошибке репозитория завершается сам с ненулевым кодом, не подвешивая сервер',
    async () => {
      // Запускаем CLI на заведомо несуществующем пути через tsx по исходникам,
      // чтобы тест не зависел от предварительной сборки. Если сервер стартовал
      // до ошибки и не закрылся при перехвате RepoError, процесс никогда не
      // завершится сам и тест упрётся в таймаут ниже.
      const child = spawn(
        'npx',
        ['tsx', 'src/cli/main.ts', '/does/not/exist/gource-reborn-e2e', '--port', '0', '--no-open'],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      );

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
    },
    20_000,
  );
});
