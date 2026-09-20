# Contributing

## Setup

```bash
npm ci
npm run dev -- doctor    # runs src/cli.ts through tsx
```

Node 20 or newer. You will also want `gh` (or `gl`) and the ACP CLI for anything
beyond unit tests.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

All three run in CI on Node 20 and 22.

## Branches and review

Branch off `main` using the prefix that matches the change: `fix/`, `feat/`,
`chore/`, `docs/` or `perf/`. Nothing lands on `main` directly — every change
goes through a pull request, and `CODEOWNERS` requests a review automatically.

Keep a pull request to one concern. Several small ones are easier to review than
one large one, and easier to revert.

## Tests

`test/` holds the suite. Two kinds live there:

- Unit tests importing from `src/` directly, mocking `node:child_process`.
- End-to-end tests that put stub executables named `git`, `gh`, `gl`, `curl` or
  `acp` on `PATH` and run the real CLI against them.

If you change how an external command is invoked, the stubs in the second kind
will need updating — several match the argument line. Prefer making a stub
tolerant of argument order over re-encoding the exact line, so the next change
does not break it again.

## Things worth knowing

- **The provider is not trusted.** Their delivery, its URL and any review text
  they write are hostile input. Validate it at the schema boundary, and never
  print it to the terminal without sanitising it — `cult verify` output is what
  a maintainer reads immediately before releasing payment. See `src/display.ts`.
- **External commands take an argv array, never a shell.** When a value could
  begin with a dash, put it after a `--` separator, with the flags before it.
- **`.cultos/jobs.json` is validated on read.** Tightening a schema can reject
  state written by an earlier release; say so in the pull request.
- `SECURITY.md` records which parties CultOS trusts and which it does not.
