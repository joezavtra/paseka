import { basename } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { startCli, type RunningCli } from '../helpers/cli.js';
import { makeRepo, cleanupRepos } from '../helpers/tmp-repo.js';
import { stableBrightness } from '../helpers/canvas.js';

let cli: RunningCli | null = null;

test.afterAll(async () => {
  cli?.stop();
  await cleanupRepos();
});

interface NodePixel {
  x: number;
  y: number;
}

/**
 * Ищет на холсте непрозрачный пиксель, который точно принадлежит дереву, а не
 * панелям поверх него: правее правого края боковой панели фильтров и выше
 * верхней границы HUD (строка статуса и панель транспорта прибиты к низу
 * экрана одной колонкой — верхний край этой колонки достаточно взять один
 * раз). Координаты узлов заранее неизвестны: раскладка силовая, а вписывание
 * камеры каждый раз усаживает дерево по-своему в зависимости от формы
 * репозитория и размера окна — единственный надёжный способ узнать, куда
 * кликнуть, это спросить сам холст через снимок его пикселей.
 *
 * Снимок берётся через `canvas.toDataURL()`, перерисованный в оффскрин-канву,
 * а не напрямую через `ctx.getImageData()` живой канвы — тот же приём и по
 * той же причине, что и в `stableCentroid` ниже (см. её докблок): под
 * нагрузкой параллельных воркеров Playwright прямое чтение изредка отдаёт
 * нечестный буфер. Здесь цена нечестного снимка ещё выше, чем при замере
 * центра масс: тест кликнул бы по пикселю, которого на самом деле нет, — либо
 * в пустоту, либо по случайно оказавшемуся там узлу.
 *
 * Пиксель ищется в координатах устройства (canvas.width/height уже умножены
 * на devicePixelRatio), а возвращается в CSS-пикселях (той же мере, в которой
 * измеряются панели и в которой Playwright кликает по странице) — без
 * деления координата систематически промахивалась бы мимо панели на любом
 * экране с dpr > 1.
 *
 * Бросает, если такого пикселя нет: тест обязан упасть с внятной причиной, а
 * не молча кликнуть в пустое место и получить ложно-зелёный результат на
 * незаполненном инспекторе.
 */
async function findNodePixel(page: Page): Promise<NodePixel> {
  const sidebarBox = await page.locator('#sidebar').boundingBox();
  const hudBox = await page.locator('#hud').boundingBox();
  if (!sidebarBox) throw new Error('Боковая панель #sidebar не нашлась на странице.');
  if (!hudBox) throw new Error('Панель #hud не нашлась на странице.');
  const sidebarRight = sidebarBox.x + sidebarBox.width;
  const hudTop = hudBox.y;

  const point = await page.evaluate(
    async ({ sidebarRight, hudTop }) => {
      const canvas = document.getElementById('scene') as HTMLCanvasElement;
      const img = new Image();
      const decoded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('не удалось декодировать снимок холста'));
      });
      img.src = canvas.toDataURL();
      await decoded;
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const octx = off.getContext('2d')!;
      octx.drawImage(img, 0, 0);
      const { data, width } = octx.getImageData(0, 0, off.width, off.height);
      const dpr = canvas.width / canvas.clientWidth;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) continue;
        const pixelIndex = (i - 3) / 4;
        const px = pixelIndex % width;
        const py = Math.floor(pixelIndex / width);
        const cssX = px / dpr;
        const cssY = py / dpr;
        if (cssX <= sidebarRight || cssY >= hudTop) continue;
        return { x: cssX, y: cssY };
      }
      return null;
    },
    { sidebarRight, hudTop },
  );

  if (!point) {
    throw new Error(
      `Не нашли на холсте непрозрачный пиксель узла правее панели фильтров ` +
        `(x > ${sidebarRight}) и выше HUD (y < ${hudTop}).`,
    );
  }
  return point;
}

interface Centroid {
  x: number;
  y: number;
}

