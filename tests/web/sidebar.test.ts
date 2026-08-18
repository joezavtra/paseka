// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { directChildren, mountSidebar, topExtensions } from '../../web/ui/sidebar.js';
import { buildPack } from '../../src/model/build.js';
import type { RawCommit } from '../../src/git/types.js';

const change = (path: string) => ({
  path,
  kind: 'add' as const,
  added: 1,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1,
      subject: 'c0',
      changes: [change('src/a.ts'), change('src/b.ts'), change('docs/c.md')],
    },
  ],
  { repoName: 'demo', head: 'c0' },
);

const id = (path: string) => pack.paths.indexOf(path);

describe('topExtensions', () => {
  it('возвращает самые частые расширения по убыванию', () => {
    expect(topExtensions(pack, 5)).toEqual(['ts', 'md']);
  });

  it('уважает предел', () => {
    expect(topExtensions(pack, 1)).toEqual(['ts']);
  });
});

describe('directChildren', () => {
  it('отдаёт только прямых потомков', () => {
    expect(directChildren(pack, id('src')).map((child) => pack.paths[child])).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('у листа потомков нет', () => {
    expect(directChildren(pack, id('src/a.ts'))).toEqual([]);
  });
});

describe('mountSidebar', () => {
  it('сообщает выбранных авторов', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: unknown = null;
    mountSidebar(root, { pack, onFilter: (spec) => (last = spec), onVisibility: () => {} });

    const box = root.querySelector<HTMLInputElement>('input[data-author="0"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect((last as { authors: Set<number> }).authors.has(0)).toBe(false);
  });

  it('сообщает образец пути', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: unknown = null;
    mountSidebar(root, { pack, onFilter: (spec) => (last = spec), onVisibility: () => {} });

    const field = root.querySelector<HTMLInputElement>('input[data-role="path"]')!;
    field.value = 'src/*';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect((last as { pathQuery: string }).pathQuery).toBe('src/*');
  });

  it('сообщает скрытие папки', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: unknown = null;
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: (spec) => (last = spec) });

    const box = root.querySelector<HTMLInputElement>(`input[data-hide="${id('src')}"]`)!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect((last as { hidden: Set<number> }).hidden.has(id('src'))).toBe(true);
  });

  it('снимает обработчики при размонтировании', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handles = mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });
    handles.unmount();
    expect(root.children.length).toBe(0);
  });

  it('не теряет клавиатурный фокус при раскрытии своего узла', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });

    const toggle = root.querySelector<HTMLButtonElement>(`button[data-toggle="${id('src')}"]`)!;
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    toggle.click();
    // Раскрытие перестраивает только контейнер потомков, а не всю панель:
    // кнопка, на которой стоял фокус, не должна пересоздаваться.
    expect(document.activeElement).toBe(toggle);
  });

  it('меняет и значок, и доступное имя кнопки сворачивания при клике', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });

    const fold = root.querySelector<HTMLButtonElement>(`button[data-collapse="${id('src')}"]`)!;
    const iconBefore = fold.textContent;
    const labelBefore = fold.getAttribute('aria-label');

    fold.click();

    expect(fold.textContent).not.toBe(iconBefore);
    expect(fold.getAttribute('aria-label')).not.toBe(labelBefore);
    expect(fold.getAttribute('aria-label')).toContain('src');
  });

  it('называет папку в доступных именах чекбокса и кнопки сворачивания строки', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });

    const show = root.querySelector<HTMLInputElement>(`input[data-hide="${id('src')}"]`)!;
    const fold = root.querySelector<HTMLButtonElement>(`button[data-collapse="${id('src')}"]`)!;
    expect(show.getAttribute('aria-label')).toContain('src');
    expect(fold.getAttribute('aria-label')).toContain('src');
  });

  it('связывает поле пути с заголовком раздела', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });

    const field = root.querySelector<HTMLInputElement>('input[data-role="path"]')!;
    const labelledBy = field.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Путь');
  });
});
