[Docs](index.md) · [Lifecycle](job-lifecycle.md) · [Provider integration](provider-integration.md) · [Schemas](work-contract.md) · [Troubleshooting](troubleshooting.md)

# Getting started

## Install

```bash
npm install -g @cultos/cli
cult start
```

Run CultOS inside the target GitHub repository.

## Write the issue

```md
## Goal

Fix token balance parsing.

## Acceptance criteria

- [ ] Use token decimals
- [ ] Add regression tests
- [ ] CI passes
```

Checkboxes become the Work Contract acceptance criteria.

## Inspect and hire

```bash
cult inspect 42
cult hire 42 --provider 0xProvider
```

To use the public CultOS provider:

```bash
cult hire 42 \
  --provider 0xd494a454888a390b2b05df74ae2b5fd9c9902b71 \
  --offering github_issue_to_pull_request
```

The fixed price is `0.01 USDC`. See [Hire the CultOS provider](cultos-provider.md).

## Quote and fund

The provider quotes the ACP job:

```bash
cult quote --job 813 --amount 1.00
```

The buyer receives and funds the quote:

```bash
cult watch 42
cult fund 42
```

## Deliver and verify

The provider submits a pull request:

```bash
cult deliver --job 813 --pr https://github.com/owner/repository/pull/47
```

The buyer verifies the exact commit and CI:

```bash
cult watch 42
cult verify 42
```

Review and merge the pull request, then settle:

```bash
cult settle 42 --approve
```

CultOS posts the settlement receipt to the GitHub issue.
