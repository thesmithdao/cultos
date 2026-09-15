# Cult OS + Sibyl Memory

Cult OS gives developer agents persistent repository memory. Each verified delivery becomes context for the next job: recurring failures are remembered, successful patterns are retained, and a fresh process begins with the repository's verified history instead of starting from zero.

Sibyl surrounds the existing Cult OS workflow without changing its authority:

```text
repository history -> work contract -> Virtuals ACP job -> provider delivery
-> Cult OS verification -> repository memory -> settlement
```

Memory informs the next inspection. Cult OS verification remains deterministic, and memory cannot approve work, authorize payment, or settle an ACP job.

## Install

Install Cult OS, then let it prepare and verify the tested Sibyl MCP server:

```bash
cult memory setup
```

Setup requires Python 3.10 or newer on macOS, Linux or WSL2. It installs `sibyl-memory-mcp==0.2.1` in the user-managed `~/.cultos/sibyl` environment and never executes a Sibyl binary from the current repository. If Sibyl is installed elsewhere, set `SIBYL_MEMORY_MCP` to its `sibyl-memory-mcp` executable instead of running setup.

## Use

Check the connection:

```bash
cult memory status
```

Recall repository history while inspecting an issue:

```bash
cult inspect 42 --memory
```

Record the actual verifier outcome after a provider delivers its pull request:

```bash
cult verify 42 --memory
```

Read the resulting history from any later terminal or agent session:

```bash
cult memory history
```

Use `-R owner/name` and `--platform github|gitlawb` when operating outside the repository.

Without `--memory`, `inspect` and `verify` retain their existing behavior and do not start Sibyl. If Sibyl is missing, unavailable or returns malformed data, Cult OS prints a warning and preserves the verifier result and exit status.

## Memory contract

Only Cult OS verification outcomes enter this store: repository identity, pinned commit, check states and concrete failures. The schema rejects arbitrary fields and bounds every stored collection and string.

Sibyl owns its local database. Cult OS sends only the canonical repository, platform, issue reference, pull-request URL, pinned commit, verification result, bounded CI state, bounded failures and timestamp. It does not send credentials, payment data, issue bodies, conversations, provider output or model instructions.
