import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: ChildProcess | null = null;

test.afterAll(async () => {
  cli?.kill('SIGTERM');
  await cleanupRepos();
});

/** Число живых узлов страница показывает в строке статуса. */
async function liveNodes(text: string | null): Promise<number> {
  const match = (text ?? '').match(/узлов: (\d+)/);
  return match ? Number(match[1]) : -1;
}

test('воспроизведение выращивает дерево, перемотка возвращает назад', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', write: { 'a.txt': 'a\n' } },
    { message: 'второй', write: { 'src/b.ts': 'b\n' } },
    { message: 'третий', write: { 'src/c.ts': 'c\n' } },
    { message: 'четвёртый', write: { 'src/deep/d.ts': 'd\n' } },
    { message: 'пятый', write: { 'docs/e.md': 'e\n' } },
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
  await expect(page.locator('#transport')).toBeVisible();

  // Перематываем в начало: должно остаться пусто.
  await page.locator('#track input').fill('-1');
  await expect
    .poll(async () => liveNodes(await page.locator('#status').textContent()))
    .toBe(0);

  // Запускаем воспроизведение — дерево обязано вырасти.
  await page.locator('#transport button').click();
  await expect
    .poll(async () => liveNodes(await page.locator('#status').textContent()), { timeout: 20_000 })
    .toBeGreaterThan(5);
  await expect(page.locator('#cursor-label')).toContainText('·');

  // Пауза и перемотка назад — дерево обязано уменьшиться.
  await page.locator('#transport button').click();
  await page.locator('#track input').fill('0');
  await expect
    .poll(async () => liveNodes(await page.locator('#status').textContent()))
    .toBe(2);
});
