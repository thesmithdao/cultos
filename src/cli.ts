#!/usr/bin/env node

import { readFileSync } from "node:fs";
import pc from "picocolors";
import { Command } from "commander";
import {
  completeJob,
  createJob,
  currentAgent,
  fundJob,
  listAgents,
  quoteJob,
  rejectJob,
  requireProviderIdentity,
  sendMessage,
  submitJob,
  useAgent,
  watchJob
} from "./acp.js";
import {
  createPullRequestDelivery,
  createReviewContract,
  createWorkContract,
  isAeonReviewDelivery,
  parseAeonReviewDelivery,
  parsePullRequestDelivery
} from "./contract.js";
import { runBbs } from "./bbs.js";
import { cell, plain, safe } from "./display.js";
import { runDoctor } from "./doctor.js";
import { runStart } from "./start.js";
import {
  detectRepositoryPlatform,
  commentOnRepositoryIssue,
  getRepositoryInfo,
  getRepositoryIssue,
  getRepositoryPullRequest,
  type RepositoryInfo,
  type RepositoryIssue
} from "./repository.js";
import type { RepositoryPlatform } from "./contract.js";
import {
  assertStorableJobReference,
  getJob,
  jobReference,
  listJobs,
  saveJob,
  updateJob
} from "./state.js";
import { verifyJob, verifyReviewJob } from "./verify.js";

const program = new Command();
const packageVersion = (JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string }).version;

function issueNumber(value: string): number {
  const fromUrl = value.match(/^https:\/\/[^/]*github\.com\/[^/]+\/[^/]+\/issues\/(\d+)$/)?.[1];
  const parsed = Number.parseInt(fromUrl ?? value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `Invalid issue reference: ${value}. Give an issue number or a GitHub issue URL.`
    );
  }
  return parsed;
}

/**
 * Refuse an issue that lives somewhere other than the resolved repository.
 *
 * `gh issue view` resolves a full URL against the repository in that URL and
 * ignores `--repo`, so an issue reference from elsewhere would otherwise be
 * paired with the local repository in the contract — and `settle` would post
 * the receipt to the local repository at the foreign issue number.
 *
 * GitLawb builds its issue URL from the repository it already resolved, so
 * the mismatch cannot arise there.
 */
function requireSameRepository(repository: RepositoryInfo, issue: RepositoryIssue): void {
  if (repository.platform !== "github") return;
  if (!issue.url.startsWith(`${repository.url}/issues/`)) {
    throw new Error(
      `Issue ${issue.url} does not belong to ${repository.nameWithOwner}. `
      + "Pass --repo to work on another repository."
    );
  }
}

function platform(value?: string): RepositoryPlatform {
  if (!value) return detectRepositoryPlatform();
  if (value !== "github" && value !== "gitlawb") {
    throw new Error(`Invalid repository platform: ${value}`);
  }
  return value;
}

function issueReference(value: string, repositoryPlatform: RepositoryPlatform): number | string {
  return repositoryPlatform === "github" ? issueNumber(value) : value.match(/\/issues\/([^/]+)$/)?.[1] ?? value;
}

function chainId(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid chain ID: ${value}`);
  }
  return parsed;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function printAgentIdentity(agent: ReturnType<typeof currentAgent>, active = false): void {
  console.log(`${active ? pc.green("◆") : pc.dim("◇")} ${agent.name}`);
  console.log(`  ${agent.walletAddress}`);
  console.log(pc.dim(`  ${agent.id}`));
}

function providerIdentity(jobId: string, network: number): ReturnType<typeof currentAgent> {
  const local = listJobs().find(job => job.jobId === jobId && job.chainId === network);
  return requireProviderIdentity(local?.provider);
}

function providerAction(
  issue: string | undefined,
  options: { job?: string; chain?: string }
): { jobId: string; network: number } {
  if (issue && options.job) throw new Error("Choose an issue or --job, not both");
  if (issue) {
    const job = getJob(issue);
    if (options.chain && chainId(options.chain) !== job.chainId) {
      throw new Error(`Issue ${issue} is recorded on chain ${job.chainId}`);
    }
    return { jobId: job.jobId, network: job.chainId };
  }
  if (!options.job) throw new Error("Provide an issue or --job");
  return { jobId: options.job, network: chainId(options.chain ?? "8453") };
}

function settlementReceipt(job: ReturnType<typeof getJob>, outcome: "completed" | "rejected"): string {
  const delivery = job.delivery
    ? isAeonReviewDelivery(job.delivery)
      ? [
          `| Review | ${cell(job.delivery.run.url)} |`,
          `| Verdict | **${cell(job.delivery.verdict)}** |`,
          `| Commit | \`${cell(job.delivery.head_sha)}\` |`
        ]
      : [
          `| Delivery | ${cell(job.delivery.url)} |`,
          `| Commit | \`${cell(job.delivery.headSha)}\` |`
        ]
    : [];
  return [
    `<!-- cultos-job:${job.chainId}:${cell(job.jobId)} -->`,
    "### CultOS receipt",
    "",
    "| | |",
    "|---|---|",
    `| ACP job | \`${cell(job.jobId)}\` |`,
    `| Provider | \`${cell(job.provider)}\` |`,
    `| Result | **${outcome}** |`,
    ...(job.budget ? [`| Settlement | ${cell(job.budget)} USDC |`] : []),
    ...delivery
  ].join("\n");
}

