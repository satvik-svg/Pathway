'use client';

/**
 * IMPORTANT: Use NhostClient from `@nhost/react`, not `@nhost/nhost-js`.
 * React client uses `start: false` so only <NhostProvider> starts auth once.
 */
import { NhostClient } from '@nhost/react';
import { normalizeGraphqlUrl } from './graphqlUrl';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';

export { normalizeGraphqlUrl };

/** Always produce a working Constellation GraphQL URL when possible. */
export function resolveGraphqlUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
  if (fromEnv) {
    const n = normalizeGraphqlUrl(fromEnv);
    // Never use a Vercel/HTML page as GraphQL (causes Unexpected token '<')
    if (
      n &&
      !n.includes('vercel.app') &&
      (n.includes('nhost.run') ||
        n.includes('localhost') ||
        n.includes('local.hasura') ||
        n.includes('127.0.0.1'))
    ) {
      return n;
    }
  }

  if (subdomain && subdomain !== 'local' && region) {
    return `https://${subdomain}.graphql.${region}.nhost.run/v1`;
  }

  if (subdomain === 'local' || !subdomain) {
    return 'http://local.hasura.nhost.run:1337/v1/graphql';
  }

  return '';
}

function buildNhost() {
  const authUrl = process.env.NEXT_PUBLIC_NHOST_AUTH_URL;
  const graphqlUrl = resolveGraphqlUrl();
  const storageUrl = process.env.NEXT_PUBLIC_NHOST_STORAGE_URL;
  const functionsUrl = process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL;

  if (authUrl && graphqlUrl) {
    return new NhostClient({
      authUrl: authUrl.replace(/\/$/, ''),
      graphqlUrl,
      storageUrl: storageUrl ? storageUrl.replace(/\/$/, '') : undefined,
      functionsUrl: functionsUrl ? functionsUrl.replace(/\/$/, '') : undefined,
    });
  }

  return new NhostClient({
    subdomain,
    region: region || undefined,
  });
}

export const nhost = buildNhost();

export function getGraphqlUrl() {
  return resolveGraphqlUrl();
}

export function getFunctionsUrl() {
  return (
    process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL ||
    process.env.NEXT_PUBLIC_FUNCTIONS_URL ||
    'http://localhost:4001'
  ).replace(/\/$/, '');
}

export function getWsUrl() {
  const http = getGraphqlUrl();
  return http.replace(/^http/, 'ws');
}
