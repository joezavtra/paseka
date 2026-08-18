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

/** Ниже этой альфы (из 255) пиксель считается краем антиалиасинга, а не телом узла. */
const OPAQUE_ALPHA_THRESHOLD = 200;

/**
 * На сколько CSS-пикселей очередная искомая точка должна отстоять от уже
 * опробованных, чтобы считаться другим узлом. Узлы этой фикстуры на экране
 * заметно мельче, а вплотную друг к другу их не ставит раскладка: отталкивание
 * разводит соседей на десятки пикселей.
 */
const MIN_PIXEL_SEPARATION_PX = 24;

/**
 * Ищет на холсте пиксель, который точно принадлежит телу узла дерева, а не
 * панелям поверх него: правее правого края боковой панели фильтров и выше
 * верхней границы HUD (строка статуса и панель транспорта прибиты к низу
 * экрана одной колонкой — верхний край этой колонки достаточно взять один
 * раз). Координаты узлов заранее неизвестны: раскладка силовая, а вписывание
 * камеры каждый раз усаживает дерево по-своему в зависимости от формы
 * репозитория и размера окна — единственный надёжный способ узнать, куда
 * кликнуть, это спросить сам холст через снимок его пикселей.
 *
 * Порог `OPAQUE_ALPHA_THRESHOLD`, а не «альфа не нулевая»: первый попавшийся
 * непрозрачный пиксель почти всегда лежит на антиалиасной кромке круга, где
 * альфа — единицы из 255, а не на его теле. Клик туда всё равно обычно
 * находит узел только потому, что подбор в приложении (`PICK_SLACK_PX` в
 * `web/main.ts`) прощает несколько пикселей мимо центра, — то есть тест
 * незаметно для себя опирался бы сразу на три чужие константы (радиус
 * антиалиасинга, PICK_SLACK_PX и масштаб камеры). Плотный порог убирает эту
 * зависимость: пиксель с альфой выше порога надёжно лежит внутри тела круга.
 *
 * Снимок берётся через `canvas.toDataURL()`, перерисованный в оффскрин-канву,
 * а не напрямую через `ctx.getImageData()` живой канвы — тем же приёмом, что
 * и в `stableCentroid` ниже (см. её докблок про то, зачем это нужно и чем это
 * не является).
 *
 * Пиксель ищется в координатах устройства (canvas.width/height уже умножены
 * на devicePixelRatio), а возвращается в CSS-пикселях (той же мере, в которой
 * измеряются панели и в которой Playwright кликает по странице) — без
 * деления координата систематически промахивалась бы мимо панели на любом
 * экране с dpr > 1. Холст занимает всю страницу от левого верхнего угла
 * (`#scene { width: 100vw; height: 100vh }`, без отступов), поэтому
 * CSS-координата внутри холста совпадает с координатой страницы, по которой
 * кликает Playwright, — отдельного пересчёта начала координат не нужно.
 *
 * Бросает, если такого пикселя нет: тест обязан упасть с внятной причиной, а
 * не молча кликнуть в пустое место и получить ложно-зелёный результат на
 * незаполненном инспекторе.
 */