function distance(a: Centroid, b: Centroid): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Ждёт, пока центр масс непрозрачных пикселей холста (в CSS-пикселях,
 * взвешенный по альфе) не перестанет заметно ползти, и возвращает устоявшееся
 * значение. Центр масс, а не побайтовый снимок: раскладка на этой горстке
 * узлов не замирает идеально даже после `stableBrightness` (см.
 * tests/helpers/canvas.ts, которая машет рукой на сумму непрозрачности, а не
 * на конкретные позиции) — узлы продолжают едва заметно дрожать. Побайтовое
 * сравнение холста поймало бы это дрожание как «картинка изменилась» даже
 * там, где камера не двигалась вовсе; центр масс усредняет дрожание отдельных
 * узлов почти до нуля, но остаётся чувствительным к настоящему сдвигу камеры:
 * `Camera.focusOn` переносит всё дерево целиком на один и тот же вектор, и
 * центр масс уезжает вместе с ним.
 *
 * Пиксели читаются не через `ctx.getImageData()` рисуемой канвы напрямую, а
 * через `canvas.toDataURL()`, перерисованный в оффскрин-канву и уже там
 * прочитанный. Разница не косметическая: под шестью параллельными воркерами
 * Playwright `getImageData()` на живой, ежекадрово перерисовываемой канве
 * изредка отдаёт нечестный буфер — два вызова подряд, без единого действия
 * между ними, возвращали разные пиксели (сама картинка при этом, снятая через
 * `toDataURL()` в те же моменты, была побайтово одинаковой — проверено
 * `pngjs` за пределами теста). Похоже на гонку между GPU-читкой канвы и её же
 * перерисовкой под нагрузкой, а не на поведение приложения. `toDataURL()`
 * кодирует PNG синхронно и требует состоявшегося кадра, поэтому даёт честный
 * снимок; отрисовка этого снимка на отдельной, не анимируемой канве и чтение
 * уже оттуда исключает гонку с циклом кадра совсем.
 *
 * Сам опрос идёт целиком внутри страницы одним вызовом `page.evaluate`, а не
 * циклом из Node с паузой между итерациями. На этой машине под шестью
 * параллельными воркерами Playwright именно непрерывное наблюдение стабильно
 * ловит настоящую картину, а опрос с паузами между круговыми поездками до
 * Node — нет: d3-force продолжает тикать заметно дольше, чем кажется по
 * редким замерам, и вкладка, конкурирующая за CPU с пятью такими же, может
 * несколько секунд не получать кадра вовсе, а затем разом досчитать
 * накопившиеся тики — событие, которое по чистой случайности может прийтись
 * ровно на паузу между двумя внешними замерами и остаться незамеченным, как
 * бы редко замеры ни шли и как бы долго ни длилось окно проверки (проверено
 * так: при внешнем опросе с паузами даже 32 замера подряд в допуске за 8 с не
 * гарантировали защиты — совпадение оставалось невидимым тому же самому
 * стороннему наблюдателю, который его искал). Наблюдение изнутри вкладки
 * устраняет этот зазор: между двумя последовательными замерами внутри одного
 * `while` нет никакой внешней паузы, которую могло бы поглотить голодание.
 */
async function stableCentroid(page: Page): Promise<Centroid> {
  const STREAK = 12;
  const TOLERANCE_PX = 0.4;
  const DEADLINE_MS = 30_000;

  const result = await page.evaluate(
    async ({ streak, tolerancePx, deadlineMs }) => {
      const canvas = document.getElementById('scene') as HTMLCanvasElement;
      const dpr = canvas.width / canvas.clientWidth;
      const centroidNow = async (): Promise<{ x: number; y: number }> => {
        const img = new Image();
        const decoded = new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('не удалось декодировать снимок холста'));
        });
        img.src = canvas.toDataURL();
        await decoded;
        const off = document.createElement('canvas');
        off.width = canvas.width;
        off.height = canvas.height;
        const octx = off.getContext('2d')!;
        octx.drawImage(img, 0, 0);
        const { data, width } = octx.getImageData(0, 0, off.width, off.height);
        let sumX = 0;
        let sumY = 0;
        let weight = 0;
        for (let i = 3; i < data.length; i += 4) {
          const alpha = data[i]!;
          if (alpha === 0) continue;
          const pixelIndex = (i - 3) / 4;
          sumX += (pixelIndex % width) * alpha;
          sumY += Math.floor(pixelIndex / width) * alpha;
          weight += alpha;
        }
        return weight === 0 ? { x: 0, y: 0 } : { x: sumX / weight / dpr, y: sumY / weight / dpr };
      };

      const started = performance.now();
      const recent: { x: number; y: number }[] = [];
      for (;;) {
        const value = await centroidNow();
        recent.push(value);
        if (recent.length > streak) recent.shift();
        if (recent.length === streak) {
          let maxDrift = 0;
          for (const sample of recent) {
            maxDrift = Math.max(maxDrift, Math.hypot(sample.x - recent[0]!.x, sample.y - recent[0]!.y));
          }
          if (maxDrift <= tolerancePx) return { settled: true as const, value, recent };
        }
        if (performance.now() - started > deadlineMs) {
          return { settled: false as const, value, recent };
        }
      }
    },
    { streak: STREAK, tolerancePx: TOLERANCE_PX, deadlineMs: DEADLINE_MS },
  );

  if (!result.settled) {
    throw new Error(
      `Центр масс дерева не остановился за ${DEADLINE_MS} мс: последние замеры ${JSON.stringify(result.recent)}`,
    );
  }
  return result.value;
}

