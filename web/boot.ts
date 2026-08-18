import { decodePack, PackError } from '../src/pack/decode.js';
import type { Pack } from '../src/model/types.js';
import { plural } from './plural.js';

export function describePack(pack: Pack): string {
  let files = 0;
  for (let i = 0; i < pack.pathIsDir.length; i++) if (pack.pathIsDir[i] === 0) files++;
  return (
    `${pack.meta.repoName} · ${plural(pack.meta.commitCount, 'коммит', 'коммита', 'коммитов')} · ` +
    `${plural(files, 'файл', 'файла', 'файлов')}`
  );
}

export async function loadPack(url = './api/pack'): Promise<Pack> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PackError(
      `Потеряна связь с локальным сервером — он, вероятно, уже остановлен. ` +
        `Перезапустите команду и откройте страницу заново. (${detail})`,
    );
  }
  if (!response.ok) {
    throw new PackError(`Сервер ответил ${response.status} на запрос данных.`);
  }
  return decodePack(new Uint8Array(await response.arrayBuffer()));
}

/**
 * Показывает фатальную ошибку в собственном элементе, а не в строке статуса:
 * строка статуса переписывается каждым кадром воспроизведения (Task 8), и
 * общий элемент стёр бы сообщение об аварии на следующем же кадре, оставив
 * только красный цвет без текста.
 */
export function showFatal(message: string): void {
  const fatal = document.getElementById('fatal');
  if (!fatal) return;
  fatal.hidden = false;
  fatal.textContent = message;
}
