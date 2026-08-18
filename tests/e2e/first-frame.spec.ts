import { test, expect } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

test('показывает дерево репозитория в браузере', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', write: { 'src/a.ts': 'a\nb\nc\n', 'README.md': 'hi\n' } },
    { message: 'второй', write: { 'src/deep/b.ts': 'x\n', 'docs/c.md': 'y\n' } },
    { message: 'третий', remove: ['README.md'] },
  ]);

  cli = await startCli(repo);

  await page.goto(cli.url);
  await expect(page.locator('#status')).toContainText('3 коммита');
  await page.waitForSelector('canvas[data-ready="true"]');

  // Ждём, пока симуляция расставит узлы, и проверяем, что на холсте есть пиксели.
  await page.waitForTimeout(3000);
  const painted = await page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) opaque++;
    return opaque;
  });
  expect(painted).toBeGreaterThan(500);
});
