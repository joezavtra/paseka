import { spawn } from 'node:child_process';

export interface RunningCli {
  url: string;
  stop(): void;
}

/** Поднимает собранный CLI на репозитории и ждёт напечатанный им адрес. */
export async function startCli(repo: string, extraArgs: string[] = []): Promise<RunningCli> {
  const child = spawn(
    'node',
    ['dist/node/cli/main.js', repo, '--port', '0', '--no-open', ...extraArgs],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI не напечатал URL за 30 с:\n${out}`));
    }, 30_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = out.match(/http:\/\/localhost:\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });

  return { url, stop: () => void child.kill('SIGTERM') };
}
