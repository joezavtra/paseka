import { describePack, loadPack, showFatal } from './boot.js';
import { TimeEngine, type TimeDelta } from './time/engine.js';
import { buildActiveLinks, diffBorn, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit, LayoutUpdate } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { drawScene, type SceneInput } from './render/scene.js';
import { DIR_COLOR_INDEX, paletteIndexForPath } from './render/palette.js';
import { deriveActivity } from './render/activity.js';
import { NOTHING, pickNode } from './render/pick.js';
import { DEFAULT_LABEL_LIMIT, labelFor, selectLabels } from './render/labels.js';
import { Playback } from './time/playback.js';
import { formatCommitLabel, mountTransport } from './ui/transport.js';
import { mountSidebar, type SidebarHandles } from './ui/sidebar.js';
import { mountInspector } from './ui/inspector.js';
import { describeNode } from './state/node-info.js';
import type { Pack } from '../src/model/types.js';
import { RecentEvents } from './time/recent.js';
import { ActorField } from './render/actors.js';
import { avatarColor, initialsFor } from './render/avatar.js';
import type { ActorLayer, BeamLayer } from './render/scene.js';
import {
  decodeVisibility,
  encodeVisibility,
  resolveVisibility,
  type VisibilitySpec,
} from './state/visibility.js';
import { computeAlpha, EMPTY_FILTER, type FilterSpec } from './state/filter.js';
import { computeHits, projectHits } from './state/search.js';
import { applyPositions as applyPlacedPositions, createPlacementTracker, recordEpoch } from './layout/placement.js';

