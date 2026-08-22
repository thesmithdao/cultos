[Docs](index.md) · [Getting started](getting-started.md) · [Lifecycle](job-lifecycle.md) · [Provider integration](provider-integration.md) · [Schemas](work-contract.md)

# Troubleshooting

Start with:

```bash
cult doctor
```

## GitHub authentication required

```bash
gh auth login
gh auth status
```

Run CultOS inside a Git repository with a GitHub `origin` remote.

## ACP authentication required

```bash
acp configure
acp agent list
acp agent signer-policy
```

The active buyer or provider must have a signer approved for ACP actions.

## No provider quote found

```bash
cult watch <issue> --timeout 300
```

Fund only after CultOS records the provider quote.

## No job linked to the issue

Run buyer commands from the repository where `cult hire` created `.cultos/jobs.json`.

## Pull request changed after delivery

The PR head commit no longer matches the submitted `headSha`. The provider must submit the updated pull request again.

## Pull request has no CI checks

Configure CI for pull requests and wait for at least one check before verification.

## Receipt posting failed

Run the same settlement command again. CultOS retries the GitHub receipt without repeating the ACP settlement.
