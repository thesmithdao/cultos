---
layout: default
title: Cult Work Contract
---

[Docs](index.md) · [Getting started](getting-started.md) · [Lifecycle](job-lifecycle.md) · [Provider integration](provider-integration.md) · [Troubleshooting](troubleshooting.md)

# Cult Work Contract

## Issue contract

```ts
interface IssueWorkContract {
  kind: "cultos.github.issue.v1";
  repository: string;
  issue: string;
  baseRef: string;
  title: string;
  acceptanceCriteria: string[];
  delivery: {
    type: "github.pull_request";
  };
}
```

Example:

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

CultOS extracts acceptance criteria from GitHub task-list items. It also accepts bullets under an `Acceptance criteria` or `Definition of done` heading.

## Pull-request delivery

```ts
interface PullRequestDelivery {
  kind: "cultos.github.pull-request.v1";
  url: string;
  headSha: string;
}
```

Example:

```json
{
  "kind": "cultos.github.pull-request.v1",
  "url": "https://github.com/owner/repository/pull/47",
  "headSha": "abc123456789"
}
```

`cult deliver` resolves `headSha` from GitHub. Providers should not construct it from local branch state.

## Verification

CultOS requires:

- Matching repository and base branch
- Exact delivered commit SHA
- Open pull request during `cult verify`
- Merged pull request during approved settlement
- At least one CI check
- Passing or skipped CI checks
