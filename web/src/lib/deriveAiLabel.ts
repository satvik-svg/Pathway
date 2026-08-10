/**
 * Guess the "Yes" branch keyword from an Ask AI step config.
 * Prefer labels in the prompt; stub_response is offline AI output only.
 */

export function deriveYesLabelFromLlmConfig(
  config: Record<string, unknown> | null | undefined
): string | null {
  if (!config) return null;

  const prompt = String(config.prompt ?? '');
  if (prompt) {
    const bullets = [
      ...prompt.matchAll(/^\s*[-*]\s*([A-Za-z][A-Za-z0-9_]{1,24})\b/gm),
    ].map((m) => m[1]);
    if (bullets.length >= 1) return bullets[0];

    const onlyOr = prompt.match(
      /(?:only|exactly)\s+([A-Za-z][A-Za-z0-9_]{1,24})\s+or\s+([A-Za-z][A-Za-z0-9_]{1,24})/i
    );
    if (onlyOr) return onlyOr[1];

    const plainOr = prompt.match(
      /\b([A-Z][A-Z0-9_]{1,24})\s+or\s+([A-Z][A-Z0-9_]{1,24})\b/
    );
    if (plainOr) return plainOr[1];
  }

  const stub = String(config.stub_response ?? '').trim();
  if (stub) {
    return stub.split(/\s+/)[0].replace(/[^a-zA-Z0-9_-]/g, '') || null;
  }

  return null;
}

/** All candidate labels (yes + alternatives) for display. */
export function deriveLabelsFromLlmConfig(
  config: Record<string, unknown> | null | undefined
): string[] {
  if (!config) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string | null | undefined) => {
    if (!s) return;
    const t = s.trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  const prompt = String(config.prompt ?? '');
  for (const m of prompt.matchAll(
    /^\s*[-*]\s*([A-Za-z][A-Za-z0-9_]{1,24})\b/gm
  )) {
    add(m[1]);
  }
  const onlyOr = prompt.match(
    /(?:only|exactly)\s+([A-Za-z][A-Za-z0-9_]{1,24})\s+or\s+([A-Za-z][A-Za-z0-9_]{1,24})/i
  );
  if (onlyOr) {
    add(onlyOr[1]);
    add(onlyOr[2]);
  }
  add(deriveYesLabelFromLlmConfig(config));

  return out;
}
