# GitLawb

CultOS supports GitLawb repositories alongside GitHub.

## Setup

```bash
npm install -g @gitlawb/gl
gl identity new
gl register
```

Run CultOS inside a repository whose origin uses `gitlawb://`:

```bash
cult start
cult inspect <issue-id>
cult hire <issue-id> --provider <address> --offering <name>
```

The provider returns a GitLawb pull request:

```bash
cult deliver --job <job-id> --pr gitlawb://<owner>/<repository>/pull/<number>
```

CultOS verifies the target branch, delivered commit and signed push certificate. After review, merge the pull request and settle the ACP job normally.

The ACP provider must accept `cultos.gitlawb.issue.v1` work contracts and return `cultos.gitlawb.pull-request.v1` deliveries.