function printJob(issue: number | string): void {
  const job = getJob(issue);
  const label = job.service === "review" ? "REVIEW" : "ISSUE";
  console.log(pc.bold(`\nCULT OS // ${label} #${safe(String(job.issueNumber))}\n`));
  console.log(`${pc.dim("ACP JOB")}     ${safe(job.jobId)}`);
  console.log(`${pc.dim("STATUS")}      ${safe(job.status).toUpperCase()}`);
  console.log(`${pc.dim("PROVIDER")}    ${safe(job.provider)}`);
  console.log(`${pc.dim("NETWORK")}     ${job.chainId}`);
  if (job.budget) {
    console.log(`${pc.dim("BUDGET")}      ${safe(job.budget)} USDC`);
  }
  if (job.delivery) {
    if (isAeonReviewDelivery(job.delivery)) {
      console.log(`${pc.dim("VERDICT")}     ${job.delivery.verdict.toUpperCase()}`);
      console.log(`${pc.dim("REVIEW")}      ${safe(job.delivery.run.url)}`);
    } else {
      console.log(`${pc.dim("DELIVERY")}    ${safe(job.delivery.url)}`);
    }
  }
  console.log();
}

program
  .name("cult")
  .description("Repository work for the agent economy.")
  .version(packageVersion);

program.command("doctor").description("Check the local repository and ACP setup").action(runDoctor);
program.command("ui").description("Open the CultOS command deck").action(runBbs);
program.command("start").description("Set up CultOS and open the terminal").action(async () => {
  if (!await runStart()) process.exitCode = 1;
});

program
  .command("inspect")
  .argument("<issue>", "Issue ID or URL")
  .option("-R, --repo <owner/name>", "Repository")
  .option("--platform <name>", "Repository platform: github or gitlawb")
  .description("Build a Cult Work Contract from an issue")
  .action((reference: string, options: { repo?: string; platform?: string }) => {
    const repositoryPlatform = platform(options.platform);
    const repository = getRepositoryInfo(options.repo, repositoryPlatform);
    const issue = getRepositoryIssue(reference, options.repo, repositoryPlatform);
    requireSameRepository(repository, issue);
    const contract = createWorkContract({
      platform: repositoryPlatform,
      repositoryUrl: repository.url,
      issueUrl: issue.url,
      baseRef: repository.defaultBranch,
      title: issue.title,
      body: issue.body
    });

    console.log(pc.bold(`\nIssue #${safe(String(issue.id))}`));
    console.log(safe(issue.title));
    console.log(pc.dim(`\n${safe(repository.nameWithOwner)}\n`));

    if (contract.acceptanceCriteria.length > 0) {
      console.log(pc.bold("Acceptance criteria"));
      for (const criterion of contract.acceptanceCriteria) {
        console.log(`${pc.green("✓")} ${safe(criterion)}`);
      }
      console.log();
    }

    console.log(pc.bold("Cult Work Contract\n"));
    console.log(JSON.stringify(contract, null, 2));
    console.log();
  });

const agent = program.command("agent").description("Inspect or switch the active ACP agent");

agent.command("list").description("List available ACP agents").action(() => {
  const active = currentAgent();
  console.log(pc.bold("\nCULT OS // ACP AGENTS\n"));
  for (const item of listAgents()) {
    printAgentIdentity(item, item.id === active.id);
    console.log();
  }
});

