#!/usr/bin/env node
/**
 * Local Action/Event handler server for development.
 * Maps paths to function handlers (mimics NHOST_FUNCTIONS_URL).
 *
 *   cd functions && npm i && node local-server.mjs
 *   # listens on :4001
 *
 * Point Hasura Actions / env:
 *   NHOST_FUNCTIONS_URL=http://host.docker.internal:4001
 *
 * Optional: create functions/.env with GROQ_API_KEY, NHOST_GRAPHQL_URL, etc.
 */

import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load functions/.env if present (never commit secrets)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
} catch {
  /* ignore */
}

const PORT = Number(process.env.FUNCTIONS_PORT || 4001);

const routes = {
  '/trigger-workflow-run': './trigger-workflow-run/index.js',
  '/approve-step': './approve-step/index.js',
  '/webhook-trigger': './webhook-trigger/index.js',
  '/scheduled-runner': './scheduled-runner/index.js',
  '/notify-handler': './notify-handler/index.js',
  '/db-event-trigger': './db-event-trigger/index.js',
  '/create-organization': './create-organization/index.js',
  '/manage-org-member': './manage-org-member/index.js',
  '/list-org-members': './list-org-members/index.js',
  '/run-scheduled-workflow': './run-scheduled-workflow/index.js',
};

async function loadHandler(rel) {
  const mod = await import(pathToFileURL(path.join(__dirname, rel)).href);
  return mod.default;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const route = routes[url.pathname];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `No handler for ${url.pathname}` }));
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');

  const headers = new Map(Object.entries(req.headers));
  const requestLike = {
    method: req.method,
    headers: {
      get: (k) => headers.get(k.toLowerCase()),
      ...Object.fromEntries(headers),
    },
    json: async () => (raw ? JSON.parse(raw) : {}),
  };

  try {
    const handler = await loadHandler(route);
    const response = await handler(requestLike);
    const body = await response.text();
    res.writeHead(response.status || 200, {
      'Content-Type': response.headers?.get?.('Content-Type') || 'application/json',
    });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: String(err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Functions local server on http://localhost:${PORT}`);
  console.log('Routes:', Object.keys(routes).join(', '));
});
