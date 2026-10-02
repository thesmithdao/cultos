# Changelog

## 0.6.0

Cult OS now builds for the machine economy. `cult start` asks what you want to do and sets up only that path. `cult build x402` writes a paid API from Coinbase's official x402 Express example for Base, Solana or both, with pinned versions, Bazaar metadata and testnet first. `cult build machine` writes a Mac or Linux seller on x402-mqtt. `cult check` is a free readiness gate for any x402 endpoint, including the Solana payout account trap, and `cult handshake` makes one capped first sale through Coinbase's awal wallet or, for machines, x402-mqtt with the buyer's own key. Cult OS still holds no keys and adds no dependencies.

`cult watch` no longer passes a chain flag the ACP CLI rejects, so watching a live job works again. `cult start` installs the pinned ACP CLI 1.0.39, and `cult doctor` reports the ACP CLI version and awal.

## 0.5.1

Cult OS now treats remote terminal text, persisted job data, repository references, and subprocess arguments as explicit trust boundaries. The CLI rejects malformed delivery and state records, prevents terminal control-sequence injection, hardens GitHub and GitLawb argument handling, requires secure GitLawb transport outside loopback development, and remains responsive under sustained terminal output. Release publication now runs typecheck and tests before packing.

## 0.5.0

Cult OS returns to a lean ACP core. Sibyl Memory commands and the MCP SDK dependency are not included in the 0.5.x track. Users who rely on repository memory remain on the security-maintained 0.4.x track.

## 0.4.1

Sibyl Memory is installed and executed only from the user-managed `~/.cultos/sibyl` environment. Cult OS no longer discovers or executes a Sibyl binary from the current repository or the implicit command path. Existing memory data is unchanged; users upgrading from 0.4.0 should run `cult memory setup` once to create the trusted installation.

## 0.4.0

Cult OS now supports optional repository memory through Sibyl. Run `cult memory setup`, use `cult inspect <issue> --memory` to recall prior outcomes, and `cult verify <issue> --memory` to record verification results for later sessions. Memory does not authorize payments or settlement. Setup requires Python 3.10 or newer on macOS, Linux or WSL2; ordinary CLI commands do not require Python.

The terminal uses a monochrome layout with a streamlined command prompt and memory instructions. ACP agents can be selected by exact name or ID with `cult agent use`. Quote and delivery commands accept local issue numbers while retaining the remote `--job` option.

Job watching recovers existing quotes and deliveries from ACP history. Settlement receipts target the job's recorded repository. The terminal preserves the development loader when launching commands, and builds preserve the CLI executable permission.
