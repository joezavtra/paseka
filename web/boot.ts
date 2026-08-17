import { decodePack, PackError } from '../src/pack/decode.js';
import type { Pack } from '../src/model/types.js';

/** Русское склонение для счётных подписей: 1 коммит, 2 коммита, 5 коммитов. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`;
  if (mod10 === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function describePack(pack: Pack): string {
  let files = 0;
  for (let i = 0; i < pack.pathIsDir.length; i++) if (pack.pathIsDir[i] === 0) files++;
  return (
    `${pack.meta.repoName} · ${plural(pack.meta.commitCount, 'коммит', 'коммита', 'коммитов')} · ` +
    `${plural(files, 'файл', 'файла', 'файлов')} · ` +
    `${plural(pack.authors.length, 'автор', 'автора', 'авторов')}`
  );
}

export async function loadPack(url = './api/pack'): Promise<Pack> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new PackError(`Сервер ответил ${response.status} на запрос данных.`);
  }
  return decodePack(new Uint8Array(await response.arrayBuffer()));
}

export function showFatal(message: string): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.hidden = false;
  status.className = 'fatal';
  status.textContent = message;
}
