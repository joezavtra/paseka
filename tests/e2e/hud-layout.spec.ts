import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

/**
 * Пересекаются ли прямоугольники строки состояния и панели транспорта.
 * Проверяем именно геометрию, а не кликабельность: `pointer-events: none`
 * пропускает клики сквозь строку состояния, поэтому сквозной тест по кликам
 * оставался зелёным, пока текст закрывал кнопку и список скорости.
 */
async function hudOverlap(page: Page): Promise<{ overlap: boolean; boxes: string }> {
  const status = await page.locator('#status').boundingBox();
  const transport = await page.locator('#transport').boundingBox();
  if (!status || !transport) throw new Error('Не найден один из элементов HUD');
  const overlap =
    status.x < transport.x + transport.width &&
    transport.x < status.x + status.width &&
    status.y < transport.y + transport.height &&
    transport.y < status.y + status.height;
  return { overlap, boxes: `status=${JSON.stringify(status)} transport=${JSON.stringify(transport)}` };
}

test('строка состояния не перекрывает панель транспорта ни при какой ширине', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'первый', write: { 'src/a.ts': 'a\n', 'README.md': 'hi\n' } },
    { message: 'второй', write: { 'src/deep/b.ts': 'x\n', 'docs/c.md': 'y\n' } },
  ]);

  cli = await startCli(repo);

  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#transport')).toBeVisible();

  for (const width of [1440, 1024, 700, 420]) {
    await page.setViewportSize({ width, height: 800 });
    // Строка состояния бывает длинной: проверяем и на искусственно длинном тексте.
    await page.evaluate(() => {
      const status = document.getElementById('status')!;
      status.dataset.saved = status.textContent ?? '';
      status.textContent = `${status.textContent} · ${'очень длинное имя репозитория '.repeat(6)}`;
    });
    const long = await hudOverlap(page);
    expect(long.overlap, `ширина ${width}, длинный текст: ${long.boxes}`).toBe(false);

    await page.evaluate(() => {
      const status = document.getElementById('status')!;
      status.textContent = status.dataset.saved ?? '';
    });
    const normal = await hudOverlap(page);
    expect(normal.overlap, `ширина ${width}: ${normal.boxes}`).toBe(false);
  }

  // Отдельно про кнопку воспроизведения и список скорости: именно их закрывал
  // текст. `elementFromPoint` здесь не годится — строка состояния объявлена
  // `pointer-events: none` и в попадание не попадает, хотя рисуется поверх.
  const covered = await page.evaluate(() => {
    const status = document.getElementById('status')!.getBoundingClientRect();
    const hits = (selector: string): boolean => {
      const box = document.querySelector(selector)!.getBoundingClientRect();
      return (
        status.left < box.right &&
        box.left < status.right &&
        status.top < box.bottom &&
        box.top < status.bottom
      );
    };
    return { button: hits('#transport button'), speed: hits('#transport select') };
  });
  expect(covered.button).toBe(false);
  expect(covered.speed).toBe(false);
});
