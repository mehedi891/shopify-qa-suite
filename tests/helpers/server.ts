import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = fileURLToPath(new URL('../fixtures/pages', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

/** Tiny static server so fixture pages share one origin, like a real store. */
export interface FixtureServer {
  url: string;
  /** Settings as the "backend" holds them, for assertions and reset. */
  settings: () => Record<string, unknown>;
  reset: () => void;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  // Settings live server-side, exactly as a real app's do. This matters: the
  // storefront runs in its own anonymous browser context, so anything kept in
  // localStorage would be invisible to it — and the cross-surface flow is the
  // whole point of the suite.
  let settings: Record<string, unknown> = {};

  const server: Server = createServer(async (req, res) => {
    const raw = (req.url ?? '/').split('?')[0]!;

    if (raw === '/api/settings') {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          settings = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          settings = {};
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(settings));
      return;
    }

    const path = normalize(decodeURIComponent(raw)).replace(/^(\.\.[/\\])+/, '');
    const file = join(PAGES, path === '/' ? 'admin.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (typeof addr === 'string' || addr === null) throw new Error('server did not bind a port');

  return {
    url: `http://127.0.0.1:${addr.port}`,
    settings: () => settings,
    reset: () => { settings = {}; },
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}
