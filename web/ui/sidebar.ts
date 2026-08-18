import type { Pack } from '../../src/model/types.js';
import { extensionOf, type FilterSpec } from '../state/filter.js';
import type { VisibilitySpec } from '../state/visibility.js';

export interface SidebarOptions {
  pack: Pack;
  /** Видимость, восстановленная из хранилища; по умолчанию не скрыто ничего. */
  initialVisibility?: VisibilitySpec;
  onFilter(spec: FilterSpec): void;
  onVisibility(spec: VisibilitySpec): void;
}

export interface SidebarHandles {
  unmount(): void;
  /**
   * Задаёт видимость снаружи: панель перерисовывает навигатор и принимает
   * новое состояние как своё. Держатель состояния остаётся один — иначе
   * инспектор (вторая половина среза), скрывая папку из своего окна, разошёлся
   * бы с галочками в панели. Обратный колбэк отсюда не зовётся намеренно:
   * состояние пришло снаружи, и возврат его наружу замкнул бы петлю.
   */
  setVisibility(spec: VisibilitySpec): void;
}

/**
 * Каталоги, которые почти никогда не нужны на сцене. Ничего из этого по
 * умолчанию не скрыто: инструмент не должен молча прятать данные. Кнопка
 * рядом применяет весь набор одним нажатием — на типичном JS-репозитории без
 * неё первая картинка это ком зависимостей, в котором не видно своего кода.
 *
 * Только каталоги и только достижимое этой кнопкой. Каталога служебных данных
 * git (`.git`) в истории не бывает никогда — git не версионирует сам себя, и
 * строка в списке просто вводила в заблуждение. Файловые образцы из спеки
 * (`.min.*`, lock-файлы) сюда не попали сознательно: скрывать можно и файл, но
 * навигатор показывает одни папки, и снять такое скрытие пользователю было бы
 * уже нечем — кнопка спрятала бы данные без пути назад.
 */
const NOISE = ['node_modules', 'vendor', 'dist', 'build', 'target'];

/**
 * Счётчик установок панели — источник уникальных id для программной связки
 * заголовка секции с полем ввода (`aria-labelledby`). `Math.random()` в
 * `web/` запрещён, а несколько смонтированных панелей в одном документе не
 * должны получать одинаковый id.
 */
let sidebarInstanceCounter = 0;

/** Самые частые расширения файлов, по убыванию. */
export function topExtensions(pack: Pack, limit: number): string[] {
  const counts = new Map<string, number>();
  for (let path = 0; path < pack.meta.pathCount; path++) {
    if (pack.pathIsDir[path] === 1) continue;
    const ext = extensionOf(pack.paths[path]!);
    if (ext === '') continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([ext]) => ext);
}

/**
 * Прямые потомки пути. Полный обход допустим: навигатор строится лениво, при
 * раскрытии узла, а не каждый кадр.
 */
export function directChildren(pack: Pack, parent: number): number[] {
  const children: number[] = [];
  for (let path = 1; path < pack.meta.pathCount; path++) {
    if (pack.pathParent[path] === parent) children.push(path);
  }
  return children;
}

