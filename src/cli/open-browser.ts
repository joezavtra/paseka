import { spawn } from 'node:child_process';

/**
 * Открывает URL в браузере по умолчанию. Молча ничего не делает при неудаче:
 * пользователь всё равно видит адрес в терминале, падать из-за этого нельзя.
 */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // пусто: адрес уже напечатан
  }
}
