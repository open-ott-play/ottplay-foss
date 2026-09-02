# Port conventions

This document records conventions for auditing port parity between the legacy
`4alvit/home-assistant/stbPlayer/stbPlayer.js` and the current
`open-ott-play/ottplay-foss` TypeScript rewrite.

## Sources

| Role | Path |
|---|---|
| Legacy (single file) | `4alvit/home-assistant/stbPlayer/stbPlayer.js` |
| Current (modular) | `ottplay-foss/src/**/*.ts` |

## Audit scope

One function per session. For each function:

1. Grep the legacy file for the function name.
2. Grep the current `src/**/*.ts` for the function name.
3. Compare signatures, side effects, callers.
4. Report: legacy location + signature, current location + signature,
   differences list, status (`matches` | `missing` | `partial`).
5. Update `audit/QUEUE.md`: prepend the function name to the "Done:" line.

## Status semantics

- **matches** — same signature, same side effects, same callers.
- **missing** — absent from one side (legacy or current).
- **partial** — present on both sides but differs in signature, side
  effects, or callers.

## Branch naming

`audit/<function-name>` (kebab-case). One function per branch.

## PR body

PR body reports the four fields above. No local paths that deanonymize the
user. English only.
