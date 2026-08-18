import { test, expect } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
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

  cli = await startCli(repo);

  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');

  // В покое на HEAD авторов быть не должно: никто ничего только что не трогал.
  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()))
    .toBe(0);

  await page.locator('#track input').fill('-1');
  const playButton = page.locator('#transport button');
  await playButton.click();

  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Доступное имя кнопки меняется вместе с состоянием воспроизведения. Ждём,
  // что оно действительно «Пауза», прежде чем нажимать: пять коммитов на
  // скорости по умолчанию проигрываются за пару секунд и сами останавливаются
  // в конце истории — слепой клик мог бы попасть по уже отыгранной кнопке
  // «Воспроизвести» и вместо паузы запустить показ заново с начала.
  await expect(playButton).toHaveAttribute('aria-label', 'Пауза (пробел)');
  await playButton.click();

  // Пауза и ожидание дольше жизни луча — авторы обязаны погаснуть сами.
  await expect
    .poll(async () => authorCount(await page.locator('#status').textContent()), { timeout: 10_000 })
    .toBe(0);
});
