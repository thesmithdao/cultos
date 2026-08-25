import { z } from "zod";

export const workContractKind = "cultos.github.issue.v1" as const;
export const pullRequestDeliveryKind = "cultos.github.pull-request.v1" as const;
export const gitlawbWorkContractKind = "cultos.gitlawb.issue.v1" as const;
export const gitlawbPullRequestDeliveryKind = "cultos.gitlawb.pull-request.v1" as const;

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

const pullRequestDeliverySchema = z.object({
  kind: z.union([z.literal(pullRequestDeliveryKind), z.literal(gitlawbPullRequestDeliveryKind)]),
  url: z.string().min(1),
  headSha: z.string().min(7)
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
