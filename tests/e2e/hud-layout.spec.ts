import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

/** Каждый тест поднимает свой CLI; останавливаем все разом в конце файла. */
const started: RunningCli[] = [];

test.afterAll(async () => {
  for (const cli of started) cli.stop();
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

  const cli = await startCli(repo);
  started.push(cli);

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

/**
 * Ширина дорожки перемотки обязана зависеть только от ширины окна.
 *
 * Пока подпись под курсором стояла с дорожкой в одной строке, дорожка отдавала
 * ей ширину по длине темы коммита: тема в два слова — дорожка длинная, тема из
 * пул-реквеста на полстроки — короткая. На каждом шаге воспроизведения дорожка
 * меняла длину, и прицелиться в нужное место истории было невозможно — пока
 * рука вела мышь, координата под курсором успевала означать другой коммит.
 */
test('ширина дорожки не зависит от длины подписи под курсором', async ({ page }) => {
  const repo = await makeRepo([
    { message: 'а', write: { 'src/a.ts': 'a\n' } },
    {
      message:
        'Merge pull request #128 from acme/feature/very-long-branch-name: переписать раскладку, ' +
        'починить перемотку и заодно обновить документацию по всем затронутым модулям',
      write: { 'src/b.ts': 'b\n' },
    },
    { message: 'в', write: { 'src/c.ts': 'c\n' } },
  ]);

  const cli = await startCli(repo);
  started.push(cli);

  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#transport')).toBeVisible();

  const slider = page.locator('#track input');

  /** Ширина дорожки и текст подписи на указанном коммите. */
  const at = async (index: number): Promise<{ width: number; label: string }> => {
    await slider.fill(String(index));
    const box = await page.locator('#track').boundingBox();
    if (!box) throw new Error('Дорожка не найдена');
    const label = (await page.locator('#cursor-label').textContent()) ?? '';
    return { width: box.width, label };
  };

  for (const width of [1440, 1024, 700]) {
    await page.setViewportSize({ width, height: 800 });

    const short = await at(0);
    const long = await at(1);
    const shortAgain = await at(2);

    // Тест сторожит что-то, только если подписи действительно разной длины.
    expect(
      long.label.length,
      `ширина ${width}: подписи должны отличаться длиной, иначе проверка ничего не значит`,
    ).toBeGreaterThan(short.label.length + 40);

    expect(long.width, `ширина ${width}: ${short.label} -> ${long.label}`).toBe(short.width);
    expect(shortAgain.width, `ширина ${width}: возврат к короткой теме`).toBe(short.width);
  }

  // И сама подпись не должна вылезать за панель: длинная тема обрезается.
  const fits = await page.evaluate(() => {
    const label = document.getElementById('cursor-label')!.getBoundingClientRect();
    const panel = document.getElementById('transport')!.getBoundingClientRect();
    return label.right <= panel.right + 0.5 && label.left >= panel.left - 0.5;
  });
  expect(fits).toBe(true);
});