agent.command("current").description("Show the active ACP agent").action(() => {
  console.log(pc.bold("\nCULT OS // ACTIVE AGENT\n"));
  printAgentIdentity(currentAgent(), true);
  console.log();
});

agent
  .command("use")
  .argument("<agent>", "ACP agent ID or exact name (quote names containing spaces)")
  .description("Switch the active ACP agent")
  .action((agentId: string) => {
    const selected = useAgent(agentId);
    console.log(pc.bold("\nCULT OS // ACTIVE AGENT\n"));
    printAgentIdentity(selected, true);
    console.log();
  });

program
  .command("hire")
  .argument("<issue>", "Issue ID")
  .requiredOption("--provider <address>", "ACP provider wallet address")
  .option("-R, --repo <owner/name>", "Repository")
  .option("--platform <name>", "Repository platform: github or gitlawb")
  .option("--offering <name>", "ACP offering name")
  .option("--pr <url>", "Pull request to review")
  .option("--chain <id>", "ACP chain ID", "8453")
  .option("--expiry <seconds>", "Custom job expiry", "86400")
  .description("Create an ACP job from an issue")
  .action((value: string, options: Record<string, string | undefined>) => {
    const repositoryPlatform = platform(options.platform);
    const number = issueReference(value, repositoryPlatform);
    assertStorableJobReference(number);
    const reference = options.pr ? `${number}:review` : String(number);
    const existing = listJobs().find((job) => jobReference(job) === reference);
    if (existing) {
      throw new Error(`Issue #${number} is already linked to ACP job ${existing.jobId}`);
    }

    const repository = getRepositoryInfo(options.repo, repositoryPlatform);
    const issue = getRepositoryIssue(value, options.repo, repositoryPlatform);
    requireSameRepository(repository, issue);
    const pullRequest = options.pr ? getRepositoryPullRequest(options.pr) : undefined;
    if (pullRequest && repositoryPlatform !== "github") {
      throw new Error("Aeon reviews currently require GitHub");
    }
    if (pullRequest && !pullRequest.url.startsWith(`${repository.url}/pull/`)) {
      throw new Error("Pull request belongs to a different repository");
    }
    if (pullRequest && pullRequest.state !== "OPEN") {
      throw new Error("Pull request must be open");
    }
    const contract = pullRequest
      ? createReviewContract({
          repositoryUrl: repository.url,
          issueUrl: issue.url,
          pullRequestUrl: pullRequest.url,
          headSha: pullRequest.headSha
        })
      : createWorkContract({
          platform: repositoryPlatform,
          repositoryUrl: repository.url,
          issueUrl: issue.url,
          baseRef: repository.defaultBranch,
          title: issue.title,
          body: issue.body
        });
    const provider = options.provider;
    if (!provider) {
      throw new Error("Provider address is required");
    }

    console.log(pc.dim("Creating ACP job..."));
    const created = createJob({
      provider,
      ...(options.offering ? { offering: options.offering } : {}),
      chainId: chainId(options.chain ?? "8453"),
      expiry: positiveInteger(options.expiry ?? "86400", "expiry"),
      contract
    });
    const now = new Date().toISOString();

    saveJob({
      issueNumber: issue.id,
      ...(pullRequest ? { service: "review" as const } : {}),
      repository: repository.nameWithOwner,
      contract,
      provider,
      ...(options.offering ? { offering: options.offering } : {}),
      jobId: created.jobId,
      chainId: created.chainId,
      ...(created.protocol ? { protocol: created.protocol } : {}),
      status: "open",
      createdAt: now,
      updatedAt: now
    });

    console.log(pc.green(`ACP job ${safe(created.jobId)} created for issue #${safe(String(issue.id))}.`));
    console.log(pc.dim(`Run cult watch ${safe(reference)} to follow it.`));
  });

