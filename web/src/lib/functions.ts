'use client';

import { nhost } from './nhost';
import { formatMessage } from './format';

const FUNCTIONS_BASE =
  process.env.NEXT_PUBLIC_FUNCTIONS_URL || 'http://localhost:4001';

/**
 * Call local Action handlers with Hasura-style session payload.
 */
export async function callFunction<T = Record<string, unknown>>(
  path: string,
  input: Record<string, unknown> = {}
): Promise<T> {
  const user = nhost.auth.getUser();
  const token = nhost.auth.getAccessToken();
  const userId = user?.id;

  const res = await fetch(`${FUNCTIONS_BASE}${path}`, {
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
  return json as T;
}
