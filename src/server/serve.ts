import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';

export interface ServeOptions {
  webRoot: string;
  /** 0 — попросить свободный порт у системы. */
  port: number;
  getPack: () => Promise<Uint8Array>;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Сколько соседних портов пробовать, если запрошенный занят. */
const PORT_ATTEMPTS = 20;

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  let packGzip: Buffer | null = null;

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === '/api/pack') {
      packGzip ??= gzipSync(await options.getPack());
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-encoding': 'gzip',
        'cache-control': 'no-store',
        'content-length': String(packGzip.length),
      });
      response.end(packGzip);
      return;
    }

    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const target = resolve(join(options.webRoot, relative === '/' ? 'index.html' : relative));
    if (target !== resolve(options.webRoot) && !target.startsWith(resolve(options.webRoot) + sep)) {
      response.writeHead(404).end('not found');
      return;
    }

    try {
      const body = await readFile(target);
      const dot = target.lastIndexOf('.');
      response.writeHead(200, {
        'content-type': MIME[target.slice(dot)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  }

  const port = await listen(server, options.port);
  return {
    port,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
      }),
  };
}

function listen(server: ReturnType<typeof createServer>, wanted: number): Promise<number> {
  return new Promise((done, fail) => {
    let attempt = 0;
    const tryPort = (port: number) => {
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && attempt < PORT_ATTEMPTS && port !== 0) {
          attempt++;
          tryPort(port + 1);
          return;
        }
        fail(error);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        done((server.address() as AddressInfo).port);
      });
    };
    tryPort(wanted);
  });
}
