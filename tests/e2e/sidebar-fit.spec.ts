import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

interface DrawnBounds {
  left: number;
  right: number;
  center: number;
}

/**
 * Горизонтальные границы нарисованного в координатах страницы (CSS-пикселях, а
 * не в пикселях устройства: холст масштабируется под devicePixelRatio, и
 * сравнивать его с прямоугольником панели можно, только приведя к одной мере).
 * Возвращает null, пока не нарисовано ничего.
 *
 * Проверять одну лишь левую границу мало: вписывание берёт масштаб по более
 * тесной из двух осей, и на дереве, которое выше, чем шире, картинка и без
 * всякого запаса слева окажется уже панели — тест был бы зелёным при полностью
 * сломанном вписывании. Середина же нарисованного говорит прямо, в какой
 * прямоугольник вписывались: во всё окно или в свободную от панели часть.
 */
async function drawnBounds(page: Page): Promise<DrawnBounds | null> {
  return page.evaluate(() => {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dpr = canvas.width / canvas.clientWidth;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! === 0) continue;
      const x = ((i - 3) / 4) % canvas.width;
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (!Number.isFinite(left)) return null;
    return { left: left / dpr, right: right / dpr, center: (left + right) / 2 / dpr };
  });
}

test('автовписывание оставляет дерево справа от боковой панели', async ({ page }) => {
  // Тот же случай, что и в filtering.spec.ts: до 30 с на запуск CLI плюс до
  // 20 с ожидания раскладки плюс сам цикл замеров подходят к общему пределу в
  // 60 с. На нагруженной машине тест упрётся в него раньше, чем в собственный
  // дедлайн, и вместо внятной причины выдаст сообщение о таймауте теста.
  test.setTimeout(120_000);

  const repo = await makeRepo([
    {
      message: 'первый',
      write: {
        'src/a.ts': 'a\n',
        'src/deep/b.ts': 'b\n',
        'src/deep/more/c.ts': 'c\n',
        'docs/d.md': 'd\n',
        'docs/guide/e.md': 'e\n',
        'tests/f.test.ts': 'f\n',
        'README.md': 'hi\n',
      },
    },
    {
      message: 'второй',
      write: { 'src/g.ts': 'g\n', 'web/h.ts': 'h\n', 'web/ui/i.ts': 'i\n' },
    },
  ]);

  cli = await startCli(repo);
  // Окно шириной 1280 — та самая ширина, на которой находка и наблюдалась.
  const viewport = { width: 1280, height: 800 };
  await page.setViewportSize(viewport);
  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#sidebar')).toBeVisible();

  const panel = await page.locator('#sidebar').boundingBox();
  if (!panel) throw new Error('Боковая панель не нашлась на странице');
  const panelRight = panel.x + panel.width;
  // Справа окно тоже занято: там колонка с настройками физики и карточкой узла.
  // Свободная полоса — между панелями, а не до края окна; без этого тест
  // требовал бы от камеры центрировать дерево под правой колонкой.
  const rail = await page.locator('#right-rail').boundingBox();
  const railLeft = rail && rail.width > 0 ? rail.x : viewport.width;
  /** Куда обязана прийтись середина картинки: центр свободной от панелей полосы. */
  const freeCenter = panelRight + (railLeft - panelRight) / 2;

  // Пока раскладка расходится, камера подстраивается на каждом сообщении —
  // смотрим не один кадр, а весь этот отрезок: под панелью не должно оказаться
  // узлов ни на старте, ни после того, как дерево разошлось.
  await expect.poll(async () => (await drawnBounds(page)) !== null, { timeout: 20_000 }).toBe(true);

  let worstLeft = Number.POSITIVE_INFINITY;
  let worstCenter = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 16; i++) {
    const bounds = await drawnBounds(page);
    if (bounds) {
      if (bounds.left < worstLeft) worstLeft = bounds.left;
      if (bounds.center < worstCenter) worstCenter = bounds.center;
    }
    await page.waitForTimeout(250);
  }

  expect(
    worstLeft,
    `самый левый нарисованный пиксель ${worstLeft}, правый край панели ${panelRight}`,
  ).toBeGreaterThanOrEqual(panelRight);

  // Допуск в 60 точек — на асимметрию радиусов узлов по краям облака: границы
  // меряются по пикселям, а вписывается облако центров.
  expect(
    Math.abs(worstCenter - freeCenter),
    `середина картинки ${worstCenter}, центр свободной полосы ${freeCenter} (панель справа от ${panelRight}, колонка слева от ${railLeft})`,
  ).toBeLessThan(60);
});
