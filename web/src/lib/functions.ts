'use client';

import { getFunctionsUrl, nhost } from './nhost';
import { formatMessage } from './format';

/**
 * Call Action handlers via same-origin Next.js proxy when in the browser
 * (avoids Nhost Functions CORS). Server-side can hit the functions URL directly.
 */
function resolveFunctionsBase() {
  if (typeof window !== 'undefined') {
    // Browser: always go through Next proxy → no CORS
    return '/api/functions';
  }
  return getFunctionsUrl();
}

export async function callFunction<T = Record<string, unknown>>(
  path: string,
  input: Record<string, unknown> = {}
): Promise<T> {
  const user = nhost.auth.getUser();
  const token = nhost.auth.getAccessToken();
  const userId = user?.id;
  const base = resolveFunctionsBase();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${cleanPath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      input,
      session_variables: userId
        ? {
            'x-hasura-role': 'user',
            'x-hasura-user-id': userId,
          }
        : { 'x-hasura-role': 'public' },
    }),
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok && !('success' in json)) {
    throw new Error(formatMessage(json.message || json));
  }
  if (json.success === false && json.message) {
    throw new Error(formatMessage(json.message));
  }
  return json as T;
}
