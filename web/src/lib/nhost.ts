'use client';

import { NhostClient } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';

/**
 * Nhost Cloud GraphQL is at `/v1`, not `/v1/graphql` (classic Hasura).
 * Accept either form from env and normalize for cloud hosts.
 */
export function normalizeGraphqlUrl(url: string) {
  const trimmed = url.replace(/\/$/, '');
  if (
    trimmed.includes('.nhost.run') &&
    trimmed.endsWith('/v1/graphql')
  ) {
    return trimmed.replace(/\/v1\/graphql$/, '/v1');
  }
  return trimmed;
}

function buildNhost() {
  const authUrl = process.env.NEXT_PUBLIC_NHOST_AUTH_URL;
  const rawGraphqlUrl = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
  const storageUrl = process.env.NEXT_PUBLIC_NHOST_STORAGE_URL;
  const functionsUrl = process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL;

  // Explicit URL mode (cloud env vars / local docker)
  if (authUrl && rawGraphqlUrl) {
    const graphqlUrl = normalizeGraphqlUrl(rawGraphqlUrl);
    return new NhostClient({
      authUrl,
      graphqlUrl,
      storageUrl:
        storageUrl ||
        graphqlUrl
          .replace(/\/v1\/graphql$/, '/v1/storage')
          .replace(/\/v1$/, '/v1/storage'),
      functionsUrl:
        functionsUrl ||
        graphqlUrl
          .replace(/\/v1\/graphql$/, '/v1/functions')
          .replace(/\/v1$/, '/v1/functions'),
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
  return normalizeGraphqlUrl(nhost.graphql.getUrl());
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