export function mountSidebar(root: HTMLElement, options: SidebarOptions): SidebarHandles {
  const { pack } = options;
  root.hidden = false;
  root.replaceChildren();
  const instanceId = sidebarInstanceCounter++;

  const checkedAuthors = new Set<number>(pack.authors.map((_, index) => index));
  const chosenExtensions = new Set<string>();
  const hidden = new Set<number>(options.initialVisibility?.hidden ?? []);
  const collapsed = new Set<number>(options.initialVisibility?.collapsed ?? []);
  let pathQuery = '';

  function emitFilter(): void {
    options.onFilter({
      // Все галочки на месте — это отсутствие фильтра, а не совпадение со
      // всеми: иначе автор без единого файла гасил бы всё дерево.
      authors: checkedAuthors.size === pack.authors.length ? null : new Set(checkedAuthors),
      pathQuery,
      extensions: chosenExtensions.size === 0 ? null : new Set(chosenExtensions),
    });
  }

  function emitVisibility(): void {
    options.onVisibility({ hidden: new Set(hidden), collapsed: new Set(collapsed) });
  }

  function section(title: string): HTMLElement {
    const box = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = title;
    box.append(heading);
    return box;
  }

  const authorsBox = section('Авторы');
  pack.authors.forEach((author, index) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.author = String(index);
    box.addEventListener('change', () => {
      if (box.checked) checkedAuthors.add(index);
      else checkedAuthors.delete(index);
      emitFilter();
    });
    const name = document.createElement('span');
    name.textContent = author.name || author.email;
    label.append(box, name);
    authorsBox.append(label);
  });

  const pathBox = section('Путь');
  // Подсказка (placeholder) распознаётся ассистивными технологиями не так
  // надёжно, как настоящее имя, и никак не связана с заголовком раздела —
  // связываем поле с заголовком явно через aria-labelledby.
  const pathHeading = pathBox.querySelector('h2')!;
  pathHeading.id = `sidebar-path-heading-${instanceId}`;
  const pathField = document.createElement('input');
  pathField.type = 'text';
  pathField.dataset.role = 'path';
  pathField.placeholder = 'например, src/* или utils';
  pathField.setAttribute('aria-labelledby', pathHeading.id);
  pathField.addEventListener('input', () => {
    pathQuery = pathField.value;
    emitFilter();
  });
  pathBox.append(pathField);

  const extBox = section('Расширения');
  for (const ext of topExtensions(pack, 12)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.ext = ext;
    chip.textContent = ext;
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (chosenExtensions.has(ext)) chosenExtensions.delete(ext);
      else chosenExtensions.add(ext);
      chip.setAttribute('aria-pressed', chosenExtensions.has(ext) ? 'true' : 'false');
      emitFilter();
    });
    extBox.append(chip);
  }

  const treeBox = section('Дерево');
  const noiseButton = document.createElement('button');
  noiseButton.type = 'button';
  noiseButton.dataset.role = 'noise';
  noiseButton.textContent = 'Скрыть типовой шум';
  noiseButton.addEventListener('click', () => {
    for (let path = 1; path < pack.meta.pathCount; path++) {
      if (pack.pathIsDir[path] !== 1) continue;
      const name = pack.paths[path]!.slice(pack.paths[path]!.lastIndexOf('/') + 1);
      if (NOISE.includes(name)) hidden.add(path);
    }
    refreshTree();
    emitVisibility();
  });
  treeBox.append(noiseButton);

  const treeRoot = document.createElement('div');
  treeBox.append(treeRoot);

  /** Раскрытые узлы: дети строятся лениво и только для них. */
  const expanded = new Set<number>([0]);

  /**
   * Строит одну строку навигатора и контейнер её потомков. Раскрытие и
   * схлопывание по клику трогают только этот контейнер, а не всю панель:
   * прежде клик по стрелке звал полную перестройку от корня, и кнопка, на
   * которой стоял клавиатурный фокус, удалялась из документа и создавалась
   * заново — фокус откатывался в начало панели на каждый шаг по вложенному
   * дереву. Разово перестраивать только своё поддерево дешевле и не рвёт
   * фокус: сама кнопка `toggle` никогда не пересоздаётся.
   */
  function renderRow(child: number, container: HTMLElement): void {
    const folderName = pack.paths[child]!.slice(pack.paths[child]!.lastIndexOf('/') + 1);

    const row = document.createElement('div');
    row.className = 'tree-row';

    const childrenBox = document.createElement('div');
    childrenBox.className = 'tree-children';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.toggle = String(child);
    // Имя папки — часть доступного имени каждой кнопки строки, иначе
    // пользователь скринридера слышит в списке из десятка папок одну и ту же
    // фразу и не может понять, к какой из них она относится.
    function updateToggle(): void {
      toggle.textContent = expanded.has(child) ? '▾' : '▸';
      toggle.setAttribute(
        'aria-label',
        expanded.has(child) ? `Свернуть список: ${folderName}` : `Развернуть список: ${folderName}`,
      );
    }
    updateToggle();
    toggle.addEventListener('click', () => {
      if (expanded.has(child)) {
        expanded.delete(child);
        // Схлопывание — единственный случай, когда содержимому поддерева
        // действительно место исчезнуть из документа: пользователь только
        // что нажал именно на эту кнопку, а не на что-то внутри.
        childrenBox.replaceChildren();
      } else {
        expanded.add(child);
        renderTree(child, childrenBox);
      }
      updateToggle();
    });

    const show = document.createElement('input');
    show.type = 'checkbox';
    show.checked = !hidden.has(child);
    show.dataset.hide = String(child);
    show.setAttribute('aria-label', `Показывать папку: ${folderName}`);
    show.addEventListener('change', () => {
      if (show.checked) hidden.delete(child);
      else hidden.add(child);
      emitVisibility();
    });

    const fold = document.createElement('button');
    fold.type = 'button';
    fold.dataset.collapse = String(child);
    function updateFold(): void {
      fold.textContent = collapsed.has(child) ? '◼' : '◻';
      fold.setAttribute(
        'aria-label',
        collapsed.has(child)
          ? `Развернуть папку на сцене: ${folderName}`
          : `Свернуть папку в один узел: ${folderName}`,
      );
    }
    updateFold();
    fold.addEventListener('click', () => {
      if (collapsed.has(child)) collapsed.delete(child);
      else collapsed.add(child);
      // Значок сменился — доступное имя обязано смениться вместе с ним,
      // иначе кнопка после клика говорит скринридеру неправду о своём
      // текущем действии.
      updateFold();
      emitVisibility();
    });

    const name = document.createElement('span');
    name.textContent = folderName;

    row.append(toggle, show, fold, name);
    container.append(row, childrenBox);

    if (expanded.has(child)) renderTree(child, childrenBox);
  }

  function renderTree(parent: number, container: HTMLElement): void {
    for (const child of directChildren(pack, parent)) {
      if (pack.pathIsDir[child] !== 1) continue; // скрывать можно только папки
      renderRow(child, container);
    }
  }

  function refreshTree(): void {
    treeRoot.replaceChildren();
    renderTree(0, treeRoot);
  }

  refreshTree();
  root.append(authorsBox, pathBox, extBox, treeBox);

  return {
    setVisibility(spec: VisibilitySpec): void {
      hidden.clear();
      for (const path of spec.hidden) hidden.add(path);
      collapsed.clear();
      for (const path of spec.collapsed) collapsed.add(path);
      // Перерисовываем весь навигатор: снаружи могли поменять что угодно и на
      // любой глубине, а точечно обновлять строки было бы дороже и хрупче.
      refreshTree();
    },

    unmount(): void {
      // Все обработчики висят на элементах внутри корня, поэтому очистка
      // содержимого снимает их вместе с узлами; отдельных слушателей на окне
      // или документе панель не заводит.
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
