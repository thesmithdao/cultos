import { z } from "zod";

export const workContractKind = "cultos.github.issue.v1" as const;
export const pullRequestDeliveryKind = "cultos.github.pull-request.v1" as const;
export const gitlawbWorkContractKind = "cultos.gitlawb.issue.v1" as const;
export const gitlawbPullRequestDeliveryKind = "cultos.gitlawb.pull-request.v1" as const;
export const reviewContractKind = "cultos.github.review.v1" as const;
export const aeonReviewSchemaKind = "cultos.aeon.review.v1" as const;

export type RepositoryPlatform = "github" | "gitlawb";

export interface IssueWorkContract {
  kind: typeof workContractKind | typeof gitlawbWorkContractKind;
  repository: string;
  issue: string;
  baseRef: string;
  title: string;
  acceptanceCriteria: string[];
  delivery: {
    type: "github.pull_request" | "gitlawb.pull_request";
  };
}

export interface PullRequestDelivery {
  kind: typeof pullRequestDeliveryKind | typeof gitlawbPullRequestDeliveryKind;
  url: string;
  headSha: string;
}

export interface ReviewWorkContract {
  kind: typeof reviewContractKind;
  repository: string;
  issue: string;
  pullRequest: string;
  headSha: string;
  delivery: {
    type: "aeon.review";
  };
}

export interface AeonReviewDelivery {
  schema: typeof aeonReviewSchemaKind;
  status: "complete" | "invalid" | "unsupported";
  repository: string;
  issue: number;
  pull_request: number;
  head_sha: string;
  verdict: "approve-ready" | "discussion-needed" | "blocked";
  summary: string;
  findings: Array<{
    severity: "critical" | "high" | "medium";
    path: string;
    line: number | null;
    title: string;
    consequence: string;
  }>;
  reviewed_files: string[];
  limitations: string[];
  run: {
    id: number;
    url: string;
    model: string;
    gateway: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export type CultWorkContract = IssueWorkContract | ReviewWorkContract;
export type CultDelivery = PullRequestDelivery | AeonReviewDelivery;

const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const gitlawbPullRequestUrl =
  /^gitlawb:\/\/(?:did:key:[A-Za-z0-9]+|[A-Za-z0-9._-]+)\/[A-Za-z0-9._-]+\/pulls?\/[1-9]\d*$/;

/**
 * Remote text the CLI prints on a single line.
 *
 * Control characters are rejected at the schema boundary so a provider cannot
 * smuggle escape sequences into `cult verify` output or a settlement receipt.
 */
export function plainText(max: number): z.ZodType<string> {
  return z.string().min(1).max(max).refine((value) => !controlCharacters.test(value), {
    message: "must not contain control characters"
  });
}

/** An https URL, rejecting every other scheme. */
export const httpsUrl = z.string().min(1).max(2048).refine((value) => {
  if (controlCharacters.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, { message: "must be an https URL" });

/**
 * A delivered pull-request location.
 *
 * This string is handed to `gh pr view` as an argument, printed to the
 * terminal and interpolated into the settlement receipt, so it is constrained
 * to the two shapes CultOS actually produces. `gitlawb://` is matched by
 * pattern rather than parsed: WHATWG URL rejects a `did:key:` authority
 * because the colons read as a port.
 */
export const deliveryUrl = z.string().min(1).max(2048).refine((value) => {
  if (controlCharacters.test(value)) return false;
  if (value.startsWith("gitlawb://")) return gitlawbPullRequestUrl.test(value);
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, { message: "must be an https URL or a gitlawb:// pull request" });

const pullRequestDeliverySchema = z.object({
  kind: z.union([z.literal(pullRequestDeliveryKind), z.literal(gitlawbPullRequestDeliveryKind)]),
  url: deliveryUrl,
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/)
});

const aeonReviewDeliverySchema = z.object({
  schema: z.literal(aeonReviewSchemaKind),
  status: z.enum(["complete", "invalid", "unsupported"]),
  repository: z.string().min(1),
  issue: z.number().int().positive(),
  pull_request: z.number().int().positive(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  verdict: z.enum(["approve-ready", "discussion-needed", "blocked"]),
  summary: plainText(240),
  findings: z.array(z.object({
    severity: z.enum(["critical", "high", "medium"]),
    path: plainText(512),
    line: z.number().int().positive().nullable(),
    title: plainText(240),
    consequence: plainText(500)
  })).max(5),
  reviewed_files: z.array(plainText(512)).max(500),
  limitations: z.array(plainText(500)).max(50),
  run: z.object({
    id: z.number().int().positive(),
    url: httpsUrl,
    model: plainText(120),
    gateway: plainText(120),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative()
    })
  })
});

interface ContractInput {
  platform?: RepositoryPlatform;
  repositoryUrl: string;
  issueUrl: string;
  baseRef: string;
  title: string;
  body: string;
}

const checkboxPattern = /^\s*[-*]\s+\[[ xX]\]\s+(.+)$/;
const bulletPattern = /^\s*[-*]\s+(.+)$/;
const headingPattern = /^#{1,6}\s+(.+)$/;

export function extractAcceptanceCriteria(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const checkboxes = lines
    .map((line) => line.match(checkboxPattern)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));

  if (checkboxes.length > 0) {
    return checkboxes;
  }

  const criteria: string[] = [];
  let inAcceptanceSection = false;

  for (const line of lines) {
    const heading = line.match(headingPattern)?.[1]?.trim().toLowerCase();

    if (heading) {
      if (inAcceptanceSection) {
        break;
      }

      inAcceptanceSection = /acceptance|definition of done/.test(heading);
      continue;
    }

    if (!inAcceptanceSection) {
      continue;
    }

    const criterion = line.match(bulletPattern)?.[1]?.trim();
    if (criterion) {
      criteria.push(criterion);
    }
  }

  return criteria;
}

export function createWorkContract(input: ContractInput): IssueWorkContract {
  const platform = input.platform ?? "github";
  return {
    kind: platform === "gitlawb" ? gitlawbWorkContractKind : workContractKind,
    repository: input.repositoryUrl,
    issue: input.issueUrl,
    baseRef: input.baseRef,
    title: input.title,
    acceptanceCriteria: extractAcceptanceCriteria(input.body),
    delivery: {
      type: platform === "gitlawb" ? "gitlawb.pull_request" : "github.pull_request"
    }
  };
}

export function createReviewContract(input: {
  repositoryUrl: string;
  issueUrl: string;
  pullRequestUrl: string;
  headSha: string;
}): ReviewWorkContract {
  return {
    kind: reviewContractKind,
    repository: input.repositoryUrl,
    issue: input.issueUrl,
    pullRequest: input.pullRequestUrl,
    headSha: input.headSha,
    delivery: { type: "aeon.review" }
  };
}

export function createPullRequestDelivery(
  url: string,
  headSha: string,
  platform: RepositoryPlatform = "github"
): PullRequestDelivery {
  return {
    kind: platform === "gitlawb" ? gitlawbPullRequestDeliveryKind : pullRequestDeliveryKind,
    url,
    headSha
  };
}

export function parsePullRequestDelivery(value: unknown): PullRequestDelivery {
  const input = typeof value === "string" ? JSON.parse(value) : value;
  return pullRequestDeliverySchema.parse(input);
}

export function parseAeonReviewDelivery(value: unknown): AeonReviewDelivery {
  const input = typeof value === "string" ? JSON.parse(value) : value;
  return aeonReviewDeliverySchema.parse(input);
}

export function isAeonReviewDelivery(value: CultDelivery): value is AeonReviewDelivery {
  return "schema" in value && value.schema === aeonReviewSchemaKind;
}
