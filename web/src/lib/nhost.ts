'use client';

import { NhostClient } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || '';

function buildNhost() {
  const authUrl = process.env.NEXT_PUBLIC_NHOST_AUTH_URL;
  const graphqlUrl = process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;
  const storageUrl = process.env.NEXT_PUBLIC_NHOST_STORAGE_URL;
  const functionsUrl = process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL;

  // Explicit URL mode (local docker / custom)
  if (authUrl && graphqlUrl) {
    return new NhostClient({
      authUrl,
      graphqlUrl,
      storageUrl: storageUrl || graphqlUrl.replace('/v1/graphql', '/v1/storage'),
      functionsUrl:
        functionsUrl || graphqlUrl.replace('/v1/graphql', '/v1/functions'),
    } as ConstructorParameters<typeof NhostClient>[0]);
  }

  return new NhostClient({
    subdomain,
    region: region || undefined,
  });
}

export const nhost = buildNhost();

export function getGraphqlUrl() {
  return (
    process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL ||
    nhost.graphql.getUrl()
  );
}

export function getWsUrl() {
  const http = getGraphqlUrl();
  return http.replace(/^http/, 'ws');
}
