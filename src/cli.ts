#!/usr/bin/env node

import pc from "picocolors";
import { Command } from "commander";
import {
  completeJob,
  createJob,
  fundJob,
  quoteJob,
  rejectJob,
  sendMessage,
  submitJob,
  watchJob
} from "./acp.js";
import {
  createPullRequestDelivery,
  createWorkContract,
  parsePullRequestDelivery
} from "./contract.js";
import { runBbs } from "./bbs.js";
import { runDoctor } from "./doctor.js";
import { commentOnIssue, getIssue, getPullRequest, getRepository } from "./github.js";
import { getJob, listJobs, saveJob, updateJob } from "./state.js";
import { verifyJob } from "./verify.js";

const program = new Command();

function issueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid issue number: ${value}`);
  }
  return parsed;
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

function settlementReceipt(job: ReturnType<typeof getJob>, outcome: "completed" | "rejected"): string {
  return [
    `<!-- cultos-job:${job.chainId}:${job.jobId} -->`,
    "### CultOS receipt",
    "",
    "| | |",
    "|---|---|",
    `| ACP job | \`${job.jobId}\` |`,
    `| Provider | \`${job.provider}\` |`,
    `| Result | **${outcome}** |`,
    ...(job.budget ? [`| Settlement | ${job.budget} USDC |`] : []),
    ...(job.delivery
      ? [`| Delivery | ${job.delivery.url} |`, `| Commit | \`${job.delivery.headSha}\` |`]
      : [])
  ].join("\n");
}

function printJob(issue: number): void {
  const job = getJob(issue);
  console.log(pc.bold(`\nCULT OS // ISSUE #${job.issueNumber}\n`));
  console.log(`${pc.dim("ACP JOB")}     ${job.jobId}`);
  console.log(`${pc.dim("STATUS")}      ${job.status.toUpperCase()}`);
  console.log(`${pc.dim("PROVIDER")}    ${job.provider}`);
  console.log(`${pc.dim("NETWORK")}     ${job.chainId}`);
  if (job.budget) {
    console.log(`${pc.dim("BUDGET")}      ${job.budget} USDC`);
  }
  if (job.delivery) {
    console.log(`${pc.dim("DELIVERY")}    ${job.delivery.url}`);
  }
  console.log();
}

program
  .name("cult")
  .description("GitHub-native work for the agent economy.")
  .version("0.2.3");

program.command("doctor").description("Check the local GitHub and ACP setup").action(runDoctor);
program.command("ui").description("Open the CultOS command deck").action(runBbs);

program
  .command("inspect")
  .argument("<issue>", "GitHub issue number or URL")
  .option("-R, --repo <owner/name>", "GitHub repository")
  .description("Build a Cult Work Contract from a GitHub issue")
  .action((reference: string, options: { repo?: string }) => {
    const repository = getRepository(options.repo);
    const issue = getIssue(reference, options.repo);
    const contract = createWorkContract({
      repositoryUrl: repository.url,
      issueUrl: issue.url,
      baseRef: repository.defaultBranch,
      title: issue.title,
      body: issue.body
    });

    console.log(pc.bold(`\nIssue #${issue.number}`));
    console.log(issue.title);
    console.log(pc.dim(`\n${repository.nameWithOwner}\n`));

    if (contract.acceptanceCriteria.length > 0) {
      console.log(pc.bold("Acceptance criteria"));
      for (const criterion of contract.acceptanceCriteria) {
        console.log(`${pc.green("✓")} ${criterion}`);
      }
      console.log();
    }

    console.log(pc.bold("Cult Work Contract\n"));
    console.log(JSON.stringify(contract, null, 2));
    console.log();
  });

