import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: ChildProcess | null = null;

test.afterAll(async () => {
  cli?.kill('SIGTERM');
  await cleanupRepos();
});

function authorCount(text: string | null): number {
  const match = (text ?? '').match(/авторов: (\d+)/);
  return match ? Number(match[1]) : -1;
}

test('во время воспроизведения появляются авторы и гаснут после паузы', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', author: { name: 'Аня Петрова', email: 'anya@e.com' }, write: { 'a.txt': 'a\n' } },
    { message: 'второй', author: { name: 'Бо Ли', email: 'bo@e.com' }, write: { 'src/b.ts': 'b\n' } },
    { message: 'третий', author: { name: 'Аня Петрова', email: 'anya@e.com' }, write: { 'src/c.ts': 'c\n' } },
    { message: 'четвёртый', author: { name: 'Бо Ли', email: 'bo@e.com' }, write: { 'docs/d.md': 'd\n' } },
    { message: 'пятый', author: { name: 'Аня Петрова', email: 'anya@e.com' }, write: { 'e.md': 'e\n' } },
  ]);

  cli = spawn('node', ['dist/node/cli/main.js', repo, '--port', '0', '--no-open'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`CLI не напечатал URL:\n${out}`)), 30_000);
    cli!.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });

  await page.goto(url);
  await page.waitForSelector('canvas[data-ready="true"]');

  // В покое на HEAD авторов быть не должно: никто ничего только что не трогал.
  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()))
    .toBe(0);

  await page.locator('#track input').fill('-1');
  await page.locator('#transport button').click();

  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Пауза и ожидание дольше жизни луча — авторы обязаны погаснуть сами.
  await page.locator('#transport button').click();
  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()), { timeout: 10_000 })
    .toBe(0);
});
