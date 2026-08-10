'use client';

import { NhostClient } from '@nhost/nhost-js';
import { normalizeGraphqlUrl } from './graphqlUrl';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';

export { normalizeGraphqlUrl };

function buildNhost() {
  const authUrl = process.env.NEXT_PUBLIC_NHOST_AUTH_URL;
  const rawGraphqlUrl = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
  const storageUrl = process.env.NEXT_PUBLIC_NHOST_STORAGE_URL;
  const functionsUrl = process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL;

  if (authUrl && rawGraphqlUrl) {
    const graphqlUrl = normalizeGraphqlUrl(rawGraphqlUrl);
    return new NhostClient({
      authUrl: authUrl.replace(/\/$/, ''),
      graphqlUrl,
      storageUrl: (storageUrl || '').replace(/\/$/, '') || undefined,
      functionsUrl: (functionsUrl || '').replace(/\/$/, '') || undefined,
    } as ConstructorParameters<typeof NhostClient>[0]);
  }

  return new NhostClient({
    subdomain,
    region: region || undefined,
  });
}

export const nhost = buildNhost();

export function getGraphqlUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
  if (fromEnv) return normalizeGraphqlUrl(fromEnv);
  try {
    return normalizeGraphqlUrl(nhost.graphql.getUrl());
  } catch {
    return '';
  }
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