async function start(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const status = document.getElementById('status');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showFatal('Браузер не дал контекст canvas 2D.');
    return;
  }

  const pack: Pack = await loadPack();
  const { pathCount } = pack.meta;

  // Цвет узла — индекс в палитре сцены; строку для кисти отрисовка достаёт
  // сама. Одно объявление цвета каталога на весь проект живёт в PALETTE.
  const color = new Uint8Array(pathCount);
  for (let path = 0; path < pathCount; path++) {
    color[path] =
      pack.pathIsDir[path] === 1 ? DIR_COLOR_INDEX : paletteIndexForPath(pack.paths[path]!);
  }

  /** Сколько миллисекунд живёт луч и вспышка. */
  const ACTIVITY_MS = 1200;
  /** Потолок числа одновременно светящихся событий: первый коммит трогает всё. */
  const ACTIVITY_CAPACITY = 512;

  const authorCount = pack.authors.length;
  const recent = new RecentEvents(ACTIVITY_CAPACITY, ACTIVITY_MS, authorCount);
  const actorField = new ActorField(authorCount);

  const actors: ActorLayer = {
    positions: actorField.positions,
    active: actorField.active,
    color: pack.authors.map((author) => avatarColor(author.email)),
    initials: pack.authors.map((author) => initialsFor(author.name, author.email)),
    name: pack.authors.map((author) => author.name),
  };

  const beams: BeamLayer = {
    count: 0,
    fromX: new Float32Array(ACTIVITY_CAPACITY),
    fromY: new Float32Array(ACTIVITY_CAPACITY),
    toX: new Float32Array(ACTIVITY_CAPACITY),
    toY: new Float32Array(ACTIVITY_CAPACITY),
    author: new Uint32Array(ACTIVITY_CAPACITY),
    strength: new Float32Array(ACTIVITY_CAPACITY),
    alpha: new Float32Array(ACTIVITY_CAPACITY),
  };

  const flash = new Float32Array(pathCount);
  /** Пути, которым в прошлом кадре ставили свечение: гасим только их. */
  let litPaths: number[] = [];

  const scene: SceneInput & { representative: Int32Array; files: Int32Array } = {
    active: new Uint8Array(pathCount),
    positions: new Float32Array(pathCount * 2),
    radius: new Float32Array(pathCount),
    color,
    alpha: new Float32Array(pathCount).fill(1),
    linkSource: new Uint32Array(0),
    linkTarget: new Uint32Array(0),
    flash,
    // Заполняется refreshHits() из projectHits; до первого поиска пусто —
    // кольцо обводки рисовать нечего.
    hit: new Uint8Array(pathCount),
    beams,
    actors,
    // Кто представляет путь на экране; заполняется в applyDelta из
    // resolveVisibility. До первого вызова не используется — deriveActivity
    // не позовут раньше applyDelta.
    representative: new Int32Array(pathCount),
    // Число живых файлов за представителем; заполняется в applyDelta тем же
    // проходом resolveVisibility, что и representative — оно и нужно ровно
    // там же, для подписи свёрнутой папки.
    files: new Int32Array(pathCount),
    // Слой подписей кадра; собирается в цикле кадра из selectLabels. Ёмкость
    // массива путей — на весь лимит подписей, а не на pathCount: подписей на
    // экране всегда на порядки меньше путей в истории.
    labels: {
      count: 0,
      path: new Uint32Array(DEFAULT_LABEL_LIMIT),
      text: [],
    },
  };

  let visibilitySpec: VisibilitySpec = { hidden: new Set(), collapsed: new Set() };
  let filterSpec: FilterSpec = EMPTY_FILTER;
  /** Куда едет яркость и откуда: переход длится MS, чтобы фильтр не мигал. */
  const ALPHA_TRANSITION_MS = 200;
  let alphaFrom: Float32Array = new Float32Array(pathCount).fill(1);
  let alphaTo: Float32Array = new Float32Array(pathCount).fill(1);
  let alphaStartedAt = -Infinity;
  // Без своего признака завершения переход после t >= 1 либо считался бы
  // каждый кадр заново (сравнение globalAlpha не годится — альфа общая на
  // всю сцену), либо, при сравнении массивов по ссылке, копировал бы
  // alphaTo в scene.alpha каждый кадр вечно: scene.alpha — один и тот же
  // объект, а alphaTo — всегда другой, и по ссылке они никогда не совпадут.
  let alphaSettled = true;
  /** Рисуемая маска прошлого применения: из её разницы берётся список рождающихся. */
  const prevDrawn = new Uint8Array(pathCount);

  let searchQuery = '';
  /** Маска по исходным путям; пересчитывается только при смене образца, а не на каждый кадр. */
  let searchHits: Uint8Array = new Uint8Array(pathCount);

  /**
   * Получал ли путь настоящую позицию от раскладки — не то же самое, что
   * «координата не нулевая»: узел может законно осесть у мирового нуля, а
   * `scene.positions` заведён нулями с самого начала и остаётся таким для
   * только что родившегося пути, пока воркер не ответил. Сбрасывается в
   * applyDelta для рождающихся путей (кроме тех, кому досталась позиция
   * родителя — унаследованная позиция настоящая, а не заглушка), поднимается
   * функцией `applyPositions` (см. web/layout/placement.ts) по ответу воркера
   * — не по текущей маске главного потока, а по маске, отправленной вместе с
   * той эпохой, которую воркер эхует: между отправкой `update` и его ответом
   * воркер продолжает слать тики по старой эпохе, которая ещё не знает про
   * путь, родившийся уже после отправки. Массив не переприсваивается —
   * только элементы, поэтому `const`.
   */
  const placed: Uint8Array = new Uint8Array(pathCount);
  /**
   * Держит маски, отправленные вместе с ещё не устаревшими эпохами `update` —
   * подробности в web/layout/placement.ts. Живёт в main.ts, а не в воркере:
   * это главный поток спрашивает, была ли его собственная просьба выполнена,
   * и ему решать, каким эпохам верить.
   */
  const placementTracker = createPlacementTracker();
  /** Номер следующего `update`; воркер эхует его назад в каждом `positions` (см. web/layout/protocol.ts). */
  let nextEpoch = 1;
  /**
   * Путь, для которого поиск попросил камеру, но позиции у него ещё не было:
   * пользователь нажал Enter — доля секунды ожидания честнее молчания.
   * Разрешается ближайшим сообщением воркера, которое поднимет `placed` для
   * этого пути (см. ниже), либо новым поиском или ручным вмешательством в
   * камеру, которые его снимают — иначе отложенная цель выстрелила бы поверх
   * уже изменившегося намерения пользователя.
   */
  let pendingFocus: number | null = null;

  const camera = new Camera();
  camera.attach(canvas, () => {
    // Колесо или перетаскивание — пользователь взял камеру в свои руки прямо
    // сейчас; отложенный фокус поиска, если он ждал своего часа, больше не
    // должен выстрелить поверх этого решения на ближайшем сообщении воркера.
    pendingFocus = null;
  });

  const hud = document.getElementById('hud');
  const sidebarRoot = document.getElementById('sidebar');
  const inspectorRoot = document.getElementById('inspector');
  /** Ручки панели фильтров; звать setSearchCount снаружи было бы нечем без них. */
  let sidebar: SidebarHandles | null = null;

  /**
   * Вписывает живые узлы, пока камерой не завладел пользователь. Все полосы,
   * занятые интерфейсом, из вида вычитаются: HUD снизу (строка состояния и
   * панель транспорта), панель фильтров слева и карточка узла справа. Все
   * слои лежат поверх холста и почти непрозрачны, поэтому вписывание во всё
   * окно прятало бы под ними края дерева — а достать их можно было бы только
   * ручным панорамированием, которое навсегда выключает автовписывание.
   *
   * Слева, в отличие от низа и от правого края, мало вычесть ширину: отсчёт
   * идёт от левого края, и облако, вписанное в суженный прямоугольник, всё
   * равно центрировалось бы поверх панели. Поэтому та же величина уходит во
   * вписывание ещё и смещением. Панели может не быть в разметке или она может
   * быть скрыта — тогда полоса нулевая, и вписывание работает как раньше.
   */
  const reservedLeft = (): number => {
    if (!sidebarRoot || sidebarRoot.hidden) return 0;
    const box = sidebarRoot.getBoundingClientRect();
    if (box.width === 0) return 0;
    // Правый край панели, а не только её ширина: панель отступает от края
    // окна, и этот отступ — тоже занятая полоса. Плюс зазор до дерева.
    return box.right + 12;
  };

  /**
   * Полоса, занятая карточкой узла справа. Симметрична reservedLeft: карточка
   * тоже отступает от края окна, и этот отступ — тоже часть занятой полосы.
   * Правую границу прямоугольника вписывания трогать не нужно — fit() уже
   * центрирует облако в [left, left + width], и вычитания ширины достаточно.
   */
  const reservedRight = (): number => {
    if (!inspectorRoot || inspectorRoot.hidden) return 0;
    const box = inspectorRoot.getBoundingClientRect();
    if (box.width === 0) return 0;
    return canvas.clientWidth - box.left + 12;
  };

  /**
   * Прямоугольник, отведённый дереву на холсте: столько же полос занято, как
   * и в followLayout, потому что правило «сколько занято панелями» должно
   * жить в одном месте. Фокус камеры по Enter в поиске использует ту же
   * геометрию — иначе рано или поздно она посчиталась бы дважды и разошлась
   * (например, если карточку узла подвинут, а один из двух расчётов забудут
   * поправить).
   */
  const viewBox = (): { left: number; width: number; height: number } => {
    const reservedBottom = hud ? hud.offsetHeight + 12 : 0;
    const left = reservedLeft();
    const right = reservedRight();
    const width = Math.max(1, canvas.clientWidth - left - right);
    const height = Math.max(1, canvas.clientHeight - reservedBottom);
    return { left, width, height };
  };

  const followLayout = (): void => {
    const { left, width, height } = viewBox();
    camera.autoFit(scene.positions, scene.active, width, height, left);
  };

  /**
   * Проецирует уже посчитанную маску попаданий (`searchHits`) на то, что
   * сейчас нарисовано, и раздаёт результат: сцене — маску для обводки, панели
   * — счётчик. Не пересчитывает саму маску по образцу — этим занимается
   * `applySearch`; здесь только перенос на представителей, который нужен
   * заново при каждой смене видимости или курсора, даже если образец не
   * менялся (applyDelta зовёт именно этот, более дешёвый путь).
   *
   * Ранний выход при пустом образце: applyDelta зовёт это на каждый шаг
   * воспроизведения (тот же повод, по которому пересборка карточки узла
   * вынесена из applyDelta в throttled цикл кадра, см. inspectorDirty ниже),
   * и полный проход по путям с новым Uint8Array(pathCount) ради пустого
   * результата на каждый коммит был бы тем же расточительством в самом частом
   * случае — поиск не используется вовсе. Саму маску гасит `applySearch`
   * один раз, в момент, когда образец становится пустым, а не этот вызов на
   * каждом кадре.
   */
  function refreshHits(): { first: number; count: number } {
    if (searchQuery.trim().length === 0) return { first: -1, count: 0 };
    const projected = projectHits(searchHits, scene.representative, scene.active, engine.alive);
    scene.hit = projected.drawnHits;
    sidebar?.setSearchCount(projected.count, searchQuery);
    return { first: projected.first, count: projected.count };
  }

  /** Пересчитывает маску попаданий по новому образцу и проецирует её заново. */
  function applySearch(query: string): { first: number; count: number } {
    // Образец меняется — прежнее намерение снимается вместе с ним: иначе
    // «Enter → сразу очистить поле» или «Enter → напечатать другой образец»
    // оставляли бы отложенную цель предыдущего поиска, и она выстрелила бы
    // камерой на ближайшем сообщении воркера уже после того, как кольца для
    // неё на сцене нет. onSearchSubmit ниже сам заводит новый pendingFocus,
    // если он снова понадобится для нового результата.
    pendingFocus = null;
    searchQuery = query;
    searchHits = computeHits(pack, searchQuery);
    if (searchQuery.trim().length === 0) {
      // Гасим маску один раз здесь, а не на каждый кадр в refreshHits: поле
      // очистили — кольца обязаны пропасть немедленно, но дальше, пока новый
      // образец не введён, applyDelta будет обходить это дешёвым ранним
      // выходом выше.
      scene.hit.fill(0);
      sidebar?.setSearchCount(0, searchQuery);
      return { first: -1, count: 0 };
    }
    return refreshHits();
  }

  /**
   * Пробует увести камеру к путю. Возвращает `true`, если вопрос закрыт —
   * либо камера действительно поехала, либо ехать было незачем (путь погашен
   * фильтром/скрытием, или координаты испорчены не из-за того, что раскладка
   * ещё не ответила), — и `false`, если решение отложено: путь рисуется, но
   * `placed` для него ещё не поднят, и вызывающий обязан попробовать снова на
   * ближайшем сообщении воркера.
   */
  function attemptFocus(path: number): boolean {
    if (scene.active[path] !== 1) return true; // не рисуется — ждать нечего
    if (placed[path] !== 1) return false; // рисуется, но настоящей позиции ещё нет — ждём воркер
    const fx = scene.positions[path * 2]!;
    const fy = scene.positions[path * 2 + 1]!;
    // Симметрично клику по холсту: focusOn необратимо объявляет камеру
    // управляемой вручную, и негодные координаты увезли бы её туда навсегда —
    // автовписывание больше не вернёт вид. camera.scale тоже проверяем: клик
    // получает эту гарантию транзитивно через toWorld, а здесь координаты
    // берутся прямо из scene.positions и ничего о камере не знают.
    if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(camera.scale)) {
      console.warn('Поиск: координаты найденного узла негодные, камера не трогается.', {
        path,
        fx,
        fy,
        scale: camera.scale,
      });
      return true;
    }
    const { left, width, height } = viewBox();
    camera.focusOn(fx, fy, width, height, left);
    return true;
  }

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    // Переносит позиции и поднимает `placed` только для путей, которые были
    // рисуемыми на момент эпохи, которую воркер сейчас эхует, — не для
    // текущей scene.active главного потока, которая уже может быть новее
    // (главный поток мог отправить следующий `update` с новорождённым путём
    // раньше, чем пришёл ответ на этот). Мутирует scene.positions на месте,
    // а не переприсваивает: путь, не попавший в маску этой эпохи, обязан
    // остаться как был — даже если это унаследованная от родителя позиция,
    // а не заглушка. Подробности — в web/layout/placement.ts.
    applyPlacedPositions(placementTracker, event.data.epoch, event.data.positions, scene.positions, placed);
    // Поиск попросил камеру о пути, у которого ещё не было позиции, — теперь
    // она, возможно, появилась.
    if (pendingFocus !== null && attemptFocus(pendingFocus)) pendingFocus = null;
    // Вписываем на каждом сообщении раскладки, а не однажды по порогу
    // температуры: дерево стартует плотным комком у родителей и расходится
    // за несколько сообщений — защёлкнутый масштаб оставил бы первый кадр
    // обрезанным. Сообщения приходят, только пока симуляция идёт, поэтому
    // слежение прекращается само, когда раскладка успокоилась, а колесо или
    // перетаскивание отключают его немедленно (см. Camera.autoFit).
    followLayout();
  };
  // Ловит и ошибку загрузки модуля воркера, и необработанное исключение внутри
  // него: без этого раскладка молча не запускается, а узлы остаются в нуле.
  worker.onerror = (event: ErrorEvent) => {
    const detail = event.message || 'подробности недоступны';
    showFatal(`Раскладка не запустилась: воркер аварийно завершился. ${detail}`);
  };

  const init: LayoutInit = { type: 'init', pathCount, parent: pack.pathParent, seed: 20260817 };
  worker.postMessage(init);

  const engine = new TimeEngine(pack);

  /** Выбранный узел; -1, если карточка закрыта. */
  let selected = -1;
  /**
   * Карточка устарела и ждёт пересборки. `describeNode` — проход по всем
   * путям и их событиям, а `applyDelta` зовётся на каждый шаг воспроизведения:
   * пересобирать карточку там же означало бы платить этот проход на каждый
   * коммит, то есть просадку кадра на большом репозитории. Вместо этого
   * `applyDelta` только поднимает этот флаг, а настоящая пересборка идёт в
   * цикле кадра не чаще раза в INSPECTOR_REBUILD_INTERVAL_MS — карточка всё
   * равно не отстаёт настолько, чтобы это было заметно глазу.
   */
  let inspectorDirty = false;
  /** Как часто во время воспроизведения разрешено пересобирать карточку узла. */
  const INSPECTOR_REBUILD_INTERVAL_MS = 250;
  let lastInspectorRebuildMs = -Infinity;

  const inspector = inspectorRoot
    ? mountInspector(inspectorRoot, {
        pack,
        onClose: () => {
          selected = -1;
          // Панель закрылась — освобождённая полоса справа должна тут же
          // достаться дереву, а не ждать следующего сообщения раскладки.
          followLayout();
        },
      })
    : null;

  /** Пересобирает карточку выбранного узла на текущем курсоре — единственное место, где это делается. */
  function showSelected(): void {
    if (selected < 0 || !inspector || !inspectorRoot) return;
    const wasHidden = inspectorRoot.hidden;
    inspector.show(describeNode(pack, selected, engine.cursor, engine.alive, engine.sizes));
    // Полоса справа появляется вместе с первым показом — сообщаем камере
    // немедленно, а не жданием следующего сообщения раскладки, которого
    // может уже не быть.
    if (wasHidden) followLayout();
  }

  /** Допуск попадания в экранных пикселях: на отдалении узел меньше пикселя. */
  const PICK_SLACK_PX = 6;
  /** Насколько указатель может сдвинуться, чтобы жест всё ещё считался кликом. */
  const CLICK_SLOP_PX = 4;

  // Камера сама слушает pointerdown/move/up на этом же холсте и на первом же
  // движении отбирает автовписывание (Camera.attach). Здесь запоминаем только
  // точку нажатия, чтобы отличить клик от конца перетаскивания: иначе конец
  // каждого панорамирования открывал бы случайную карточку.
  let pressX = 0;
  let pressY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    pressX = event.offsetX;
    pressY = event.offsetY;
  });

  /**
   * Наведённый путь считается раз в кадр (см. `frame` ниже), а не на каждое
   * событие указателя: подбор — проход по всем путям, и звать его на каждое
   * `pointermove` было бы расточительно при большом дереве. Обработчик здесь
   * только запоминает последние экранные координаты указателя.
   */
  let pointerX = -1;
  let pointerY = -1;
  canvas.addEventListener('pointermove', (event) => {
    pointerX = event.offsetX;
    pointerY = event.offsetY;
  });
  // Указатель ушёл с холста — наведения больше нет. Координаты сбрасываются в
  // недостижимые для pickNode значения, и ближайший кадр сам увидит, что
  // наводить не на что.
  canvas.addEventListener('pointerleave', () => {
    pointerX = -1;
    pointerY = -1;
  });
  canvas.addEventListener('click', (event) => {
    if (Math.hypot(event.offsetX - pressX, event.offsetY - pressY) > CLICK_SLOP_PX) return;

    const [wx, wy] = camera.toWorld(event.offsetX, event.offsetY);
    // pickNode молча возвращает NOTHING на нечисловых координатах — промах, а
    // не ошибку. Если перевод в мировые координаты когда-нибудь даст NaN
    // (сломанное состояние камеры и т. п.), симптомом было бы «клик не
    // работает» без единого следа. Ловим это здесь, а не молчим вместе с ним.
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
      console.warn('Клик по холсту: перевод в мировые координаты дал не-число.', { wx, wy });
      return;
    }

    const path = pickNode(scene, wx, wy, PICK_SLACK_PX / camera.scale);
    if (path === NOTHING) {
      selected = -1;
      // Освобождаем полосу справа немедленно, но только если карточка и
      // правда была открыта — иначе клик мимо дерева гонял бы автовписывание
      // без всякой причины.
      const wasVisible = inspectorRoot ? !inspectorRoot.hidden : false;
      inspector?.hide();
      if (wasVisible) followLayout();
      return;
    }
    selected = path;
    showSelected();
  });

  /** Неизменная часть строки состояния: имя, коммиты, файлы. */
  const packDescription = describePack(pack);

  let liveNodes = 0;
  let shownAuthors = -1;

  function renderStatus(): void {
    if (!status) return;
    status.textContent = `${packDescription} · узлов: ${liveNodes} · авторов: ${shownAuthors < 0 ? 0 : shownAuthors}`;
  }

  /**
   * Переносит разницу движка времени в сцену и в воркер.
   *
   * Два флага отвечают на два разных вопроса и намеренно не связаны:
   * `fullRadius` — надо ли пересчитать радиусы всех рисуемых узлов, а не
   * только затронутых разницей (обязателен после `seek`: он не сообщает
   * затронутые пути, а размеры при этом меняются у любого выжившего файла —
   * без полного обхода радиусы остались бы от прежнего положения курсора; и
   * после смены видимости — она меняет `visibility.sizes` у путей, которых
   * движок времени вообще не считает изменившимися).
   * `rewound` — сдвинулся ли курсор по-настоящему. Только это должно гасить
   * буфер недавних событий и поле авторов: их цели пересчитываются через
   * представителя на каждом кадре и остаются валидными при смене видимости
   * без сдвига курсора — так что смена видимости передаёт `fullRadius: true`,
   * но `rewound: false`.
   */
  function applyDelta(delta: TimeDelta, fullRadius = false, rewound = false): void {
    const visibility = resolveVisibility(pack, engine.alive, engine.sizes, visibilitySpec);
    scene.active.set(visibility.drawn);
    scene.representative = visibility.representative;
    // Число живых файлов за представителем — тот же проход resolveVisibility,
    // что и representative; нужно оно ровно там же: подписи свёрнутой папки.
    scene.files = visibility.files;
    // Представители меняются вместе с видимостью и курсором — обводка и
    // счётчик совпадений обязаны переехать на новых представителей, даже
    // если сам образец поиска не менялся.
    refreshHits();

    if (rewound) {
      // Перемотка обязана погасить чужую активность: без этого буфер держал
      // бы лучи прежнего момента, нацеленные на пути, которые в новой позиции
      // либо мертвы, либо принадлежат совсем другому коммиту. Вместе с буфером
      // забывается и поле авторов: его позиции относятся к прежнему месту
      // истории, и значок полз бы к новой цели дольше, чем живёт луч.
      recent.clear();
      actorField.reset();
    }

    const radiusIds: number[] = [];
    const radiusValues: number[] = [];
    const remember = (path: number) => {
      // Радиус нерисуемого узла воркеру не нужен: тот его не заводит в
      // симуляции, а отправка была бы ссылкой на узел, которого там нет —
      // ровно то, что раньше происходило со скрытым путём.
      if (scene.active[path] !== 1) return;
      // Округляем до float32: scene.radius хранит именно его, и без округления
      // сравнение «изменилось ли» было бы истинным всегда. Размер берём из
      // visibility.sizes, а не из engine.sizes: у свёрнутой папки он должен
      // отражать спрятанный внутри объём.
      const next = Math.fround(radiusFor(visibility.sizes[path]!, pack.pathIsDir[path] === 1));
      if (scene.radius[path] === next) return;
      scene.radius[path] = next;
      radiusIds.push(path);
      radiusValues.push(next);
    };
    if (fullRadius) {
      for (let path = 0; path < pathCount; path++) {
        if (scene.active[path] === 1) remember(path);
      }
    } else {
      for (const path of delta.added) remember(path);
      for (const path of delta.touched) {
        remember(path);
        // Изменившийся файл может лежать внутри свёрнутой папки: рисуется
        // именно представитель, и его радиус обязан вырасти вместе с
        // содержимым, а не только у самого файла, которого на экране нет.
        const representative = scene.representative[path];
        if (representative >= 0 && representative !== path) remember(representative);
      }
    }

    // Разница движка отвечает на вопрос «что родилось в истории», а воркеру
    // нужен ответ на другой: «что появилось на сцене». С видимостью это уже не
    // одно и то же — развёрнутая папка выпускает наружу узлы, которые в истории
    // не менялись.
    const born = diffBorn(prevDrawn, scene.active);
    prevDrawn.set(scene.active);

    // Пока воркер не прислал позиции нового узла, рисуем его у родителя, а не
    // в мировом нуле: иначе на каждый появившийся узел будет вспышка в центре
    // сцены на один кадр. Годится только уже стоявший родитель — если он сам
    // родился в этой же разнице, у него ещё нет настоящей позиции.
    //
    // Рождающийся путь по умолчанию не placed: заглушка 0,0 в scene.positions
    // (или унаследованная позиция родителя ниже) — не то же самое, что ответ
    // воркера, и focusOn не должен считать её надёжной.
    for (const path of born) placed[path] = 0;
    const bornThisDelta = new Set(born);
    for (const path of born) {
      const parentId = pack.pathParent[path]!;
      if (parentId === path) continue; // корень
      if (scene.active[parentId] !== 1) continue;
      if (bornThisDelta.has(parentId)) continue;
      scene.positions[path * 2] = scene.positions[parentId * 2]!;
      scene.positions[path * 2 + 1] = scene.positions[parentId * 2 + 1]!;
      // Унаследованная позиция настоящая ровно настолько, насколько настоящая
      // позиция родителя: если сам родитель ещё не placed (редкий, но
      // возможный случай — воркер не успел ответить и на него), унаследованная
      // копия так же не заслуживает доверия.
      placed[path] = placed[parentId]!;
    }

    const links = buildActiveLinks(scene.active, pack.pathParent);
    scene.linkSource = links.source;
    scene.linkTarget = links.target;

    const epoch = nextEpoch++;
    const update: LayoutUpdate = {
      type: 'update',
      epoch,
      active: scene.active.slice(),
      added: born,
      radiusIds: Uint32Array.from(radiusIds),
      radiusValues: Float32Array.from(radiusValues),
      linkSource: links.source,
      linkTarget: links.target,
    };
    // Запоминаем маску этой эпохи до отправки: postMessage без списка
    // передачи клонирует буфер, а не отбирает его, так что update.active
    // остаётся годным здесь же — вторая аллокация была бы лишней.
    recordEpoch(placementTracker, epoch, update.active);
    worker.postMessage(update);

    // Лучи заводятся только на шаге воспроизведения. Перемотка не двигает
    // вспышки: пользователь не смотрит, как работали авторы, он ищет место в
    // истории.
    if (!rewound && engine.cursor >= 0) {
      const author = pack.commitAuthor[engine.cursor]!;
      const now = performance.now();
      for (const path of delta.touched) recent.push(path, author, now);
    }

    if (status) {
      // Описание репозитория за сессию не меняется и посчитано один раз выше:
      // на шаге воспроизведения остаётся только пересчитать живые узлы.
      let live = 0;
      for (let path = 0; path < pathCount; path++) if (scene.active[path] === 1) live++;
      liveNodes = live;
      renderStatus();
    }

    // Курсор или видимость сдвинулись — карточка выбранного узла устарела.
    // Саму пересборку делает цикл кадра не чаще раза в
    // INSPECTOR_REBUILD_INTERVAL_MS (см. showSelected), а не этот вызов.
    if (selected >= 0) inspectorDirty = true;
  }

  const transportRoot = document.getElementById('transport');

  const playback = new Playback(() => {
    applyDelta(engine.step());
    return engine.cursor < pack.meta.commitCount - 1;
  });

  const handles = transportRoot
    ? mountTransport(transportRoot, {
        commitCount: pack.meta.commitCount,
        commitEventStart: pack.commitEventStart,
        onSeek: (index: number) => {
          playback.pause();
          playback.reset();
          applyDelta(engine.seek(index), true, true);
          syncTransport();
        },
        onTogglePlay: () => {
          // С конца истории воспроизведение начинается заново с начала.
          if (!playback.playing && engine.cursor >= pack.meta.commitCount - 1) {
            applyDelta(engine.seek(-1), true, true);
          }
          playback.toggle();
          syncTransport();
        },
        onSpeedChange: (value: number) => {
          playback.speed = value;
        },
      })
    : null;

  function syncTransport(): void {
    handles?.setCursor(engine.cursor, formatCommitLabel(pack, engine.cursor));
    handles?.setPlaying(playback.playing);
  }

  /** Ключ хранилища привязан к репозиторию: у разных проектов свой набор. */
  const VISIBILITY_KEY = `gource-reborn:visibility:${pack.meta.repoName}`;

  // Разбор и сборка содержимого живут в кодеке рядом с разрешением видимости —
  // там их достаёт юнит-тест. Здесь остаётся только само хранилище: в приватном
  // режиме обращение к нему бросает, и это единственное, что тут ловится.
  function loadVisibility(): VisibilitySpec {
    try {
      return decodeVisibility(pack, localStorage.getItem(VISIBILITY_KEY));
    } catch {
      return { hidden: new Set(), collapsed: new Set() };
    }
  }

  function saveVisibility(spec: VisibilitySpec): void {
    try {
      localStorage.setItem(VISIBILITY_KEY, encodeVisibility(pack, spec));
    } catch {
      // Не беда: выбор просто не переживёт перезагрузку.
    }
  }

  if (sidebarRoot) {
    visibilitySpec = loadVisibility();
    sidebar = mountSidebar(sidebarRoot, {
      pack,
      initialVisibility: visibilitySpec,
      onFilter: (spec) => applyFilter(spec, performance.now()),
      onVisibility: (spec) => {
        saveVisibility(spec);
        applyVisibility(spec);
      },
      onSearch: (query) => applySearch(query),
      onSearchSubmit: (query) => {
        // applySearch уже снял прежний pendingFocus (образец сменился, пусть
        // и на тот же самый) — если результата нет, снимать больше нечего.
        const { first } = applySearch(query);
        // Нуль совпадений — камеру не трогаем вовсе: дёргать вид ради пустого
        // результата было бы хуже, чем оставить его как есть.
        if (first < 0) return;
        // attemptFocus сам решает: едет камера сразу, или узел ещё не получил
        // позицию от раскладки — тогда решение откладывается до ближайшего
        // сообщения воркера (см. worker.onmessage выше).
        pendingFocus = attemptFocus(first) ? null : first;
      },
    });
  }

  /**
   * Применяет новую спецификацию видимости: она убирает узлы из симуляции и
   * раскладки, поэтому нужен полный пересчёт от текущего курсора, а не
   * инкрементальная разница. Курсор при этом не двигается — `rewound: false`,
   * иначе буфер лучей и поле авторов стирались бы на каждый клик по панели.
   */
  function applyVisibility(next: VisibilitySpec): void {
    visibilitySpec = next;
    applyDelta(engine.seek(engine.cursor), true, false);
  }

  /**
   * Применяет новую спецификацию фильтра: она только гасит, поэтому дерево не
   * трогаем — запускаем плавный переход яркости от текущей к целевой.
   */
  function applyFilter(next: FilterSpec, nowMs: number): void {
    filterSpec = next;
    alphaFrom = scene.alpha.slice();
    alphaTo = computeAlpha(pack, filterSpec);
    alphaStartedAt = nowMs;
    alphaSettled = false;
  }

  applyDelta(engine.seek(pack.meta.commitCount - 1), true, true);
  syncTransport();

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Раскладка к этому моменту может уже стоять, и новых сообщений от воркера
    // не будет — вписываем сами, иначе после изменения размера окна (в том
    // числе из нулевого, как в скрытой вкладке) дерево осталось бы за кадром.
    followLayout();
  };
  window.addEventListener('resize', resize);
  resize();

  /** Имя пути без каталогов; у корня совпадает с именем репозитория. */
  function basename(fullPath: string): string {
    if (fullPath === '') return pack.meta.repoName;
    return fullPath.slice(fullPath.lastIndexOf('/') + 1);
  }

  /**
   * Текст подписи узла. Решение «показывать ли счётчик файлов» принимается
   * ровно здесь и один раз: счётчик уместен только у свёрнутой папки (папка,
   * и она есть в `visibilitySpec.collapsed`) — у обычного файла или у
   * развёрнутой папки его нечего показывать, даже если внутри что-то есть.
   * Без отдельной функции это решение расползлось бы по выражению-загадке в
   * цикле сборки слоя.
   */
  function labelTextFor(path: number): string {
    const isCollapsedFolder = pack.pathIsDir[path] === 1 && visibilitySpec.collapsed.has(path);
    return labelFor(basename(pack.paths[path] ?? ''), isCollapsedFolder ? scene.files[path]! : 0);
  }

  /** Наведённый путь; NOTHING — указателя на дереве нет. Считается раз в кадр. */
  let hovered = NOTHING;
  /** Последнее выставленное состояние курсора — чтобы менять его только при смене. */
  let cursorIsHover = false;

  // Исключение внутри кадра не должно молча остановить цикл на недостижимом
  // requestAnimationFrame: показываем причину и прекращаем цикл осознанно.
  let lastFrameMs = performance.now();
  const frame = (nowMs: number) => {
    const dt = (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;
    try {
      if (playback.advance(dt) > 0) syncTransport();

      // Пересборка устаревшей карточки — не чаще раза в
      // INSPECTOR_REBUILD_INTERVAL_MS (см. объявление флага выше): describeNode
      // стоит проход по путям и событиям, а applyDelta зовётся на каждый шаг
      // воспроизведения, так что пересборка на каждый коммит просадила бы кадр.
      if (inspectorDirty && nowMs - lastInspectorRebuildMs >= INSPECTOR_REBUILD_INTERVAL_MS) {
        showSelected();
        inspectorDirty = false;
        lastInspectorRebuildMs = nowMs;
      }

      // Весь вывод кадра из буфера событий живёт в deriveActivity: здесь
      // остаётся только разложить его результат по слоям сцены.
      const activity = deriveActivity(recent, scene, nowMs, ACTIVITY_CAPACITY);

      // Гасим только то, что светилось в прошлом кадре: полный проход по всем
      // путям на каждом кадре был бы дороже самой отрисовки лучей.
      for (const path of litPaths) flash[path] = 0;
      litPaths = [];
      for (const lit of activity.flashes) {
        flash[lit.path] = lit.strength;
        litPaths.push(lit.path);
      }

      beams.count = activity.beams.length;
      for (let i = 0; i < activity.beams.length; i++) {
        const beam = activity.beams[i]!;
        beams.toX[i] = beam.toX;
        beams.toY[i] = beam.toY;
        beams.author[i] = beam.author;
        beams.strength[i] = beam.strength;
        beams.alpha[i] = beam.alpha;
      }

      actorField.update(dt, activity.targets);

      // Начало луча — там, где значок оказался после этого шага поля.
      for (let i = 0; i < beams.count; i++) {
        const author = beams.author[i]!;
        beams.fromX[i] = actorField.positions[author * 2]!;
        beams.fromY[i] = actorField.positions[author * 2 + 1]!;
      }

      // Счётчик авторов в статусе — это ровно те, у кого есть цель, то есть
      // хоть один живой видимый файл. Он не может разойтись с картинкой,
      // потому что считается из того же вывода.
      if (activity.targets.length !== shownAuthors) {
        shownAuthors = activity.targets.length;
        renderStatus();
      }

      // Переход яркости фильтра: считаем, только пока он не завершён — иначе
      // смена фильтра переключала бы дерево резким миганием, а без признака
      // завершения полная копия alphaTo в scene.alpha выполнялась бы каждый
      // кадр вечно, даже когда фильтра нет вовсе.
      if (!alphaSettled) {
        const t = Math.min(1, (nowMs - alphaStartedAt) / ALPHA_TRANSITION_MS);
        if (t < 1) {
          for (let path = 0; path < pathCount; path++) {
            scene.alpha[path] = alphaFrom[path]! + (alphaTo[path]! - alphaFrom[path]!) * t;
          }
        } else {
          scene.alpha.set(alphaTo);
          alphaSettled = true;
        }
      }

      // Подбор наведённого узла — раз в кадр, а не на каждое движение
      // указателя (см. объявление pointerX/pointerY выше): pickNode — проход
      // по всем путям.
      if (pointerX >= 0 && pointerY >= 0) {
        const [wx, wy] = camera.toWorld(pointerX, pointerY);
        hovered =
          Number.isFinite(wx) && Number.isFinite(wy)
            ? pickNode(scene, wx, wy, PICK_SLACK_PX / camera.scale)
            : NOTHING;
      } else {
        hovered = NOTHING;
      }
      // Курсор меняется только при смене состояния наведения, а не каждый
      // кадр: запись в canvas.style.cursor лишний раз — это стиль-трэшинг,
      // которого лучше избегать даже при том, что браузер и сам не перекрасит
      // пиксели зря.
      const isHover = hovered !== NOTHING;
      if (isHover !== cursorIsHover) {
        canvas.style.cursor = isHover ? 'pointer' : 'default';
        cursorIsHover = isHover;
      }

      // Слой подписей: кто подписан и в каком порядке решает selectLabels,
      // здесь только перенос результата и сборка готового текста на узел.
      const labelPaths = selectLabels(scene, camera, canvas.clientWidth, canvas.clientHeight, {
        hovered,
      });
      scene.labels.count = labelPaths.length;
      for (let i = 0; i < labelPaths.length; i++) {
        const path = labelPaths[i]!;
        scene.labels.path[i] = path;
        scene.labels.text[i] = labelTextFor(path);
      }

      drawScene(ctx, camera, scene, canvas.clientWidth, canvas.clientHeight);
    } catch (error) {
      showFatal(
        `Не удалось отрисовать кадр: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  canvas.dataset.ready = 'true';
}

start().catch((error: unknown) => {
  showFatal(error instanceof Error ? error.message : 'Не удалось построить визуализацию.');
});
