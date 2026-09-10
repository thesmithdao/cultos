# Cult OS + Sibyl Memory

Cult OS gives developer agents persistent repository memory. Each verified delivery becomes context for the next job: recurring failures are remembered, successful patterns are retained, and a fresh process begins with the repository's verified history instead of starting from zero.

Sibyl surrounds the existing Cult OS workflow without changing its authority:

```text
repository history -> work contract -> Virtuals ACP job -> provider delivery
-> Cult OS verification -> repository memory -> settlement
```

Memory informs the next inspection. Cult OS verification remains deterministic, and memory cannot approve work, authorize payment, or settle an ACP job.

## Install

Clone Cult OS and install its dependencies:

```bash
git clone https://github.com/thesmithdao/cultos.git
cd cultos
npm install
```

Create an isolated Python environment and install the tested Sibyl MCP server:

```bash
python3 -m venv .cultos/sibyl
.cultos/sibyl/bin/pip install sibyl-memory-mcp==0.2.1
```

If Sibyl is installed elsewhere, set `SIBYL_MEMORY_MCP` to the `sibyl-memory-mcp` executable.

## Run

Check the connection:

```bash
npm run sibyl:memory
```

Record a verified failed delivery:

```bash
npm run sibyl:memory:record
```

Close the terminal. From a fresh terminal or agent session, recall the failure and verify the corrected delivery:

```bash
npm run sibyl:memory:recall
```

Inspect the resulting repository history:

```bash
npm run sibyl:memory:history
```

Reset the isolated database before another run:

```bash
npm run sibyl:memory:reset
```

The repeatable flow uses pinned repository responses while executing the real Cult OS delivery verifier and the real Sibyl MCP persistence layer. It makes no network request, spends no funds, and never reads `.env` or existing Cult OS job state.

## Memory contract

Only Cult OS verification outcomes enter this store: repository identity, pinned commit, check states and concrete failures. The schema rejects arbitrary fields and bounds every stored collection and string.

The database lives at `.cultos/sibyl-memory/memory.db`. `.cultos/` is ignored by Git.
