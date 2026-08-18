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
}

/**
 * Каталоги, которые почти никогда не нужны на сцене. Ничего из этого по
 * умолчанию не скрыто: инструмент не должен молча прятать данные. Кнопка
 * рядом применяет весь набор одним нажатием — на типичном JS-репозитории без
 * неё первая картинка это ком зависимостей, в котором не видно своего кода.
 */
const NOISE = ['node_modules', 'vendor', 'dist', 'build', 'target', '.git'];

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
  const pathField = document.createElement('input');
  pathField.type = 'text';
  pathField.dataset.role = 'path';
  pathField.placeholder = 'например, src/* или utils';
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

  function renderTree(parent: number, container: HTMLElement): void {
    for (const child of directChildren(pack, parent)) {
      if (pack.pathIsDir[child] !== 1) continue; // скрывать можно только папки

      const row = document.createElement('div');
      row.className = 'tree-row';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = expanded.has(child) ? '▾' : '▸';
      toggle.setAttribute('aria-label', expanded.has(child) ? 'Свернуть список' : 'Развернуть список');
      toggle.addEventListener('click', () => {
        if (expanded.has(child)) expanded.delete(child);
        else expanded.add(child);
        refreshTree();
      });

      const show = document.createElement('input');
      show.type = 'checkbox';
      show.checked = !hidden.has(child);
      show.dataset.hide = String(child);
      show.setAttribute('aria-label', 'Показывать папку');
      show.addEventListener('change', () => {
        if (show.checked) hidden.delete(child);
        else hidden.add(child);
        emitVisibility();
      });

      const fold = document.createElement('button');
      fold.type = 'button';
      fold.dataset.collapse = String(child);
      fold.textContent = collapsed.has(child) ? '◼' : '◻';
      fold.setAttribute('aria-label', collapsed.has(child) ? 'Развернуть папку на сцене' : 'Свернуть папку в один узел');
      fold.addEventListener('click', () => {
        if (collapsed.has(child)) collapsed.delete(child);
        else collapsed.add(child);
        fold.textContent = collapsed.has(child) ? '◼' : '◻';
        emitVisibility();
      });

      const name = document.createElement('span');
      name.textContent = pack.paths[child]!.slice(pack.paths[child]!.lastIndexOf('/') + 1);

      row.append(toggle, show, fold, name);
      container.append(row);

      if (expanded.has(child)) {
        const children = document.createElement('div');
        children.className = 'tree-children';
        container.append(children);
        renderTree(child, children);
      }
    }
  }

  function refreshTree(): void {
    treeRoot.replaceChildren();
    renderTree(0, treeRoot);
  }

  refreshTree();
  root.append(authorsBox, pathBox, extBox, treeBox);

  return {
    unmount(): void {
      // Все обработчики висят на элементах внутри корня, поэтому очистка
      // содержимого снимает их вместе с узлами; отдельных слушателей на окне
      // или документе панель не заводит.
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