async function findNodePixel(page: Page, avoid: NodePixel[] = []): Promise<NodePixel> {
  const sidebarBox = await page.locator('#sidebar').boundingBox();
  const hudBox = await page.locator('#hud').boundingBox();
  if (!sidebarBox) throw new Error('Боковая панель #sidebar не нашлась на странице.');
  if (!hudBox) throw new Error('Панель #hud не нашлась на странице.');
  const sidebarRight = sidebarBox.x + sidebarBox.width;
  const hudTop = hudBox.y;

  const point = await page.evaluate(
    async ({ sidebarRight, hudTop, opaqueAlphaThreshold, avoid, minSeparation }) => {
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
        if (data[i]! < opaqueAlphaThreshold) continue;
        const pixelIndex = (i - 3) / 4;
        const px = pixelIndex % width;
        const py = Math.floor(pixelIndex / width);
        const cssX = px / dpr;
        const cssY = py / dpr;
        if (cssX <= sidebarRight || cssY >= hudTop) continue;
        // Пиксели рядом с уже опробованной точкой принадлежат тому же узлу:
        // повторный клик туда же дал бы тот же выбор и зациклил поиск.
        if (avoid.some((p) => Math.hypot(p.x - cssX, p.y - cssY) < minSeparation)) continue;
        return { x: cssX, y: cssY };
      }
      return null;
    },
    {
      sidebarRight,
      hudTop,
      opaqueAlphaThreshold: OPAQUE_ALPHA_THRESHOLD,
      avoid,
      minSeparation: MIN_PIXEL_SEPARATION_PX,
    },
  );

  if (!point) {
    throw new Error(
      `Не нашли на холсте пиксель тела узла (альфа ≥ ${OPAQUE_ALPHA_THRESHOLD}) правее панели ` +
        `фильтров (x > ${sidebarRight}), выше HUD (y < ${hudTop}) и не ближе ` +
        `${MIN_PIXEL_SEPARATION_PX} px к уже опробованным точкам (${JSON.stringify(avoid)}).`,
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
 * tests/helpers/canvas.ts) — узлы продолжают едва заметно дрожать. Побайтовое
 * сравнение холста поймало бы это дрожание как «картинка изменилась» даже
 * там, где камера не двигалась вовсе; центр масс усредняет дрожание отдельных
 * узлов почти до нуля, но остаётся чувствительным к настоящему сдвигу камеры:
 * `Camera.focusOn` переносит всё дерево целиком на один и тот же вектор, и
 * центр масс уезжает вместе с ним.
 *
 * Почему `stableBrightness` (используется в этом файле один раз, перед самым
 * первым вызовом этой функции) не заменяет и не обесценивает эту проверку, а
 * `stableCentroid` не обесценивает саму `stableBrightness`: у них разные
 * задачи и разный масштаб допуска. `stableBrightness` сравнивает СУММУ альфы
 * по всему холсту с допуском в 1.5% ОТНОСИТЕЛЬНО этой суммы (то есть в
 * абсолютных числах — тысячи единиц на репозитории с суммой порядка
 * миллиона) и только грубо отвечает на вопрос «стартовый ком узлов в целом
 * разошёлся» — сдвиг всего облака на несколько пикселей эту сумму почти не
 * меняет (см. абзацем выше: центр масс на такой перенос и ловится, а сумма
 * альфы — нет). `stableCentroid` же сравнивает АБСОЛЮТНОЕ положение с
 * допуском в доли пикселя — на два порядка строже — и именно поэтому ей
 * нужна другая, более надёжная схема ожидания (см. ниже), а не потому, что у
 * `stableBrightness` есть скрытый изъян: для её грубой, разовой, страхующей
 * роли в начале теста относительного допуска в 1.5% достаточно, и то, от чего
 * защищается `stableCentroid` ниже, тонет в этом допуске без следа. Если
 * `stableBrightness` всё же вернётся чуть раньше настоящего плато — не беда:
 * это единственное место, где она используется, и сразу следом всегда идёт
 * `stableCentroid`, которая сама, независимо, убедится в неподвижности перед
 * первым же сравнением позиций.
 *
 * Устойчивость меряется ОКНОМ ПО ВРЕМЕНИ (минимум `WINDOW_MS`), а не числом
 * подряд идущих замеров: при опросе без пауз, целиком внутри одного
 * `page.evaluate` (см. ниже почему), один замер — это `toDataURL()` +
 * `drawImage()` + `getImageData()` по нескольким мегабайтам, то есть
 * реально доли-десятки миллисекунд. Фиксированное число замеров при таком
 * темпе даёт разное по длительности окно на разных машинах (быстрее машина —
 * короче окно) — а именно короткое окно, в пару сотен миллисекунд, и есть тот
 * самый случай, о котором предупреждает докблок `stableBrightness`: на нём
 * последовательные замеры сходятся заметно раньше, чем величина в
 * действительности доходит до плато. Поэтому здесь два условия одновременно:
 * окно должно охватывать не меньше `WINDOW_MS` реального времени, и внутри
 * него — не меньше `MIN_SAMPLES` замеров (вторая проверка — просто подстраховка
 * от вырожденного случая, когда пара далеко разнесённых по времени точек
 * случайно совпала по значению, не различив то, что происходило между ними).
 * Как именно вытеснение из окна делает первое условие честным, а не
 * зависящим от случайного совпадения плавающих `performance.now()` — см.
 * комментарий прямо над вытесняющим `while` в теле функции.
 *
 * Пиксели читаются не через `ctx.getImageData()` рисуемой канвы напрямую, а
 * через `canvas.toDataURL()`, перерисованный в оффскрин-канву и уже там
 * прочитанный — это защитный, а не доказанно необходимый приём: на раннем
 * этапе отладки два ОТДЕЛЬНЫХ вызова `page.evaluate` с `getImageData()`,
 * ничем не разделённые, однажды отдали разные пиксели, а `toDataURL()` в те
 * же моменты — нет; но позже выяснилось, что и `toDataURL()` при внешнем
 * опросе с паузами между замерами (см. ниже) даёт ту же картину промаха —
 * то есть решающим оказался не выбор API чтения, а сам факт внешних пауз
 * между замерами (следующий абзац). API чтения оставлен как есть просто
 * потому, что не создаёт риска и не требует отдельного объяснения на каждый
 * вызов.
 *
 * Сам опрос идёт целиком внутри страницы одним вызовом `page.evaluate`, а не
 * циклом из Node с паузой между итерациями (`page.waitForTimeout`). На этой
 * машине под шестью параллельными воркерами Playwright именно непрерывное
 * наблюдение стабильно ловит настоящую картину, а опрос с паузами между
 * круговыми поездками до Node — нет: d3-force продолжает тикать заметно
 * дольше, чем кажется по редким замерам, и вкладка, конкурирующая за CPU с
 * пятью такими же, может несколько секунд не получать кадра вовсе, а затем
 * разом досчитать накопившиеся тики — событие, которое по чистой случайности
 * может прийтись ровно на паузу между двумя внешними замерами и остаться
 * незамеченным, как бы редко замеры ни шли и как бы долго ни длилось окно
 * проверки (проверено так: при внешнем опросе с паузами даже 32 замера подряд
 * в допуске за 8 с не гарантировали защиты — совпадение оставалось невидимым
 * тому же самому стороннему наблюдателю, который его искал, вне зависимости
 * от того, каким API читались пиксели). Наблюдение изнутри вкладки устраняет
 * этот зазор: между двумя последовательными замерами внутри одного `while`
 * нет никакой внешней паузы, которую могло бы поглотить голодание.
 */
async function stableCentroid(page: Page): Promise<Centroid> {
  /** Минимальная реальная длительность окна, на котором проверяется неподвижность. */
  const WINDOW_MS = 1000;
  /** Подстраховка от вырожденного окна из одной-двух далеко разнесённых точек — см. докблок. */
  const MIN_SAMPLES = 5;
  const TOLERANCE_PX = 0.4;
  const DEADLINE_MS = 30_000;

  const result = await page.evaluate(
    async ({ windowMs, minSamples, tolerancePx, deadlineMs }) => {
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
      const recent: { x: number; y: number; t: number }[] = [];
      for (;;) {
        const value = await centroidNow();
        const t = performance.now();
        recent.push({ x: value.x, y: value.y, t });
        // Скользящее окно по времени. Вытесняем по recent[1], а не по recent[0]:
        // при опросе без пауз и I около 4–10 мс на один замер это не деталь
        // реализации, а единственный способ, которым windowSpan >= windowMs
        // ниже вообще может выполниться не по случайному совпадению. Если
        // вытеснять, пока СТАРШИЙ элемент (recent[0]) старше windowMs, то в
        // конце цикла он неизбежно окажется НЕ старше windowMs (иначе его бы
        // тоже вытеснили) — то есть windowSpan = t - recent[0].t <= windowMs
        // всегда, и условие `windowSpan >= windowMs` может сработать только
        // на точном равенстве, которое в реальности ловится лишь округлением
        // performance.now() в Chrome (0.1 мс) и то через раз: на редком
        // опросе (I от полусотни до пары сотен миллисекунд — шесть
        // параллельных воркеров, машина послабее, dpr 2) это совпадение
        // может не подвернуться до самого дедлайна. Вытесняя по recent[1],
        // мы оставляем в начале окна ровно один замер, который уже гарантированно
        // не младше windowMs, — и как только он появляется, windowSpan
        // оказывается не меньше windowMs с честным запасом, а не по границе.
        while (recent.length > minSamples && t - recent[1]!.t >= windowMs) recent.shift();

        const windowSpan = recent.length > 0 ? t - recent[0]!.t : 0;
        if (recent.length >= minSamples && windowSpan >= windowMs) {
          let maxDrift = 0;
          for (const sample of recent) {
            maxDrift = Math.max(maxDrift, Math.hypot(sample.x - recent[0]!.x, sample.y - recent[0]!.y));
          }
          if (maxDrift <= tolerancePx) return { settled: true as const, value, recent };
        }
        if (t - started > deadlineMs) {
          return { settled: false as const, value, recent };
        }
      }
    },
    { windowMs: WINDOW_MS, minSamples: MIN_SAMPLES, tolerancePx: TOLERANCE_PX, deadlineMs: DEADLINE_MS },
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
  // filtering.spec.ts и sidebar-fit.spec.ts, только слагаемых больше: до 30 с
  // на запуск CLI (см. helpers/cli.ts), плюс до 30 с — это Playwright-овский
  // таймаут действия по умолчанию, которым в этом проекте никто не управляет
  // явно (в playwright.config.ts не задан ни `use.actionTimeout`, ни
  // `page.setDefaultTimeout`), а ему подчиняется `page.waitForSelector`
  // ниже, — плюс до 20 с на stableBrightness перед самым первым вызовом
  // stableCentroid, — плюс сам stableCentroid зовётся пять раз за прогон
  // (первичная стабилизация, до и после Enter к найденному узлу, до и после
  // Enter по образцу без совпадений) с дедлайном в 30 с каждый — ещё до 150 с.
  // Итого худший случай — 230 с (30 + 30 + 20 + 150). На практике каждый
  // вызов stableCentroid возвращается за доли секунды, как только дерево и
  // правда устоялось, но без щедрого собственного таймаута тест на
  // нагруженной машине упёрся бы в общий предел раньше, чем сработает
  // частный, и вместо внятной причины («центр масс не остановился» или «CLI
  // не ответил») дал бы бесполезное сообщение о таймауте теста — берём 280 с,
  // с запасом сверх посчитанных 230 с.
  test.setTimeout(280_000);

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
  // Строка целиком, а не регэксп на «содержит 1»: /совпадений: 1/ поймал бы и
  // «совпадений: 12» — на этой фикстуре такого случиться не может (в ней
  // всего три файла), но проверка обязана утверждать «ровно одно совпадение»,
  // а не «встречается цифра 1». Текст строки известен дословно — он же и
  // проверяется у sidebar.ts в web/ui/sidebar.ts (setSearchCount).
  await expect(searchCount).toHaveText('совпадений: 1 · Enter — показать первое');

  // --- Enter уводит камеру к найденному узлу: картинка обязана измениться ---

  // Допуск на дрожание раскладки при неподвижной камере измерен ниже (см.
  // JITTER_TOLERANCE_PX) — сдвиг camera.focusOn обязан быть кратно больше
  // него, иначе два случая было бы нечем различить. Число подобрано по этой
  // конкретной фикстуре (три файла, дерево умещается в несколько сотен
  // мировых единиц) — на дереве другого размера или формы порог пришлось бы
  // пересчитывать заново, это не универсальная константа.
  const MOVE_THRESHOLD_PX = 15;

  // Проверка ниже удостоверяет только факт «камера сдвинулась на заметную
  // величину после Enter» — она не проверяет, что камера уехала именно к
  // найденному узлу (alpha.ts), а не куда-то ещё случайно. На фикстуре из
  // трёх файлов альтернативных целей нет, так что здесь это равносильно, но
  // при более богатом сценарии для такой проверки этого было бы мало.
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

  // --- Скрытие выбранного узла закрывает карточку ---

  // Карточка утверждает про сцену («на сцене показано N»), поэтому пережить
  // исчезновение своего узла со сцены она не может: у скрытой папки карточка
  // оставалась открытой и печатала «на сцене показано 0» — утверждение,
  // противоречащее сцене. Проверяем через панель навигатора, то есть тем же
  // жестом, которым это и наблюдалось: снять галочку «показывать».
  const tried: NodePixel[] = [];
  let selectedName = '';
  let selectedPath = '';
  for (let attempt = 0; attempt < 4 && selectedPath === ''; attempt++) {
    const spot = await findNodePixel(page, tried);
    tried.push(spot);
    await page.mouse.click(spot.x, spot.y);
    await expect(inspector).toBeVisible();
    selectedName = (await inspector.locator('h2').innerText()).trim();
    // Корень скрыть нечем — навигатор показывает только его потомков; если
    // клик подобрал корень, пробуем другой узел.
    if (selectedName === repoName) continue;
    const pathLine = inspector.locator('.path');
    // Строка пути прячется, когда дословно повторяет заголовок (файл или
    // папка прямо в корне репозитория) — тогда полный путь и есть имя.
    selectedPath = (await pathLine.isVisible()) ? (await pathLine.innerText()).trim() : selectedName;
  }
  expect(selectedPath, `не удалось выбрать кликом ни один узел, кроме корня (${repoName})`).not.toBe(
    '',
  );

  // Скрываем папку верхнего уровня, в которой лежит выбранный узел (или его
  // саму, если выбрана именно она): вместе с поддеревом узел уходит со сцены.
  const topFolder = selectedPath.split('/')[0]!;
  const folderCheckbox = page.locator(`#sidebar input[aria-label="Показывать папку: ${topFolder}"]`);
  await expect(
    folderCheckbox,
    `в навигаторе нет галочки папки «${topFolder}» (выбран узел ${selectedPath})`,
  ).toHaveCount(1);
  await folderCheckbox.uncheck();

  await expect(
    inspector,
    `карточка узла ${selectedPath} осталась открытой после скрытия папки «${topFolder}» — ` +
      `она продолжает рассказывать про узел, которого на сцене больше нет`,
  ).toBeHidden();
});
