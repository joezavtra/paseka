import { describePack, loadPack, showFatal } from './boot.js';
import { TimeEngine, type TimeDelta } from './time/engine.js';
import { buildActiveLinks, diffBorn, radiusFor } from './layout/graph.js';
import type { FromWorker, LayoutInit, LayoutUpdate } from './layout/protocol.js';
import { Camera } from './render/camera.js';
import { drawScene, type SceneInput } from './render/scene.js';
import { DIR_COLOR_INDEX, paletteIndexForPath } from './render/palette.js';
import { deriveActivity } from './render/activity.js';
import { NOTHING, pickNode } from './render/pick.js';
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

  const scene: SceneInput & { representative: Int32Array } = {
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

  const camera = new Camera();
  camera.attach(canvas);

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
   */
  function refreshHits(): { first: number; count: number } {
    const projected = projectHits(searchHits, scene.representative, scene.active);
    scene.hit = projected.drawnHits;
    sidebar?.setSearchCount(projected.count, searchQuery);
    return { first: projected.first, count: projected.count };
  }

  /** Пересчитывает маску попаданий по новому образцу и проецирует её заново. */
  function applySearch(query: string): { first: number; count: number } {
    searchQuery = query;
    searchHits = computeHits(pack, searchQuery);
    return refreshHits();
  }

  const worker = new Worker(new URL('./layout/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type !== 'positions') return;
    scene.positions = event.data.positions;
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
    const bornThisDelta = new Set(born);
    for (const path of born) {
      const parentId = pack.pathParent[path]!;
      if (parentId === path) continue; // корень
      if (scene.active[parentId] !== 1) continue;
      if (bornThisDelta.has(parentId)) continue;
      scene.positions[path * 2] = scene.positions[parentId * 2]!;
      scene.positions[path * 2 + 1] = scene.positions[parentId * 2 + 1]!;
    }

    const links = buildActiveLinks(scene.active, pack.pathParent);
    scene.linkSource = links.source;
    scene.linkTarget = links.target;

    const update: LayoutUpdate = {
      type: 'update',
      active: scene.active.slice(),
      added: born,
      radiusIds: Uint32Array.from(radiusIds),
      radiusValues: Float32Array.from(radiusValues),
      linkSource: links.source,
      linkTarget: links.target,
    };
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
        const { first } = applySearch(query);
        // Нуль совпадений — камеру не трогаем вовсе: дёргать вид ради пустого
        // результата было бы хуже, чем оставить его как есть.
        if (first < 0) return;
        const { left, width, height } = viewBox();
        camera.focusOn(scene.positions[first * 2]!, scene.positions[first * 2 + 1]!, width, height, left);
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