program
  .command("watch")
  .argument("<issue>", "Issue ID")
  .option("--timeout <seconds>", "Stop waiting after this many seconds")
  .description("Wait until an ACP job needs attention")
  .action((value: string, options: { timeout?: string }) => {
    const number = value;
    const job = getJob(number);
    console.log(pc.dim(`Watching ACP job ${safe(job.jobId)}...`));
    const watched = watchJob(
      job.jobId,
      options.timeout ? positiveInteger(options.timeout, "timeout") : undefined,
      job.chainId
    );
    const update: Parameters<typeof updateJob>[1] = { status: watched.status };

    if (watched.budget) {
      update.budget = watched.budget;
    }
    if (watched.deliverable) {
      try {
        update.delivery = job.contract.kind === "cultos.github.review.v1"
          ? parseAeonReviewDelivery(watched.deliverable)
          : parsePullRequestDelivery(watched.deliverable);
      } catch {
        const expected = job.contract.kind === "cultos.github.review.v1"
          ? "an Aeon review"
          : "a CultOS pull request";
        console.log(pc.yellow(`Provider submitted a deliverable that is not ${expected}.`));
      }
    }

    updateJob(number, update);
    printJob(number);
    const next = watched.status === "budget_set"
      ? `Buyer: run cult fund ${number}.`
      : watched.status === "submitted"
        ? `Buyer: run cult verify ${number}.`
        : watched.status === "open"
          ? "Waiting for the provider quote."
          : watched.status === "funded" ? "Waiting for the provider delivery." : undefined;
    if (next) console.log(pc.dim(`${next}\n`));
  });

program
  .command("fund")
  .argument("<issue>", "Issue ID")
  .description("Fund the quoted ACP job")
  .action((value: string) => {
    const number = value;
    const job = getJob(number);
    if (["funded", "submitted", "verified", "completed", "rejected"].includes(job.status)) {
      throw new Error(`ACP job ${job.jobId} is already ${job.status}`);
    }
    if (!job.budget) {
      throw new Error(`No provider quote found. Run cult watch ${number} first.`);
    }

    fundJob(job.jobId, job.chainId, job.budget);
    updateJob(number, { status: "funded" });
    console.log(pc.green(`\nACP job ${safe(job.jobId)} funded with ${safe(job.budget)} USDC.\n`));
  });

program
  .command("message")
  .argument("<issue>", "Issue ID")
  .argument("<content>", "Message text")
  .description("Send a message to the ACP job room")
  .action((value: string, content: string) => {
    const job = getJob(value);
    sendMessage(job.jobId, job.chainId, content);
    console.log(pc.green("\nMessage sent.\n"));
  });

program
  .command("quote")
  .argument("[issue]", "Issue ID recorded by Cult OS")
  .option("--job <id>", "ACP job ID for a remote provider")
  .requiredOption("--amount <usdc>", "Service price in USDC")
  .option("--chain <id>", "ACP chain ID")
  .description("Set a provider quote for an ACP job")
  .action((issue: string | undefined, options: { job?: string; amount: string; chain?: string }) => {
    const { jobId, network } = providerAction(issue, options);
    const identity = providerIdentity(jobId, network);
    console.log(pc.dim(`Provider identity: ${safe(identity.name)} · ${identity.walletAddress}`));
    quoteJob(jobId, network, options.amount);
    console.log(pc.green(`\nQuoted ${safe(options.amount)} USDC for ACP job ${safe(jobId)}.\n`));
  });

program
  .command("deliver")
  .argument("[issue]", "Issue ID recorded by Cult OS")
  .option("--job <id>", "ACP job ID for a remote provider")
  .requiredOption("--pr <url>", "Delivered pull request")
  .option("--chain <id>", "ACP chain ID")
  .description("Submit a pull request as an ACP provider")
  .action((issue: string | undefined, options: { job?: string; pr: string; chain?: string }) => {
    const { jobId, network } = providerAction(issue, options);
    const identity = providerIdentity(jobId, network);
    console.log(pc.dim(`Provider identity: ${safe(identity.name)} · ${identity.walletAddress}`));
    const pullRequest = getRepositoryPullRequest(options.pr);
    const delivery = createPullRequestDelivery(
      pullRequest.url,
      pullRequest.headSha,
      pullRequest.platform ?? "github"
    );
    submitJob(jobId, network, delivery);
    console.log(pc.green(`\nDelivered PR #${pullRequest.number} at ${safe(pullRequest.headSha).slice(0, 12)}.\n`));
  });

