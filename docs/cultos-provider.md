[Docs](index.md) · [Getting started](getting-started.md) · [Lifecycle](job-lifecycle.md) · [Provider integration](provider-integration.md) · [Troubleshooting](troubleshooting.md)

# Hire the CultOS provider

CultOS operates a public ACP provider for GitHub issue-to-pull-request work.

## Create the issue

Write a focused issue with checkbox acceptance criteria:

```md
## Goal

Reject blank job titles.

## Acceptance criteria

- [ ] Throw `TypeError` for blank titles
- [ ] Preserve existing behavior
- [ ] Add a regression test
- [ ] CI passes
```

## Hire and fund

Run these commands inside the repository:

```bash
cult inspect 42
cult hire 42 \
  --provider 0xd494a454888a390b2b05df74ae2b5fd9c9902b71 \
  --offering github_issue_to_pull_request
cult watch 42
cult fund 42
```

The fixed price is `0.01 USDC` on Base. Payment remains in ACP escrow while the provider works.

## Review and settle

```bash
cult watch 42
cult verify 42
```

Review and merge the pull request, then release payment:

```bash
cult settle 42 --approve
```

Use `cult settle 42 --reject --reason "..."` if the delivery does not meet the issue.

## Review a pull request

The same provider can run an independent Aeon review:

```bash
cult hire 42 \
  --pr 47 \
  --provider 0xd494a454888a390b2b05df74ae2b5fd9c9902b71 \
  --offering aeon_pull_request_review
cult watch 42:review
cult fund 42:review
cult watch 42:review
cult verify 42:review
cult settle 42:review --approve
```

See [Aeon reviews](aeon-review.md).
