# Job lifecycle

CultOS connects a GitHub issue to an ACP job and keeps the delivery verifiable.

1. Buyer: `cult hire <issue> --provider <address>` creates the ACP job.
2. Buyer: `cult watch <issue>` receives provider updates.
3. Provider: `cult quote --job <id> --amount <usdc>` sets the price.
4. Buyer: `cult fund <issue>` funds the accepted quote.
5. Either party: `cult message <issue> <content>` sends job-room context.
6. Provider: `cult deliver --job <id> --pr <url>` submits a pull request and commit.
7. Buyer: `cult watch <issue>` receives the delivery, then `cult verify <issue>` checks the commit and CI.
8. Buyer: `cult settle <issue> --approve` completes the job and posts its receipt.

Run buyer commands from the repository that contains `.cultos/jobs.json`. Provider commands use the provider's active ACP identity.