program
  .command("verify")
  .argument("<issue>", "Issue ID")
  .description("Verify the delivered work")
  .action((value: string) => {
    const number = value;
    const job = getJob(number);
    if (job.contract.kind === "cultos.github.review.v1") {
      const review = verifyReviewJob(job);
      console.log(pc.bold(`\nCULT OS // VERIFY REVIEW #${review.pullRequest}\n`));
      console.log(`${pc.dim("VERDICT")}     ${review.verdict.toUpperCase()}`);
      console.log(`${pc.dim("SUMMARY")}     ${safe(review.summary)}`);
      for (const finding of review.findings) {
        const marker = finding.severity === "medium" ? pc.yellow("●") : pc.red("●");
        const line = finding.line ? `:${finding.line}` : "";
        console.log(`${marker} ${safe(finding.path)}${line} ${safe(finding.title)}`);
      }
      if (review.passed) {
        console.log(pc.green(`\nReview verified at ${safe(review.headSha).slice(0, 12)}.\n`));
        updateJob(number, { status: "verified" });
      } else {
        console.log(pc.red("\nVerification failed:"));
        for (const failure of review.failures) console.log(`- ${safe(failure)}`);
        console.log();
        process.exitCode = 1;
      }
      return;
    }
    const result = verifyJob(job);

    console.log(pc.bold(`\nCULT OS // VERIFY PR #${result.pullRequest}\n`));
    for (const check of result.checks) {
      const marker = ["pass", "skipping"].includes(check.bucket) ? pc.green("●") : pc.red("●");
      console.log(`${marker} ${safe(check.name)} ${pc.dim(safe(check.state))}`);
    }

    if (result.passed) {
      console.log(pc.green(`\nVerified at ${safe(result.headSha).slice(0, 12)}.\n`));
      updateJob(number, { status: "verified" });
    } else {
      console.log(pc.red("\nVerification failed:"));
      for (const failure of result.failures) {
        console.log(`- ${safe(failure)}`);
      }
      console.log();
      process.exitCode = 1;
    }
  });

program
  .command("settle")
  .argument("<issue>", "Issue ID")
  .option("--approve", "Approve the delivery")
  .option("--reject", "Reject the delivery")
  .option("--reason <text>", "Settlement reason", "Work reviewed through CultOS")
  .description("Complete or reject an ACP job and publish its receipt")
  .action((value: string, options: { approve?: boolean; reject?: boolean; reason: string }) => {
    const number = value;
    const job = getJob(number);
    if (options.approve === options.reject) {
      throw new Error("Choose either --approve or --reject");
    }
    const outcome = options.approve ? "completed" : "rejected";
    const terminalStatus = job.status === "completed" || job.status === "rejected";
    const retryingReceipt = job.settledByCultos === outcome && !job.receiptPostedAt;
    if (terminalStatus && !retryingReceipt) {
      throw new Error(`ACP job ${job.jobId} is already ${job.status}`);
    }
    if (job.receiptPostedAt) {
      throw new Error(`Receipt already posted for ACP job ${job.jobId}`);
    }

    if (!retryingReceipt) {
      if (options.approve) {
        const verification = job.contract.kind === "cultos.github.review.v1"
          ? verifyReviewJob(job)
          : verifyJob(job, "MERGED");
        if (!verification.passed) {
          throw new Error(`Settlement verification failed:\n- ${verification.failures.join("\n- ")}`);
        }
        completeJob(job.jobId, job.chainId, options.reason);
      } else {
        rejectJob(job.jobId, job.chainId, options.reason);
      }
      updateJob(number, { status: outcome, settledByCultos: outcome });
    }

    const repositoryPlatform = job.contract.kind === "cultos.gitlawb.issue.v1" ? "gitlawb" : "github";
    commentOnRepositoryIssue(
      repositoryPlatform,
      job.repository,
      job.issueNumber,
      settlementReceipt(job, outcome)
    );
    updateJob(number, { receiptPostedAt: new Date().toISOString() });
    console.log(pc.green(`\nACP job ${safe(job.jobId)} ${outcome}. Receipt posted to issue #${safe(String(job.issueNumber))}.\n`));
  });

program
  .command("jobs")
  .description("List jobs linked to the current repository")
  .action(() => {
    const jobs = listJobs();
    if (jobs.length === 0) {
      console.log(pc.dim("\nNo CultOS jobs yet.\n"));
      return;
    }
    console.log(pc.bold("\nCULT OS // JOBS\n"));
    for (const job of jobs) {
      console.log(`#${safe(jobReference(job)).padEnd(13)} ${safe(job.status).padEnd(12)} ACP ${safe(job.jobId)}`);
    }
    console.log();
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`\n${plain(message)}\n`));
  process.exitCode = 1;
});
