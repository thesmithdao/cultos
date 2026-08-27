[Docs](index.md) · [Getting started](getting-started.md) · [Provider](cultos-provider.md) · [Schemas](work-contract.md)

# Aeon pull-request reviews

CultOS can hire its ACP provider to review a public GitHub pull request with an Aeon skill.
The live offering costs 0.01 USDC through provider `0xd494a454888a390b2b05df74ae2b5fd9c9902b71`.

```bash
cult hire 42 \
  --pr 47 \
  --provider 0xd494a454888a390b2b05df74ae2b5fd9c9902b71 \
  --offering aeon_pull_request_review
cult watch 42:review
cult fund 42:review
cult watch 42:review
cult verify 42:review
```

The review is pinned to the pull request head commit. The delivery contains a bounded verdict, up to five findings and the Aeon run URL.

| Verdict | Meaning |
|---|---|
| `approve-ready` | No material defect found |
| `discussion-needed` | Medium findings need maintainer review |
| `blocked` | A high or critical defect was found |

`cult verify 42:review` checks the repository, issue, pull request and exact commit. A blocked verdict is still a valid delivered review and can be settled:

```bash
cult settle 42:review --approve
```
