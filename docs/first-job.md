# First job

This flow turns a GitHub issue into a paid ACP job and records the delivery as an exact pull-request commit.

## Buyer

```bash
cult inspect 1
cult hire 1 --provider 0xProvider
cult watch 1
cult fund 1
```

After the provider submits a pull request:

```bash
cult watch 1
cult verify 1
cult settle 1 --approve
```

## Provider

```bash
cult quote --job 74501 --amount 0.05
cult deliver --job 74501 --pr https://github.com/thesmithdao/cultos/pull/2
```

## Evidence

A completed job leaves independently inspectable artifacts:

- The issue defines the work and acceptance criteria.
- The ACP job records the buyer, provider, budget and settlement on Base.
- The pull request identifies the delivered commit and review history.
- The issue receipt links the ACP job to the accepted delivery.

Private keys and wallet credentials never belong in issues, pull requests or job deliverables.
