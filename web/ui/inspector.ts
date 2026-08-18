import type { Pack } from '../../src/model/types.js';
import { avatarColor } from '../render/avatar.js';
import type { NodeInfo } from '../state/node-info.js';
import { drawHistogram } from './histogram.js';
import { formatCommitLabel } from './transport.js';

export interface InspectorOptions {
  pack: Pack;
  onClose?(): void;
}

export interface InspectorHandles {
  /** Показывает карточку узла, полностью заменяя прежнее содержимое. */
  show(info: NodeInfo): void;
  hide(): void;
  unmount(): void;
}

/** Дата коммита в формате `YYYY-MM-DD`, тот же формат, что и в подписи транспорта. */
function commitDate(pack: Pack, commit: number): string {
  if (commit < 0) return '—';
  return new Date(pack.commitTs[commit]! * 1000).toISOString().slice(0, 10);
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

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (root.hidden) return;
    hide();
    options.onClose?.();
  };
  document.addEventListener('keydown', handleKeydown);

  function hide(): void {
    root.hidden = true;
  }

  function show(info: NodeInfo): void {
    root.hidden = false;

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
    heading.textContent = info.name;

    const path = document.createElement('div');
    path.className = 'path';
    path.textContent = info.fullPath === '' ? pack.meta.repoName : info.fullPath;

    const summaryParts: string[] = [`строк: ${info.lines}`];
    if (info.isDir) summaryParts.push(`файлов: ${info.files}`);
    if (!info.alive) summaryParts.push('удалён');
    const summary = row(summaryParts.join(' · '));

    const born = row(`рождение: ${commitDate(pack, info.birthCommit)}`);
    const last = row(`последнее изменение: ${commitDate(pack, info.lastCommit)}`);

    const contributorsBox = document.createElement('div');
    for (const contributor of info.contributors) {
      const author = pack.authors[contributor.author];
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = author ? avatarColor(author.email) : '#8b949e';
      const name = document.createElement('span');
      name.textContent = author ? author.name || author.email : '?';
      const count = document.createElement('span');
      count.textContent = `${contributor.commits}`;
      contributorsBox.append(row(dot, name, count));
    }

    const sparkline = document.createElement('canvas');

    const commitsBox = document.createElement('div');
    for (const commit of info.recentCommits) {
      const line = document.createElement('div');
      line.className = 'commit';
      line.textContent = formatCommitLabel(pack, commit);
      commitsBox.append(line);
    }

    root.replaceChildren(
      closeButton,
      heading,
      path,
      summary,
      born,
      last,
      contributorsBox,
      sparkline,
      commitsBox,
    );

    // Гистограмма рисуется после вставки в документ: до этого у канвы нет
    // размера, а drawHistogram читает clientWidth/clientHeight.
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
