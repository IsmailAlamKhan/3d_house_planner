import type { IncomingMessage, ServerResponse } from 'node:http';
import { ProjectFormatError } from '../src/model/migrate';
import type { ProjectStore } from './store';

const MAX_BODY = 25 * 1024 * 1024; // projects can carry thumbnails

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return fail(Object.assign(new Error('Request too large'), { status: 413 }));
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        fail(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', fail);
  });
}

/** `/api/projects…` routes. Returns false if the path is not one of ours. */
export async function handleProjects(
  store: ProjectStore,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  const m = /^\/api\/projects(?:\/([\w-]{1,64})(?:\/(versions)(?:\/(\d+)\/(restore))?)?)?$/.exec(
    path,
  );
  if (!m) return false;
  const [, id, versions, versionId] = m;
  try {
    if (!id) {
      if (req.method === 'GET') return (send(res, 200, store.list()), true);
      if (req.method === 'POST') {
        const r = store.create(await readJson(req));
        return (r === 'exists' ? send(res, 409, { error: 'exists' }) : send(res, 201, r), true);
      }
      return (send(res, 405, { error: 'Method not allowed' }), true);
    }
    if (versions) {
      if (versionId) {
        if (req.method !== 'POST') return (send(res, 405, { error: 'Method not allowed' }), true);
        const r = store.restore(id, Number(versionId));
        return (r ? send(res, 200, r) : send(res, 404, { error: 'No such version' }), true);
      }
      if (req.method !== 'GET') return (send(res, 405, { error: 'Method not allowed' }), true);
      return (
        store.get(id)
          ? send(res, 200, store.versions(id))
          : send(res, 404, { error: 'No such project' }),
        true
      );
    }
    if (req.method === 'GET') {
      const p = store.get(id);
      return (p ? send(res, 200, p) : send(res, 404, { error: 'No such project' }), true);
    }
    if (req.method === 'PUT') {
      const body = (await readJson(req)) as { baseRevision?: number; project?: unknown };
      if (typeof body.baseRevision !== 'number')
        return (send(res, 400, { error: 'baseRevision is required' }), true);
      const r = store.update(id, body.baseRevision, body.project);
      if (r === 'missing') return (send(res, 404, { error: 'No such project' }), true);
      return (
        r.ok
          ? send(res, 200, { revision: r.revision })
          : send(res, 409, { error: 'conflict', ...r.conflict }),
        true
      );
    }
    if (req.method === 'DELETE') {
      return (
        store.delete(id)
          ? send(res, 200, { ok: true })
          : send(res, 404, { error: 'No such project' }),
        true
      );
    }
    return (send(res, 405, { error: 'Method not allowed' }), true);
  } catch (e) {
    if (e instanceof ProjectFormatError) return (send(res, 422, { error: e.message }), true);
    const status = (e as { status?: number }).status ?? 500;
    return (
      send(res, status, { error: status === 500 ? 'Server error' : (e as Error).message }),
      true
    );
  }
}
