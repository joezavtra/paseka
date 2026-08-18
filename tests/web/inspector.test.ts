// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildPack } from '../../src/model/build.js';
import { describeNode } from '../../web/state/node-info.js';
import { TimeEngine } from '../../web/time/engine.js';
import { mountInspector } from '../../web/ui/inspector.js';

const change = (path: string, added: number) => ({
  path,
  kind: 'add' as const,
  added,
  deleted: 0,
  binary: false,
});

const pack = buildPack(
  [
    {
      hash: 'c0',
      authorName: 'Аня Петрова',
      authorEmail: 'anya@e.com',
      timestamp: 1700000000,
      subject: 'первый',
      changes: [change('src/a.ts', 10), change('src/b.ts', 4)],
    },
    {
      hash: 'c1',
      authorName: 'Бо Ли',
      authorEmail: 'bo@e.com',
      timestamp: 1700086400,
      subject: 'второй',
      changes: [change('docs/c.md', 2)],
    },
  ],
  { repoName: 'demo', head: 'c1' },
);

function infoFor(path: string) {
  const engine = new TimeEngine(pack);
  engine.seek(pack.meta.commitCount - 1);
  const id = pack.paths.indexOf(path);
  return describeNode(pack, id, engine.cursor, engine.alive, engine.sizes);
}

describe('карточка узла', () => {
  it('до выбора узла скрыта', () => {
    const root = document.createElement('aside');
    mountInspector(root, { pack });
    expect(root.hidden).toBe(true);
  });

  it('показывает путь, размер и авторов', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src/a.ts'));

    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain('src/a.ts');
    expect(root.textContent).toContain('10');
    expect(root.textContent).toContain('Аня Петрова');
    // Автор, не касавшийся файла, в карточке не появляется.
    expect(root.textContent).not.toContain('Бо Ли');
    handles.unmount();
  });

  it('у каталога показывает число файлов', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src'));
    expect(root.textContent).toContain('файл');
    expect(root.textContent).toContain('14'); // 10 + 4 строк
    handles.unmount();
  });

  it('перерисовывается при показе другого узла, а не дописывается', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src/a.ts'));
    handles.show(infoFor('docs/c.md'));
    expect(root.textContent).toContain('docs/c.md');
    expect(root.textContent).not.toContain('src/a.ts');
    handles.unmount();
  });

  it('закрывается кнопкой и Escape, сообщая об этом наружу', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));

    const button = root.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBeTruthy();
    button!.click();
    expect(root.hidden).toBe(true);
    expect(closed).toBe(1);

    handles.show(infoFor('src/a.ts'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.hidden).toBe(true);
    expect(closed).toBe(2);
    handles.unmount();
  });

  it('unmount снимает обработчик Escape', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));
    handles.unmount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(0);
  });
});
