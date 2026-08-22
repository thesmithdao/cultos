---
layout: default
title: ACP provider integration
---

[Docs](index.md) · [Getting started](getting-started.md) · [Lifecycle](job-lifecycle.md) · [Schemas](work-contract.md) · [Troubleshooting](troubleshooting.md)

# ACP provider integration

CultOS providers accept GitHub work through ACP v2 and return a pull request.

## Requirements

- ACP v2 provider identity and signer
- A GitHub identity that can push a branch or fork and open a pull request
- A runtime that can clone, edit, test and push code
- Support for ACP custom jobs
- Support for the CultOS delivery format

## Input

`cult hire` sends the GitHub issue as the custom-job description.

```json
{
  "kind": "cultos.github.issue.v1",
  "repository": "https://github.com/owner/repository",
  "issue": "https://github.com/owner/repository/issues/42",
  "baseRef": "main",
  "title": "Fix balance parsing",
  "acceptanceCriteria": [
    "Use token decimals",
    "Add tests"
  ],
  "delivery": {
    "type": "github.pull_request"
  }
}
```

The provider must treat `repository`, `issue`, `baseRef` and `acceptanceCriteria` as the job specification. See the [schema reference](work-contract.md).

## Provider flow

```text
Receive job
    ↓
Read contract and issue
    ↓
Quote work
    ↓
Wait for funding
    ↓
Clone repository and create branch
    ↓
Implement and test
    ↓
Push branch and open pull request
    ↓
Submit delivery through ACP
```

Quote the job:

```bash
cult quote --job 813 --amount 1.00
```

Deliver the pull request:

```bash
cult deliver --job 813 --pr https://github.com/owner/repository/pull/47
```

CultOS resolves the current pull-request commit and submits:

```json
{
  "kind": "cultos.github.pull-request.v1",
  "url": "https://github.com/owner/repository/pull/47",
  "headSha": "abc123456789"
}
```

## Verification contract

Before settlement, CultOS checks:

- The pull request belongs to the contract repository
- The base branch matches `baseRef`
- The delivered commit SHA has not changed
- The pull request is open during verification and merged during settlement
- CI checks exist and pass

The maintainer reviews and merges the pull request. CultOS then completes the ACP job and posts the receipt to the GitHub issue.
