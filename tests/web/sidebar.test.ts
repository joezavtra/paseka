// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { directChildren, mountSidebar, topExtensions } from '../../web/ui/sidebar.js';
import { buildPack } from '../../src/model/build.js';
import type { FilterSpec } from '../../web/state/filter.js';
import type { VisibilitySpec } from '../../web/state/visibility.js';

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

/** Пакет с типовым шумом: на нём проверяется кнопка «скрыть типовой шум». */
const noisyPack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня',
      authorEmail: 'anya@e.com',
      timestamp: 1,
      subject: 'c0',
      changes: [
        change('src/a.ts'),
        change('node_modules/pkg/index.js'),
        change('dist/bundle.js'),
        change('vendor/lib.php'),
        change('build/out.o'),
        change('target/debug/bin'),
      ],
    },
  ],
  { repoName: 'noisy', head: 'c0' },
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

describe('mountSidebar — начальная видимость', () => {
  it('снимает галочку у папки, скрытой в прошлой сессии', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, {
      pack,
      initialVisibility: { hidden: new Set([id('src')]), collapsed: new Set() },
      onFilter: () => {},
      onVisibility: () => {},
    });

    const src = root.querySelector<HTMLInputElement>(`input[data-hide="${id('src')}"]`)!;
    const docs = root.querySelector<HTMLInputElement>(`input[data-hide="${id('docs')}"]`)!;
    // Восстановлено ровно то, что скрывали, и ничего сверх.
    expect(src.checked).toBe(false);
    expect(docs.checked).toBe(true);
  });

  it('показывает свёрнутой ту папку, что была свёрнута в прошлой сессии', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, {
      pack,
      initialVisibility: { hidden: new Set(), collapsed: new Set([id('docs')]) },
      onFilter: () => {},
      onVisibility: () => {},
    });

    const docs = root.querySelector<HTMLButtonElement>(`button[data-collapse="${id('docs')}"]`)!;
    const src = root.querySelector<HTMLButtonElement>(`button[data-collapse="${id('src')}"]`)!;
    expect(docs.getAttribute('aria-label')).toContain('Развернуть папку на сцене');
    expect(src.getAttribute('aria-label')).toContain('Свернуть папку в один узел');
  });

  it('без сохранённой видимости не скрывает и не сворачивает ничего', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });

    const boxes = [...root.querySelectorAll<HTMLInputElement>('input[data-hide]')];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });
});

describe('mountSidebar — чипы расширений', () => {
  it('сообщает выбранное расширение и снимает выбор повторным нажатием', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: FilterSpec | null = null;
    mountSidebar(root, { pack, onFilter: (spec) => (last = spec), onVisibility: () => {} });

    const chip = root.querySelector<HTMLButtonElement>('button[data-ext="ts"]')!;
    chip.click();
    expect([...(last as unknown as FilterSpec).extensions!]).toEqual(['ts']);
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    chip.click();
    // Ни одного выбранного расширения — это отсутствие фильтра, а не пустое
    // множество: пустое погасило бы вообще всё.
    expect((last as unknown as FilterSpec).extensions).toBeNull();
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('копит несколько расширений одновременно', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: FilterSpec | null = null;
    mountSidebar(root, { pack, onFilter: (spec) => (last = spec), onVisibility: () => {} });

    root.querySelector<HTMLButtonElement>('button[data-ext="ts"]')!.click();
    root.querySelector<HTMLButtonElement>('button[data-ext="md"]')!.click();
    expect([...(last as unknown as FilterSpec).extensions!].sort()).toEqual(['md', 'ts']);
  });
});

describe('mountSidebar — кнопка типового шума', () => {
  it('скрывает каталоги зависимостей и сборки, не трогая свой код', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: VisibilitySpec | null = null;
    mountSidebar(root, {
      pack: noisyPack,
      onFilter: () => {},
      onVisibility: (spec) => (last = spec),
    });

    root.querySelector<HTMLButtonElement>('button[data-role="noise"]')!.click();

    const noisyId = (path: string) => noisyPack.paths.indexOf(path);
    const hidden = (last as unknown as VisibilitySpec).hidden;
    for (const dir of ['node_modules', 'dist', 'vendor', 'build', 'target']) {
      expect(hidden.has(noisyId(dir)), dir).toBe(true);
    }
    expect(hidden.has(noisyId('src'))).toBe(false);
  });

  it('снимает галочки скрытых папок в навигаторе', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSidebar(root, { pack: noisyPack, onFilter: () => {}, onVisibility: () => {} });

    const noisyId = (path: string) => noisyPack.paths.indexOf(path);
    root.querySelector<HTMLButtonElement>('button[data-role="noise"]')!.click();

    expect(
      root.querySelector<HTMLInputElement>(`input[data-hide="${noisyId('node_modules')}"]`)!.checked,
    ).toBe(false);
    expect(
      root.querySelector<HTMLInputElement>(`input[data-hide="${noisyId('src')}"]`)!.checked,
    ).toBe(true);
  });
});

describe('mountSidebar — видимость задаётся снаружи', () => {
  // Во второй половине среза инспектор будет скрывать и сворачивать папку из
  // своего окна. Держателей состояния видимости должно остаться столько же,
  // сколько было: панель обязана принять чужое состояние как своё.
  it('принимает новую видимость и перерисовывает навигатор', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handles = mountSidebar(root, { pack, onFilter: () => {}, onVisibility: () => {} });

    handles.setVisibility({ hidden: new Set([id('src')]), collapsed: new Set([id('docs')]) });

    expect(root.querySelector<HTMLInputElement>(`input[data-hide="${id('src')}"]`)!.checked).toBe(
      false,
    );
    expect(
      root
        .querySelector<HTMLButtonElement>(`button[data-collapse="${id('docs')}"]`)!
        .getAttribute('aria-label'),
    ).toContain('Развернуть папку на сцене');
  });

  it('не зовёт обратный колбэк: иначе получилась бы петля', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let calls = 0;
    const handles = mountSidebar(root, {
      pack,
      onFilter: () => {},
      onVisibility: () => calls++,
    });

    handles.setVisibility({ hidden: new Set([id('src')]), collapsed: new Set() });

    expect(calls).toBe(0);
  });

  it('принятое снаружи состояние становится своим: следующий клик считает от него', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let last: VisibilitySpec | null = null;
    const handles = mountSidebar(root, {
      pack,
      onFilter: () => {},
      onVisibility: (spec) => (last = spec),
    });

    handles.setVisibility({ hidden: new Set([id('src')]), collapsed: new Set() });
    // Скрываем вторую папку кликом — первая обязана остаться скрытой.
    const docs = root.querySelector<HTMLInputElement>(`input[data-hide="${id('docs')}"]`)!;
    docs.checked = false;
    docs.dispatchEvent(new Event('change', { bubbles: true }));

    const hidden = (last as unknown as VisibilitySpec).hidden;
    expect([...hidden].sort((a, b) => a - b)).toEqual([id('src'), id('docs')].sort((a, b) => a - b));
  });
});
