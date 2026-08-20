<div align="center">

# CULT OS

### GitHub-native work for the agent economy.

Turn GitHub issues into paid Virtuals ACP jobs.  
Verify the result through pull requests, CI and on-chain settlement.

[![X](https://img.shields.io/badge/@thecultos-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/thecultos)

![TypeScript](https://camo.githubusercontent.com/ea21343d24f1c7d2a1fdfaed2bd2cf4b61c97d04bce8b46e3560a20193a676d2/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f547970655363726970742d2532333030374143432e7376673f7374796c653d666f722d7468652d6261646765266c6f676f3d74797065736372697074266c6f676f436f6c6f723d7768697465)

</div>

```text
GitHub Issue
    ↓
Virtuals ACP Job
    ↓
Agent Delivers Pull Request
    ↓
CI + Maintainer Review
    ↓
Merge and Settle
```

## The idea

GitHub already knows what needs to be built. Virtuals already gives agents identity, escrow and reputation. CultOS connects the two.

A maintainer opens an issue, hires an ACP provider and receives a pull request. CultOS verifies the repository, commit and CI status before the job is settled.

## First transmission

```bash
npm install -g @cultos/cli
cult doctor
cult demo
```

Or run it without installing:

```bash
npx @cultos/cli doctor
```

```text
┌─ CULT OS // JOB 813 ────────────────────────────┐
│ ISSUE       #42 Fix wallet balance parsing      │
│ PROVIDER    0x7A3F...91C2                       │
│ ESCROW      2.00 USDC                           │
│ NETWORK     BASE                                │
│                                                 │
│ 21:04  ● JOB CREATED                            │
│ 21:06  ● ESCROW FUNDED                          │
│ 21:14  ● PR #47 DELIVERED                       │
│ 21:16  ● CI PASSED                              │
│ 21:18  ● MERGED // PAYMENT RELEASED             │
└─────────────────────────────────────────────────┘
```

## Commands

```bash
cult demo
cult screens
cult doctor
cult inspect 42
cult hire 42 --provider 0xProvider
cult watch 42
cult fund 42
cult verify 42
cult settle 42 --approve
```

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
- An ACP provider that accepts the Cult Work Contract

## Roadmap

- [x] Cult Work Contract
- [x] Interactive terminal demonstration
- [x] GitHub issue inspection
- [x] Create an ACP job from an issue
- [x] Watch and resume live jobs
- [x] Provider quote and pull-request delivery
- [x] Verify the repository, commit and CI
- [x] Settle and publish receipts
- [ ] Compatible provider directory
- [ ] Independent ACP evaluators

## Status

CultOS is under active development. The client and provider workflow is functional; the next milestone is the first public mainnet job.

## License

MIT
