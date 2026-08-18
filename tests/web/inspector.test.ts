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

function infoFor(path: string, options: { represented?: number } = {}) {
  const engine = new TimeEngine(pack);
  engine.seek(pack.meta.commitCount - 1);
  const id = pack.paths.indexOf(path);
  return describeNode(pack, id, engine.cursor, engine.alive, engine.sizes, options);
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
    // Не просто '10': подстрока нашлась бы и в дате рождения (2023-11-14) —
    // проверяем ровно ту строку, которую печатает сводка.
    expect(root.textContent).toContain('строк: 10');
    expect(root.textContent).toContain('Аня Петрова');
    // Автор, не касавшийся файла, в карточке не появляется.
    expect(root.textContent).not.toContain('Бо Ли');
    handles.unmount();
  });

  it('у каталога показывает число файлов', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src'));
    // Не просто '14': подстрока нашлась бы и в дате рождения (2023-11-14) —
    // проверяем ровно строки, которые печатает сводка (10 + 4 строк, 2 файла).
    expect(root.textContent).toContain('строк: 14');
    expect(root.textContent).toContain('файлов: 2');
    handles.unmount();
  });

  it('в обычном случае (ничего не скрыто) не упоминает сцену вовсе', () => {
    // represented === files — расхождения нет, клауза не нужна: карточка
    // выглядит как раньше, без утверждения про то, что показано на сцене.
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src', { represented: 2 }));
    expect(root.textContent).not.toContain('на сцене');
    handles.unmount();
  });

  it('когда свёрнутая папка прячет скрытое поддерево, называет и разницу', () => {
    // Карточка отвечает «сколько живого внутри» (files), подпись на сцене —
    // «сколько представлено одним кружком» (represented). Расходятся —
    // карточка обязана назвать обе цифры, а не молча показать только files.
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src', { represented: 1 }));
    expect(root.textContent).toContain('файлов: 2');
    expect(root.textContent).toContain('на сцене показан 1');
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

  it('пересборка карточки не создаёт кнопку закрытия заново', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src/a.ts'));
    const button = root.querySelector('button');

    // На воспроизведении show() зовётся до нескольких раз в секунду (см.
    // INSPECTOR_REBUILD_INTERVAL_MS в web/main.ts). Полная пересборка на
    // каждый вызов рвала бы клавиатурный фокус на кнопке закрытия — она
    // обязана оставаться тем же самым элементом, а не toBeTruthy().
    handles.show(infoFor('docs/c.md'));
    expect(root.querySelector('button')).toBe(button);
    handles.unmount();
  });

  it('закрывается кнопкой и Escape, сообщая об этом наружу', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));

    const button = root.querySelector('button');
    // Не просто toBeTruthy(): '✕' сам по себе тоже truthy и ничего не значит
    // для скринридера — проверяем осмысленный текст.
    expect(button?.getAttribute('aria-label')).toBe('Закрыть карточку узла');
    button!.click();
    expect(root.hidden).toBe(true);
    expect(closed).toBe(1);

    handles.show(infoFor('src/a.ts'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.hidden).toBe(true);
    expect(closed).toBe(2);
    handles.unmount();
  });

  it('Escape в текстовом поле карточку не закрывает, а вне поля — закрывает', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));

    const input = document.createElement('input');
    document.body.append(input);
    // dispatchEvent прямо на input — событие всплывает к document с
    // event.target === input, как при настоящем нажатии в сфокусированном
    // поле. У Escape там своё поведение (отменить правку) — глобальный
    // обработчик карточки не должен его отбирать.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.hidden).toBe(false);
    expect(closed).toBe(0);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.hidden).toBe(true);
    expect(closed).toBe(1);

    input.remove();
    handles.unmount();
  });

  it('unmount снимает обработчик Escape', () => {
    const root = document.createElement('aside');
    let closed = 0;
    const handles = mountInspector(root, { pack, onClose: () => closed++ });
    handles.show(infoFor('src/a.ts'));
    handles.unmount();

    // unmount() сам ставит root.hidden = true, а обработчик выходит по
    // `if (root.hidden) return` — без этого шага тест прошёл бы, даже если
    // убрать document.removeEventListener из unmount(), потому что guard по
    // hidden молчаливо спас бы дефектную реализацию. Выставляем hidden в
    // обход hide()/show(), чтобы проверить именно снятие подписки.
    root.hidden = false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toBe(0);
  });
});
