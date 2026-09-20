# Security

CultOS verifies work that is paid for on-chain. A flaw in verification can cost
a maintainer real money, so please report one privately rather than opening a
public issue.

## Reporting

Use [GitHub's private vulnerability reporting](https://github.com/thesmithdao/cultos/security/advisories/new)
for anything that affects verification, settlement or the local job state.

Useful things to include: the CultOS version, the platform (GitHub or GitLawb),
what the attacker controls, and the shortest sequence of commands that shows the
problem. A hand-written `.cultos/jobs.json` is usually enough to reproduce
delivery-side issues without an ACP job.

Ordinary bugs, crashes with no security consequence, and documentation problems
belong in the public issue tracker.

## What CultOS assumes

Knowing where the boundaries are drawn helps decide whether something is a
vulnerability or intended behaviour.

- **The provider is not trusted.** They choose the deliverable, its URL and, for
  an Aeon review, every word of the review text. CultOS validates that input and
  must never let it alter what the CLI reports.
- **The repository host is trusted.** `gh` and `gl` speak for GitHub and GitLawb;
  CultOS trusts what they return about pull-request state and CI results.
- **The GitLawb node is trusted, over https only.** It decides pull-request state
  and which push certificates exist. `GITLAWB_NODE` must be https, because on a
  plaintext connection a network attacker chooses the verification result.
- **The local machine is trusted.** `.cultos/jobs.json` is written `0600` in a
  `0700` directory; anyone who can already write it can do anything CultOS can.
- **CultOS never holds keys.** Signing is the ACP CLI's job, behind its own
  signer policy.

## Scope

In scope: anything that lets a delivery pass verification when it should not,
that misrepresents a verification result to the maintainer, that corrupts or
loses local job state, or that turns a repository or provider response into
command or argument execution.

Out of scope: weaknesses in the ACP CLI, `gh`, `gl` or the Virtuals protocol
itself. Report those to the projects that own them.