program
  .command("hire")
  .argument("<issue>", "GitHub issue number")
  .requiredOption("--provider <address>", "ACP provider wallet address")
  .option("-R, --repo <owner/name>", "GitHub repository")
  .option("--offering <name>", "ACP offering name")
  .option("--chain <id>", "ACP chain ID", "8453")
  .option("--expiry <seconds>", "Custom job expiry", "86400")
  .description("Create an ACP job from a GitHub issue")
  .action((value: string, options: Record<string, string | undefined>) => {
    const number = issueNumber(value);
    const existing = listJobs().find((job) => job.issueNumber === number);
    if (existing) {
      throw new Error(`Issue #${number} is already linked to ACP job ${existing.jobId}`);
    }

    const repository = getRepository(options.repo);
    const issue = getIssue(value, options.repo);
    const contract = createWorkContract({
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
      expiry: Number.parseInt(options.expiry ?? "86400", 10),
      contract
    });
    const now = new Date().toISOString();

    saveJob({
      issueNumber: issue.number,
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

    console.log(pc.green(`ACP job ${created.jobId} created for issue #${issue.number}.`));
    console.log(pc.dim(`Run cult watch ${issue.number} to follow it.`));
  });

program
  .command("watch")
  .argument("<issue>", "GitHub issue number")
  .option("--timeout <seconds>", "Stop waiting after this many seconds")
  .description("Wait until an ACP job needs attention")
  .action((value: string, options: { timeout?: string }) => {
    const number = issueNumber(value);
    const job = getJob(number);
    console.log(pc.dim(`Watching ACP job ${job.jobId}...`));
    const watched = watchJob(
      job.jobId,
      options.timeout ? positiveInteger(options.timeout, "timeout") : undefined
    );
    const update: Parameters<typeof updateJob>[1] = { status: watched.status };

    if (watched.budget) {
      update.budget = watched.budget;
    }
    if (watched.deliverable) {
      try {
        update.delivery = parsePullRequestDelivery(watched.deliverable);
      } catch {
        console.log(pc.yellow("Provider submitted a deliverable that is not a CultOS pull request."));
      }
    }

    updateJob(number, update);
    printJob(number);
    if (watched.availableTools.length > 0) {
      console.log(pc.dim(`Available: ${watched.availableTools.join(", ")}\n`));
    }
  });

program
  .command("fund")
  .argument("<issue>", "GitHub issue number")
  .description("Fund the quoted ACP job")
  .action((value: string) => {
    const number = issueNumber(value);
    const job = getJob(number);
    if (["funded", "submitted", "verified", "completed", "rejected"].includes(job.status)) {
      throw new Error(`ACP job ${job.jobId} is already ${job.status}`);
    }
    if (!job.budget) {
      throw new Error(`No provider quote found. Run cult watch ${number} first.`);
    }

    fundJob(job.jobId, job.chainId, job.budget);
    updateJob(number, { status: "funded" });
    console.log(pc.green(`\nACP job ${job.jobId} funded with ${job.budget} USDC.\n`));
  });

program
  .command("message")
  .argument("<issue>", "GitHub issue number")
  .argument("<content>", "Message text")
  .description("Send a message to the ACP job room")
  .action((value: string, content: string) => {
    const job = getJob(issueNumber(value));
    sendMessage(job.jobId, job.chainId, content);
    console.log(pc.green("\nMessage sent.\n"));
  });

program
  .command("quote")
  .requiredOption("--job <id>", "ACP job ID")
  .requiredOption("--amount <usdc>", "Service price in USDC")
  .option("--chain <id>", "ACP chain ID", "8453")
  .description("Set a provider quote for an ACP job")
  .action((options: { job: string; amount: string; chain: string }) => {
    quoteJob(options.job, chainId(options.chain), options.amount);
    console.log(pc.green(`\nQuoted ${options.amount} USDC for ACP job ${options.job}.\n`));
  });

program
  .command("deliver")
  .requiredOption("--job <id>", "ACP job ID")
  .requiredOption("--pr <url>", "Delivered GitHub pull request")
  .option("--chain <id>", "ACP chain ID", "8453")
  .description("Submit a pull request as an ACP provider")
  .action((options: { job: string; pr: string; chain: string }) => {
    const pullRequest = getPullRequest(options.pr);
    const delivery = createPullRequestDelivery(pullRequest.url, pullRequest.headSha);
    submitJob(options.job, chainId(options.chain), delivery);
    console.log(pc.green(`\nDelivered PR #${pullRequest.number} at ${pullRequest.headSha.slice(0, 12)}.\n`));
  });

program
  .command("verify")
  .argument("<issue>", "GitHub issue number")
  .description("Verify the delivered pull request and CI")
  .action((value: string) => {
    const number = issueNumber(value);
    const result = verifyJob(getJob(number));

    console.log(pc.bold(`\nCULT OS // VERIFY PR #${result.pullRequest}\n`));
    for (const check of result.checks) {
      const marker = ["pass", "skipping"].includes(check.bucket) ? pc.green("●") : pc.red("●");
      console.log(`${marker} ${check.name} ${pc.dim(check.state)}`);
    }

    if (result.passed) {
      console.log(pc.green(`\nVerified at ${result.headSha.slice(0, 12)}.\n`));
      updateJob(number, { status: "verified" });
      return;
    }

    console.log(pc.red("\nVerification failed:"));
    for (const failure of result.failures) {
      console.log(`- ${failure}`);
    }
    console.log();
    process.exitCode = 1;
  });

program
  .command("settle")
  .argument("<issue>", "GitHub issue number")
  .option("--approve", "Approve the delivery")
  .option("--reject", "Reject the delivery")
  .option("--reason <text>", "Settlement reason", "Work reviewed through CultOS")
  .description("Complete or reject an ACP job and publish its receipt")
  .action((value: string, options: { approve?: boolean; reject?: boolean; reason: string }) => {
    const number = issueNumber(value);
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
        const verification = verifyJob(job, "MERGED");
        if (!verification.passed) {
          throw new Error(`Settlement verification failed:\n- ${verification.failures.join("\n- ")}`);
        }
        completeJob(job.jobId, job.chainId, options.reason);
      } else {
        rejectJob(job.jobId, job.chainId, options.reason);
      }
      updateJob(number, { status: outcome, settledByCultos: outcome });
    }

    commentOnIssue(number, settlementReceipt(job, outcome));
    updateJob(number, { receiptPostedAt: new Date().toISOString() });
    console.log(pc.green(`\nACP job ${job.jobId} ${outcome}. Receipt posted to issue #${number}.\n`));
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
      console.log(`#${String(job.issueNumber).padEnd(6)} ${job.status.padEnd(12)} ACP ${job.jobId}`);
    }
    console.log();
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(pc.red(`\n${message}\n`));
  process.exitCode = 1;
});
