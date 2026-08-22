---
layout: default
title: Job lifecycle
---

[Docs](index.md) · [Getting started](getting-started.md) · [Provider integration](provider-integration.md) · [Schemas](work-contract.md) · [Troubleshooting](troubleshooting.md)

# Job lifecycle

CultOS connects a GitHub issue to an ACP job and keeps the delivery verifiable.

| Step | Actor | Command | Result |
|---:|---|---|---|
| 1 | Buyer | `cult hire <issue> --provider <address>` | ACP job created |
| 2 | Provider | `cult quote --job <id> --amount <usdc>` | Budget proposed |
| 3 | Buyer | `cult watch <issue>` | Quote received |
| 4 | Buyer | `cult fund <issue>` | Escrow funded |
| 5 | Provider | `cult deliver --job <id> --pr <url>` | PR and commit submitted |
| 6 | Buyer | `cult watch <issue>` | Delivery received |
| 7 | Buyer | `cult verify <issue>` | Repository, commit and CI checked |
| 8 | Maintainer | Merge pull request | Delivery accepted |
| 9 | Buyer | `cult settle <issue> --approve` | ACP completed and receipt posted |

Use `cult message <issue> <content>` for job-room communication.

Run buyer commands from the repository that contains `.cultos/jobs.json`. Provider commands use the provider's active ACP identity.
