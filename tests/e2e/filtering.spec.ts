import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';
import { stableBrightness } from '../helpers/canvas.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

async function liveNodes(page: Page): Promise<number> {
  const text = await page.locator('#status').textContent();
  const match = (text ?? '').match(/узлов: (\d+)/);
  return match ? Number(match[1]) : -1;
}

test('фильтр гасит, а видимость убирает', async ({ page }) => {
  // Общий таймаут в 60 с этому тесту мал: он трижды ждёт стабилизации яркости
  // с дедлайном в 20 с каждый, плюс до 30 с на запуск процесса CLI. На
  // нагруженной машине сумма перевалит за общий предел раньше, чем сработает
  // собственный дедлайн, и вместо внятного «яркость не стабилизировалась»
  // получится бесполезное сообщение о превышении таймаута теста.
  test.setTimeout(180_000);

  const repo = await makeRepo([
    {
      message: 'первый',
      author: { name: 'Аня Петрова', email: 'anya@e.com' },
      write: { 'src/a.ts': 'a\n', 'src/deep/b.ts': 'b\n' },
    },
    {
      message: 'второй',
      author: { name: 'Бо Ли', email: 'bo@e.com' },
      write: { 'docs/c.md': 'c\n', 'docs/d.md': 'd\n' },
    },
    {
      message: 'третий',
      author: { name: 'Аня Петрова', email: 'anya@e.com' },
      write: { 'src/e.ts': 'e\n' },
    },
  ]);

  cli = await startCli(repo);
  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#sidebar')).toBeVisible();

  const nodesAtStart = await liveNodes(page);
  const full = await stableBrightness(page);
  expect(full).toBeGreaterThan(0);

  // Снимаем одного автора: его файлы обязаны погаснуть, но остаться на сцене.
  await page.locator('#sidebar input[data-author="1"]').uncheck();
  const dimmed = await stableBrightness(page);
  expect(dimmed).toBeLessThan(full * 0.9);
  expect(dimmed).toBeGreaterThan(0);
  expect(await liveNodes(page)).toBe(nodesAtStart);

  // Возвращаем — яркость должна восстановиться.
  await page.locator('#sidebar input[data-author="1"]').check();
  const restored = await stableBrightness(page);
  expect(restored).toBeGreaterThan(full * 0.95);

  // Скрываем папку: здесь узлы действительно уходят.
  const firstFolder = page.locator('#sidebar input[data-hide]').first();
  const hiddenFolderId = await firstFolder.getAttribute('data-hide');
  await firstFolder.uncheck();
  await expect.poll(async () => liveNodes(page), { timeout: 5_000 }).toBeLessThan(nodesAtStart);
  const afterHide = await liveNodes(page);

  // Выбор обязан пережить перезагрузку страницы — и скрытой должна остаться
  // ровно та же папка, а не соседняя: видимость хранится строками путей, и
  // проверять её надо по имени папки, а не по «первой в списке».
  await page.reload();
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect.poll(async () => liveNodes(page), { timeout: 20_000 }).toBe(afterHide);
  await expect(page.locator(`#sidebar input[data-hide="${hiddenFolderId}"]`)).not.toBeChecked();
  const others = page.locator(`#sidebar input[data-hide]:not([data-hide="${hiddenFolderId}"])`);
  const otherCount = await others.count();
  expect(otherCount).toBeGreaterThan(0);
  for (let i = 0; i < otherCount; i++) await expect(others.nth(i)).toBeChecked();

  // Возвращаем и сворачиваем ту же папку: узлов меньше, но сама папка на месте.
  await page.locator('#sidebar input[data-hide]').first().check();
  await expect.poll(async () => liveNodes(page), { timeout: 5_000 }).toBe(nodesAtStart);
  await page.locator('#sidebar button[data-collapse]').first().click();
  await expect.poll(async () => liveNodes(page), { timeout: 5_000 }).toBeLessThan(nodesAtStart);
  expect(await liveNodes(page)).toBeGreaterThan(afterHide);
});
