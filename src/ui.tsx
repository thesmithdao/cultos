import { Box, Text } from "ink";
import React from "react";

const timeline = [
  ["21:04", "JOB CREATED"],
  ["21:05", "BUDGET SET"],
  ["21:06", "ESCROW FUNDED"],
  ["21:14", "PR #47 DELIVERED"],
  ["21:16", "CI PASSED"],
  ["21:18", "MERGED // PAYMENT RELEASED"]
] as const;

function panelWidth(): number {
  const environmentWidth = Number.parseInt(process.env.COLUMNS ?? "", 10);
  const width = process.stdout.columns ?? (Number.isFinite(environmentWidth) ? environmentWidth : 62);
  return Math.max(28, Math.min(62, width));
}

function Panel({ title, children }: React.PropsWithChildren<{ title: string }>): React.JSX.Element {
  return (
    <Box borderStyle="single" borderColor="magenta" flexDirection="column" paddingX={1} width={panelWidth()}>
      <Text bold color="magenta" wrap="truncate-end">{title}</Text>
      <Text> </Text>
      {children}
    </Box>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  const compact = panelWidth() < 44;
  return (
    <Box flexDirection={compact ? "column" : "row"}>
      <Box width={compact ? undefined : 12}><Text dimColor>{label}</Text></Box>
      <Text bold wrap="truncate-end">{value}</Text>
    </Box>
  );
}

function Signal({ ok, children }: React.PropsWithChildren<{ ok: boolean }>): React.JSX.Element {
  return (
    <Text wrap="truncate-end">
      <Text color={ok ? "green" : "yellow"}>{ok ? "●" : "○"}</Text>{" "}{children}
    </Text>
  );
}

export function JobRoom(): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Panel title="CULT OS // JOB 813">
        <Field label="ISSUE" value="#42 Fix wallet balance parsing" />
        <Field label="PROVIDER" value="0x7A3F...91C2" />
        <Field label="ESCROW" value="2.00 USDC" />
        <Field label="NETWORK" value="BASE" />
        <Text> </Text>
        <Text bold color="magenta">TRANSMISSION</Text>
        <Text> </Text>
        {timeline.map(([time, event]) => (
          <Box key={event}>
            <Box width={8}><Text dimColor>{time}</Text></Box>
            <Text color="green">● </Text>
            <Text wrap="truncate-end">{event}</Text>
          </Box>
        ))}
        <Text> </Text>
      </Panel>
      <Text> </Text>
      <Text>GitHub has issues. Virtuals has agents.</Text>
      <Text bold color="magenta">CultOS makes them work for each other.</Text>
    </Box>
  );
}

function SystemCheck(): React.JSX.Element {
  return (
    <Panel title="CULT OS // SYSTEM CHECK">
      <Signal ok>NODE 24 // READY</Signal>
      <Signal ok>GITHUB // AUTHENTICATED</Signal>
      <Signal ok>ACP // CULTOS CONNECTED</Signal>
      <Signal ok>SIGNER // ACP ONLY</Signal>
      <Text> </Text>
      <Text bold color="green">SYSTEM READY</Text>
    </Panel>
  );
}

function ContractScreen(): React.JSX.Element {
  return (
    <Panel title="CULT OS // ISSUE #42">
      <Field label="REPOSITORY" value="thecultos/example" />
      <Field label="TARGET" value="main" />
      <Text> </Text>
      <Signal ok>Parse balances using token decimals</Signal>
      <Signal ok>Add regression coverage</Signal>
      <Text> </Text>
      <Text bold color="green">CONTRACT READY</Text>
    </Panel>
  );
}

function VerifyScreen(): React.JSX.Element {
  return (
    <Panel title="CULT OS // VERIFY PR #47">
      <Signal ok>REPOSITORY // MATCH</Signal>
      <Signal ok>BASE REF // MAIN</Signal>
      <Signal ok>COMMIT // 7F3A91C2D841</Signal>
      <Signal ok>CI / TEST // PASSED</Signal>
      <Signal ok>CI / BUILD // PASSED</Signal>
      <Text> </Text>
      <Text bold color="green">DELIVERY VERIFIED</Text>
    </Panel>
  );
}

function ReceiptScreen(): React.JSX.Element {
  return (
    <Panel title="CULT OS // SETTLEMENT">
      <Field label="ACP JOB" value="813" />
      <Field label="PROVIDER" value="0x7A3F...91C2" />
      <Field label="DELIVERY" value="PR #47" />
      <Field label="PAYMENT" value="2.00 USDC" />
      <Text> </Text>
      <Text bold color="green">● MERGED // PAYMENT RELEASED</Text>
    </Panel>
  );
}

export function Gallery(): React.JSX.Element {
  return (
    <Box flexDirection="column" gap={1}>
      <SystemCheck />
      <ContractScreen />
      <JobRoom />
      <VerifyScreen />
      <ReceiptScreen />
    </Box>
  );
}
