import type { Pack } from '../../src/model/types.js';
import { avatarColor } from '../render/avatar.js';
import { representedClause } from '../render/labels.js';
import type { NodeInfo } from '../state/node-info.js';
import { drawHistogram } from './histogram.js';
import { commitDateLabel, formatCommitLabel } from './transport.js';
import { ownsTextInput } from './keys.js';

export interface InspectorOptions {
  pack: Pack;
  onClose?(): void;
}

export interface InspectorHandles {
  /** Показывает карточку узла, обновляя содержимое на месте. */
  show(info: NodeInfo): void;
  hide(): void;
  unmount(): void;
}

/** Дата коммита или тире, если такого коммита нет (birthCommit/lastCommit == -1). */
function commitDateOrDash(pack: Pack, commit: number): string {
  return commit < 0 ? '—' : commitDateLabel(pack, commit);
}

function row(...children: (Node | string)[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'row';
  div.append(...children);
  return div;
}

export function mountInspector(root: HTMLElement, options: InspectorOptions): InspectorHandles {
  const { pack } = options;
  root.hidden = true;
  root.replaceChildren();

  function hide(): void {
    root.hidden = true;
  }

  // Скелет карточки строится один раз при монтировании, а не на каждый show():
  // на воспроизведении show() зовётся до нескольких раз в секунду (см.
  // INSPECTOR_REBUILD_INTERVAL_MS в web/main.ts), и полная пересборка через
  // replaceChildren на каждый вызов рвала бы клавиатурный фокус на кнопке
  // закрытия и выделение текста коммита для копирования. show() ниже трогает
  // только содержимое: текстовые узлы, список авторов, список коммитов и
  // отрисовку канвы — сами элементы-контейнеры (и особенно кнопка закрытия)
  // переживают любое число повторных show().
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close';
  closeButton.textContent = '✕';
  closeButton.setAttribute('aria-label', 'Закрыть карточку узла');
  closeButton.addEventListener('click', () => {
    hide();
    options.onClose?.();
  });

  const heading = document.createElement('h2');
  const path = document.createElement('div');
  path.className = 'path';
  const summary = document.createElement('div');
  summary.className = 'row';
  const born = document.createElement('div');
  born.className = 'row';
  const last = document.createElement('div');
  last.className = 'row';
  const contributorsBox = document.createElement('div');
  const sparkline = document.createElement('canvas');
  const commitsBox = document.createElement('div');

  root.append(closeButton, heading, path, summary, born, last, contributorsBox, sparkline, commitsBox);

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    // Escape закрывает открытый список или отменяет ввод в текстовом поле —
    // у поля своё поведение на эту клавишу, и глобальный обработчик не должен
    // его отбирать (тот же вопрос, что и с пробелом в web/ui/transport.ts,
    // решён тем же общим помощником).
    if (ownsTextInput(event.target)) return;
    if (root.hidden) return;
    hide();
    options.onClose?.();
  };
  document.addEventListener('keydown', handleKeydown);

  function show(info: NodeInfo): void {
    root.hidden = false;

    heading.textContent = info.name;
    // Вторая строка — полный путь, и у всего, что лежит прямо в корне
    // репозитория (а также у самого корня), он дословно совпадает с
    // заголовком: «tests / tests», «package-lock.json / package-lock.json».
    // Строка, повторяющая соседнюю, не добавляет ничего — прячем её целиком,
    // а не оставляем пустой: иначе от неё остался бы вертикальный отступ.
    const fullPath = info.fullPath === '' ? pack.meta.repoName : info.fullPath;
    const pathAddsNothing = fullPath === info.name;
    path.textContent = pathAddsNothing ? '' : fullPath;
    path.hidden = pathAddsNothing;

    const summaryParts: string[] = [`строк: ${info.lines}`];
    if (info.isDir) {
      summaryParts.push(`файлов: ${info.files}`);
      // Свёрнутая папка может прятать скрытое поддерево: тогда «файлов» здесь
      // (живых в истории) больше, чем реально представлено одним кружком на
      // сцене — молчать об этом нельзя, иначе рядом на экране два разных
      // числа без объяснения (см. представленное в подписи узла, web/main.ts).
      // В обычном случае (внутри ничего не скрыто, represented === files)
      // клауза не нужна — карточка выглядит как раньше.
      if (info.represented !== undefined && info.represented < info.files) {
        summaryParts.push(representedClause(info.represented));
      }
    }
    // «Удалён» — про узел, который был и исчез. Неживой узел бывает и другим:
    // на курсоре раньше его рождения (birthCommit === -1) он ещё не появился,
    // и пометка об удалении спорила бы со строкой «рождение: —» прямо под ней.
    if (!info.alive && info.birthCommit >= 0) summaryParts.push('удалён');
    summary.textContent = summaryParts.join(' · ');

    born.textContent = `рождение: ${commitDateOrDash(pack, info.birthCommit)}`;
    last.textContent = `последнее изменение: ${commitDateOrDash(pack, info.lastCommit)}`;

    const contributorRows = info.contributors.map((contributor) => {
      const author = pack.authors[contributor.author];
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = author ? avatarColor(author.email) : '#8b949e';
      const name = document.createElement('span');
      name.textContent = author ? author.name || author.email : '?';
      const count = document.createElement('span');
      count.textContent = `${contributor.commits}`;
      return row(dot, name, count);
    });
    contributorsBox.replaceChildren(...contributorRows);

    const commitLines = info.recentCommits.map((commit) => {
      const line = document.createElement('div');
      line.className = 'commit';
      line.textContent = formatCommitLabel(pack, commit);
      return line;
    });
    commitsBox.replaceChildren(...commitLines);

    // Гистограмма рисуется после того, как канва оказалась в документе: до
    // этого у неё нет размера, а drawHistogram читает clientWidth/clientHeight.
    // Канва — тот же самый элемент между вызовами show(), поэтому достаточно
    // просто перерисовать её содержимое.
    drawHistogram(sparkline, info.sparkline);
  }

  return {
    show,
    hide,
    unmount(): void {
      document.removeEventListener('keydown', handleKeydown);
      root.replaceChildren();
      root.hidden = true;
    },
  };
}
