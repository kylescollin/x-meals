/* Pulling the JSON out of what a model actually said.
 *
 * The prompts ask for "valid JSON only", and almost always that's what comes
 * back. But "almost always" crashed a CI run: one reply began "I'll work
 * through the meals..." before the array, and a bare JSON.parse took the whole
 * sync down with it. This module accepts the reply as it is — fenced, prefaced,
 * postfaced — and finds the JSON value inside it, or throws if there isn't one.
 */
'use strict';

/**
 * Extract the first complete JSON value from model text that may be wrapped
 * in code fences and/or prose on either side. Throws if nothing parses.
 */
function extractJson(text) {
  const s = String(text == null ? '' : text);

  // The clean case — the whole reply is the JSON.
  try { return JSON.parse(s.trim()); } catch (_) {}

  // A fenced block anywhere in the reply.
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(s);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_) {}
  }

  // Prose around the JSON. Try every opening bracket, not just the first —
  // the prose itself may contain a stray { before the real payload.
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '[' && s[i] !== '{') continue;
    const end = matchBracket(s, i);
    if (end !== -1) {
      try { return JSON.parse(s.slice(i, end + 1)); } catch (_) {}
    }
  }

  throw new Error('no JSON value found in model output');
}

// Where the bracket opened at `start` closes, respecting strings — a "]" inside
// an ingredient name must not close the array. -1 if it never closes.
function matchBracket(s, start) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

module.exports = { extractJson };
