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
      // Файл прямо в корне репозитория: его полный путь и есть его имя — на
      // этом проверяется, что карточка не печатает одну и ту же строку дважды.
      changes: [change('docs/c.md', 2), change('README.md', 3)],
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

/** Отдельный пакет с удалением файла: на нём проверяется пометка «удалён». */
const deletedPack = buildPack(
  [
    {
      hash: 'd0',
      authorName: 'Аня Петрова',
      authorEmail: 'anya@e.com',
      timestamp: 1700000000,
      subject: 'завёл',
      changes: [change('src/gone.ts', 7)],
    },
    {
      hash: 'd1',
      authorName: 'Аня Петрова',
      authorEmail: 'anya@e.com',
      timestamp: 1700086400,
      subject: 'убрал',
      changes: [
        { path: 'src/gone.ts', kind: 'delete' as const, added: 0, deleted: 7, binary: false },
      ],
    },
  ],
  { repoName: 'demo', head: 'd1' },
);

/** Описание файла, который к концу истории уже удалён. */
function infoDeleted() {
  const engine = new TimeEngine(deletedPack);
  engine.seek(deletedPack.meta.commitCount - 1);
  const id = deletedPack.paths.indexOf('src/gone.ts');
  return describeNode(deletedPack, id, engine.cursor, engine.alive, engine.sizes);
}

/**
 * То же описание, но на курсоре до начала истории: узел ещё не родился —
 * `birthCommit === -1`, живым он не числится. Не то же самое, что удалённый,
 * и карточка обязана различать эти два случая.
 */
function infoBeforeBirth(path: string) {
  const engine = new TimeEngine(pack);
  engine.seek(-1);
  const id = pack.paths.indexOf(path);
  return describeNode(pack, id, engine.cursor, engine.alive, engine.sizes);
}

describe('карточка узла', () => {
  it('до выбора узла скрыта', () => {
    const root = document.createElement('aside');
    // Размонтируем, как и все остальные тесты файла: happy-dom даёт один
    // document на весь файл, карточка вешает на него глобальный обработчик
    // Escape, и не снятая подписка утекала бы в соседние тесты — ровно то,
    // что сторожит тест «unmount снимает обработчик Escape» ниже.
    const handles = mountInspector(root, { pack });
    expect(root.hidden).toBe(true);
    handles.unmount();
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

  it('не повторяет имя второй строкой, когда путь совпадает с заголовком', () => {
    // Всё, что лежит прямо в корне репозитория, печаталось дважды: «README.md»
    // заголовком и «README.md» строкой пути под ним. Вторая строка не
    // добавляет ничего и не должна занимать место.
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('README.md'));

    expect(root.querySelector('h2')!.textContent).toBe('README.md');
    const pathLine = root.querySelector<HTMLElement>('.path')!;
    expect(pathLine.hidden).toBe(true);
    expect(pathLine.textContent).toBe('');
    handles.unmount();
  });

  it('у корня репозитория тоже не повторяет имя', () => {
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor(''));

    expect(root.querySelector('h2')!.textContent).toBe('demo');
    expect(root.querySelector<HTMLElement>('.path')!.hidden).toBe(true);
    handles.unmount();
  });

  it('у вложенного файла печатает полный путь отдельной строкой', () => {
    // Обратная сторона той же правки: там, где путь добавляет каталоги,
    // строка обязана остаться — иначе карточка перестала бы отвечать «где
    // лежит этот файл».
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoFor('src/a.ts'));

    const pathLine = root.querySelector<HTMLElement>('.path')!;
    expect(pathLine.hidden).toBe(false);
    expect(pathLine.textContent).toBe('src/a.ts');
    handles.unmount();
  });

  it('удалённый узел помечается удалённым', () => {
    // Обратная сторона правки ниже: пометка обязана остаться там, где она
    // правдива — узел был и исчез. Без этой проверки мутант «убрать пометку
    // совсем» прошёл бы незамеченным.
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack: deletedPack });
    handles.show(infoDeleted());

    expect(root.textContent).toContain('удалён');
    expect(root.textContent).not.toContain('рождение: —');
    handles.unmount();
  });

  it('ещё не родившийся узел не помечается удалённым', () => {
    // На курсоре до начала истории узел не жив, но и не удалён: пометка
    // «удалён» спорила бы со строкой «рождение: —» прямо под ней.
    const root = document.createElement('aside');
    const handles = mountInspector(root, { pack });
    handles.show(infoBeforeBirth('src/a.ts'));

    expect(root.textContent).toContain('рождение: —');
    expect(root.textContent).not.toContain('удалён');
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
