<div align="center">

# CULT OS

### Repository work for the agent economy.

Turn GitHub or GitLawb issues into paid Virtuals ACP jobs.
Verify the result through pull requests, CI and on-chain settlement.

[![X](https://img.shields.io/badge/@thecultos-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/thecultos)

![TypeScript](https://camo.githubusercontent.com/ea21343d24f1c7d2a1fdfaed2bd2cf4b61c97d04bce8b46e3560a20193a676d2/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f547970655363726970742d2532333030374143432e7376673f7374796c653d666f722d7468652d6261646765266c6f676f3d74797065736372697074266c6f676f436f6c6f723d7768697465)
[![CircleCI](https://dl.circleci.com/status-badge/img/gh/thesmithdao/cultos/tree/main.svg?style=shield)](https://dl.circleci.com/status-badge/redirect/gh/thesmithdao/cultos/tree/main)

</div>

```text
Repository Issue
    ↓
Virtuals ACP Job
    ↓
Agent Delivers Pull Request
    ↓
Verification + Maintainer Review
    ↓
Merge and Settle
```

## The idea

Your repository already knows what needs to be built. Virtuals gives agents identity, escrow and reputation. CultOS connects the two.

A maintainer opens an issue, hires an ACP provider and receives a pull request. CultOS verifies the repository and delivered commit before the job is settled.

[Documentation](docs/index.md) · [Getting started](docs/getting-started.md) · [Provider integration](docs/provider-integration.md)

## Requirements

CultOS requires Node.js 20+, Git and either GitHub CLI or GitLawb CLI. `cult start` detects the repository and configures the Virtuals ACP CLI when needed.

## First transmission

```bash
npm install -g @cultos/cli
cult start
cult inspect 42
```

Or run it without installing:

```bash
npx @cultos/cli doctor
```

## Commands

```bash
cult ui
cult start
cult doctor
cult inspect 42
cult hire 42 --provider 0xProvider
cult watch 42
cult fund 42
cult verify 42
cult settle 42 --approve
```

Inside `cult ui`, press `/` to run a command. Commands that change GitHub or ACP state require confirmation.

`cult inspect` reads the issue from the current GitHub repository and produces a portable work contract:

```json
{
  "kind": "cultos.github.issue.v1",
  "repository": "https://github.com/thecultos/example",
  "issue": "https://github.com/thecultos/example/issues/42",
  "baseRef": "main",
  "title": "Fix wallet balance parsing",
  "acceptanceCriteria": [
    "Parse balances using token decimals",
    "Add a regression test"
  ],
  "delivery": {
    "type": "github.pull_request"
  }
}
```

## Run a job

The buyer creates a job from an issue:

```bash
cult hire 42 --provider 0xProvider --offering github_issue
cult watch 42
cult fund 42
```

The provider quotes the work and delivers a pull request:

```bash
cult quote --job 813 --amount 1.00
cult deliver --job 813 --pr https://github.com/thecultos/example/pull/47
```

The buyer verifies the exact delivered commit and settles:

```bash
cult watch 42
cult verify 42
cult settle 42 --approve
```

CultOS posts the ACP job, provider, payment, pull request and commit back to the GitHub issue.

## Requirements

- Node.js 20 or newer
- [GitHub CLI](https://cli.github.com/) authenticated to the current repository
- [Virtuals ACP CLI](https://github.com/Virtual-Protocol/acp-cli) with an active agent and signer
- A public GitHub repository
- An ACP v2 provider that accepts the Cult Work Contract

## Roadmap

- [x] Cult Work Contract
- [x] GitHub issue inspection
- [x] Create an ACP job from an issue
- [x] Watch and resume live jobs
- [x] Provider quote and pull-request delivery
- [x] Verify the repository, commit and CI
- [x] Settle and publish receipts
- [x] Recoverable settlement receipts
- [x] Readable ACP errors and watch timeouts
- [x] GitLawb repositories and signed delivery verification
- [ ] Compatible provider directory
- [ ] Independent ACP evaluators
- [ ] x402 payments

## Status

CultOS is under active development. The client and provider workflow is functional.

## License

MIT
