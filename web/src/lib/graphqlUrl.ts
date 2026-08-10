/**
 * Canonical Nhost / Hasura GraphQL HTTP endpoint.
 *
 * - Constellation host `*.graphql.*.nhost.run` → `/v1` only
 * - Classic Hasura `*.hasura.*.nhost.run` / local → `/v1/graphql` once
 * Never allow `/v1/graphqlgraphql` or double `/graphql`.
 */
export function normalizeGraphqlUrl(url: string): string {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (!u) return u;

  // Collapse known bad concatenations from older clients / env mistakes
  u = u
    .replace(/\/v1\/graphqlgraphql$/i, '/v1/graphql')
    .replace(/\/graphql\/graphql$/i, '/graphql')
    .replace(/\/v1\/graphql\/graphql$/i, '/v1/graphql');

  const isConstellation =
    u.includes('.graphql.') && u.includes('.nhost.run');
  const isHasuraHost =
    u.includes('.hasura.') || u.includes('local.hasura');

  if (isConstellation) {
    // Strip any accidental /graphql suffix
    if (u.endsWith('/v1/graphql')) return u.replace(/\/v1\/graphql$/, '/v1');
    if (u.endsWith('/graphql')) return u.replace(/\/graphql$/, '');
    if (!u.endsWith('/v1')) {
      // bare host → append /v1
      if (!/\/v\d+/.test(u)) return `${u}/v1`;
    }
    return u;
  }

  if (isHasuraHost) {
    if (u.endsWith('/v1/graphql')) return u;
    if (u.endsWith('/v1')) return `${u}/graphql`;
    return u;
  }

  // Unknown host: leave as-is after collapse
  return u;
}