test('карточка узла и поиск работают в собранном приложении', async ({ page }) => {
  // Общий таймаут в 60 с этому тесту мал по той же причине, что и в
  // filtering.spec.ts и sidebar-fit.spec.ts: до 30 с на запуск CLI, плюс
  // stableCentroid зовётся пять раз за прогон (первичная стабилизация,
  // до и после Enter к найденному узлу, до и после Enter по образцу без
  // совпадений) с дедлайном в 30 с каждый — до 150 с сверху. Сумма (180 с)
  // намного больше общего предела: на практике каждый вызов возвращается за
  // доли секунды, как только дерево и правда устоялось, но без своего
  // таймаута тест на нагруженной машине упёрся бы в общий предел раньше
  // собственного дедлайна и вместо внятного «центр масс не остановился» дал
  // бы бесполезное сообщение о таймауте теста — берём 240 с с запасом.
  test.setTimeout(240_000);

  const repo = await makeRepo([
    {
      message: 'первый',
      author: { name: 'Аня Петрова', email: 'anya@e.com' },
      write: { 'src/alpha.ts': 'a\n' },
    },
    {
      message: 'второй',
      author: { name: 'Бо Ли', email: 'bo@e.com' },
      write: { 'src/beta.ts': 'b\n' },
    },
    {
      message: 'третий',
      author: { name: 'Аня Петрова', email: 'anya@e.com' },
      write: { 'docs/readme.md': 'r\n' },
    },
  ]);
  // Если клик по узлу подберёт корень дерева, карточка покажет имя
  // репозитория, а не имя файла или каталога, — это имя тоже должно
  // считаться совпадением по данным.
  const repoName = basename(repo);
  const expectedNames = ['alpha.ts', 'beta.ts', 'readme.md', 'src', 'docs', repoName];

  cli = await startCli(repo);
  await page.goto(cli.url);
  await page.waitForSelector('canvas[data-ready="true"]');
  await expect(page.locator('#sidebar')).toBeVisible();
  await stableBrightness(page);
  // Раскладка на этой горстке узлов остывает дольше, чем успевает заметить
  // stableBrightness (см. её докблок и докблок stableCentroid ниже) — до
  // финального ожидания камера по Enter измерялась бы на фоне ещё ползущего
  // дерева, и центр масс сдвигался бы сам по себе, без всякого поиска.
  await stableCentroid(page);

  // --- Клик по узлу открывает карточку, Escape закрывает её ---

  const point = await findNodePixel(page);
  await page.mouse.click(point.x, point.y);

  const inspector = page.locator('#inspector');
  await expect(inspector).toBeVisible();
  const cardText = await inspector.innerText();
  const found = expectedNames.some((name) => cardText.includes(name));
  expect(
    found,
    `текст карточки не содержит ни одного из известных имён (${expectedNames.join(', ')}): ${cardText}`,
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(inspector).toBeHidden();

  // --- `/` переносит фокус в поиск, образец даёт счётчик совпадений ---

  const searchField = page.locator('#sidebar input[data-role="search"]');
  const searchCount = page.locator('#sidebar [data-role="search-count"]');

  await page.keyboard.press('/');
  await expect(searchField).toBeFocused();

  await page.keyboard.type('alpha');
  await expect(searchCount).toHaveText(/совпадений: 1/);

  // --- Enter уводит камеру к найденному узлу: картинка обязана измениться ---

  // Допуск на дрожание раскладки при неподвижной камере измерен ниже (см.
  // JITTER_TOLERANCE_PX) — сдвиг camera.focusOn обязан быть кратно больше
  // него, иначе два случая было бы нечем различить.
  const MOVE_THRESHOLD_PX = 15;

  const beforeFocus = await stableCentroid(page);
  await page.keyboard.press('Enter');
  const afterFocus = await stableCentroid(page);
  const focusShift = distance(beforeFocus, afterFocus);
  expect(
    focusShift,
    `центр масс дерева сдвинулся всего на ${focusShift.toFixed(2)} px после Enter по найденному ` +
      `образцу (было ${JSON.stringify(beforeFocus)}, стало ${JSON.stringify(afterFocus)}) — камера, похоже, не уехала`,
  ).toBeGreaterThan(MOVE_THRESHOLD_PX);

  // --- Образец без совпадений: «ничего не найдено», камера не двигается ---

  await searchField.fill('zzzz');
  await expect(searchCount).toHaveText('ничего не найдено');

  // Замер берём до Enter: обводка найденного уже пропала на предыдущем шаге
  // (счётчик реагирует на каждую букву без Enter) — сравнение с этим замером
  // проверяет именно то, что обязан делать Enter при нуле совпадений: ничего.
  // Порог заметно меньше MOVE_THRESHOLD_PX: он ловит только настоящий сдвиг
  // камеры, а не остаточное дрожание раскладки (см. докблок stableCentroid).
  const JITTER_TOLERANCE_PX = 5;
  const beforeEmptyEnter = await stableCentroid(page);
  await page.keyboard.press('Enter');
  const afterEmptyEnter = await stableCentroid(page);
  const idleShift = distance(beforeEmptyEnter, afterEmptyEnter);
  expect(
    idleShift,
    `центр масс дерева сдвинулся на ${idleShift.toFixed(2)} px после Enter по образцу без ` +
      `совпадений (было ${JSON.stringify(beforeEmptyEnter)}, стало ${JSON.stringify(afterEmptyEnter)}) ` +
      `— камера не должна была никуда ехать`,
  ).toBeLessThan(JITTER_TOLERANCE_PX);
});
