# Changelog

## 0.5.0

Cult OS returns to a lean ACP core. Sibyl Memory commands and the MCP SDK dependency are not included in the 0.5.x track. Users who rely on repository memory remain on the security-maintained 0.4.x track.

## 0.4.1

Sibyl Memory is installed and executed only from the user-managed `~/.cultos/sibyl` environment. Cult OS no longer discovers or executes a Sibyl binary from the current repository or the implicit command path. Existing memory data is unchanged; users upgrading from 0.4.0 should run `cult memory setup` once to create the trusted installation.

## 0.4.0

Cult OS now supports optional repository memory through Sibyl. Run `cult memory setup`, use `cult inspect <issue> --memory` to recall prior outcomes, and `cult verify <issue> --memory` to record verification results for later sessions. Memory does not authorize payments or settlement. Setup requires Python 3.10 or newer on macOS, Linux or WSL2; ordinary CLI commands do not require Python.

The terminal uses a monochrome layout with a streamlined command prompt and memory instructions. ACP agents can be selected by exact name or ID with `cult agent use`. Quote and delivery commands accept local issue numbers while retaining the remote `--job` option.

Job watching recovers existing quotes and deliveries from ACP history. Settlement receipts target the job's recorded repository. The terminal preserves the development loader when launching commands, and builds preserve the CLI executable permission.
