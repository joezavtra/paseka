import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

/**
 * Сумма непрозрачности холста. Гашение фильтром уменьшает её, но не обнуляет:
 * именно этим «гасит» отличается от «скрывает».
 */
async function brightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i]!;
    return sum;
  });
}

/**
 * Готовность холста (`data-ready`) не значит, что картинка устоялась: сразу
 * после неё раскладка ещё расходится из тесного стартового кома, а камера
 * непрерывно подстраивает масштаб под неё — на репозитории из этого теста
 * суммарная непрозрачность в первые секунды меняется в разы (замерено:
 * 16.6M сразу после готовности → плавно затухает до устойчивых ~915–930K
 * к шестой-восьмой секунде) по причинам, вообще не связанным с фильтром.
 * `first-frame.spec.ts` уже обходил ровно этот же зазор
 * фиксированной паузой перед проверкой пикселей — здесь фиксированная пауза
 * не годится вдвойне, потому что яркость меряется дважды за тест (эталон и
 * состояние после фильтра), и обе точки должны быть одинаково устоявшимися.
 * Короткая пауза на медленной машине окажется недостаточной, а с запасом —
 * лишней и раздувающей тест. Вместо паузы опрашиваем яркость, пока несколько
 * подряд замеров не перестанут заметно отличаться — то есть пока раскладка и
 * камера не остановятся сами, а не по внешним часам.
 *
 * Окно и порог подобраны по факту: спад после старта не монотонно резкий, а
 * плавно затухающий (силовая раскладка гасит температуру постепенно), и на
 * коротком окне в пару сотен миллисекунд последовательные замеры сходятся
 * между собой заметно раньше, чем яркость доходит до истинного плато —
 * поэтому окно взято на секунду, а не на три замера подряд.
 */
async function stableBrightness(page: Page): Promise<number> {
  const POLL_MS = 250;
  const STREAK = 5;
  const TOLERANCE = 0.015;
  const DEADLINE_MS = 20_000;
  const deadline = Date.now() + DEADLINE_MS;
  const recent: number[] = [];
  for (;;) {
    const value = await brightness(page);
    recent.push(value);
    if (recent.length > STREAK) recent.shift();
    if (recent.length === STREAK) {
      const max = Math.max(...recent);
      const min = Math.min(...recent);
      if (max - min <= max * TOLERANCE) return value;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Яркость холста не стабилизировалась за ${DEADLINE_MS} мс: последние замеры ${recent.join(', ')}`,
      );
    }
    await page.waitForTimeout(POLL_MS);
  }
}

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
