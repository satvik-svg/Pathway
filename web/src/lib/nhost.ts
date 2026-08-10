'use client';

import { NhostClient } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';

/**
 * Nhost GraphQL (Hasura / Constellation) is at `/v1/graphql`.
 * System env sometimes shows `/v1` only — that 404s from the browser.
 */
export function normalizeGraphqlUrl(url: string) {
  let trimmed = url.replace(/\/$/, '');
  if (!trimmed) return trimmed;

  // Already correct
  if (trimmed.endsWith('/v1/graphql')) return trimmed;

  // ...graphql...nhost.run/v1  →  .../v1/graphql
  if (
    trimmed.includes('.graphql.') &&
    trimmed.includes('.nhost.run') &&
    trimmed.endsWith('/v1')
  ) {
    return `${trimmed}/graphql`;
  }

  // Local Hasura classic
  if (trimmed.includes('local.hasura') && trimmed.endsWith('/v1')) {
    return `${trimmed}/graphql`;
  }

  return trimmed;
}

function buildNhost() {
  const authUrl = process.env.NEXT_PUBLIC_NHOST_AUTH_URL;
  const rawGraphqlUrl = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
  const storageUrl = process.env.NEXT_PUBLIC_NHOST_STORAGE_URL;
  const functionsUrl = process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL;

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
  // ws://host/v1/graphql → same path
  return http.replace(/^http/, 'ws');
}
