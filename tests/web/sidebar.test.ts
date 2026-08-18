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
});
