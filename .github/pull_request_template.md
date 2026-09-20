## What this changes

<!-- The behaviour that differs after this lands, not a list of edited files. -->

## Why

<!-- The problem being solved. Link the issue if there is one. -->

## Verification

<!-- How you know it works. Paste output where it is more convincing than prose. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

## Risk

<!--
Delete what does not apply.

- Touches verification or settlement (`verify.ts`, `contract.ts`, `state.ts`, `acp.ts`):
  say what a hostile provider could do with this change that they could not before.
- Changes a stored schema: say what happens to a `.cultos/jobs.json` written by an
  earlier release.
- Changes an exported signature: name the callers that move with it.
-->
