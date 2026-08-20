import { z } from "zod";

export const workContractKind = "cultos.github.issue.v1" as const;
export const pullRequestDeliveryKind = "cultos.github.pull-request.v1" as const;

export interface IssueWorkContract {
  kind: typeof workContractKind;
  repository: string;
  issue: string;
  baseRef: string;
  title: string;
  acceptanceCriteria: string[];
  delivery: {
    type: "github.pull_request";
  };
}

export interface PullRequestDelivery {
  kind: typeof pullRequestDeliveryKind;
  url: string;
  headSha: string;
}

const pullRequestDeliverySchema = z.object({
  kind: z.literal(pullRequestDeliveryKind),
  url: z.url(),
  headSha: z.string().min(7)
});

interface ContractInput {
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
  return {
    kind: workContractKind,
    repository: input.repositoryUrl,
    issue: input.issueUrl,
    baseRef: input.baseRef,
    title: input.title,
    acceptanceCriteria: extractAcceptanceCriteria(input.body),
    delivery: {
      type: "github.pull_request"
    }
  };
}

export function createPullRequestDelivery(url: string, headSha: string): PullRequestDelivery {
  return {
    kind: pullRequestDeliveryKind,
    url,
    headSha
  };
}

export function parsePullRequestDelivery(value: unknown): PullRequestDelivery {
  const input = typeof value === "string" ? JSON.parse(value) : value;
  return pullRequestDeliverySchema.parse(input);
}
