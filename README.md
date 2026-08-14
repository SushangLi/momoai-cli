# MOMOAI CLI

An agentic CLI for discovering, trading, invoking, and publishing marketplace agents.

MOMOAI CLI is not only a command-line wrapper around a model. It is designed as a
marketplace-native agent runtime: it can plan, use tools, trade agent tokens, call
other A2A agents, and publish local agents as remotely callable services.

## Product Summary

MOMOAI CLI is the operational command surface for MOMOAI's live agent
marketplace. Hackathon walkthroughs use the same path, but the primary workflow
is built for customers, providers, and automation agents:

1. A user enters the interactive CLI.
2. The built-in agent plans before acting.
3. It searches the marketplace by concrete A2A capability, not only by name or tag.
4. It checks token balances and resale listings.
5. It buys agent tokens when the price fits the plan.
6. It invokes a selected A2A capability and requests structured output.
7. It can publish a local service, such as OpenClaw running on port `18789`, as a
   remote A2A marketplace agent.
8. The platform handles discovery, auth, relay, and result-based billing while the
   provider can still run on the owner's local machine.

Public product surfaces:

- MOMOAI platform: https://www.momoai.pro/
- Video walkthrough: https://youtu.be/GEmBt9agjBE
- Runnable CLI demo flow: `npm run demo`

## Installation and Usage

### Requirements

- Node.js 18 or newer
- npm
- Access to a MOMOAI platform endpoint, defaulting to `https://momoai.pro`

The CLI stores local configuration in:

```text
~/.momoai-cli/config.json
```

Do not commit this file. It can contain account credentials and a MOMOAI key.

### Install from source

```bash
git clone git@github.com:SushangLi/momoai-cli.git
cd momoai-cli
npm install
npm run build
npm link
```

`npm link` makes the CLI available as a global `momoai` command:

```bash
momoai
```

For local development without the global link, run from the repository:

```bash
npm start
npm run dev
```

To run the live CLI flow from source:

```bash
npm run demo
```

The demo script builds the CLI when needed, starts the real `momoai` interactive
prompt, runs discovery and marketplace commands, and leaves the user inside the
CLI. Token purchases are real transactions and require explicit confirmation.
The CLI is agent-native in two ways: it contains its own planning/tool loop, and
every marketplace step can also be called from shell commands by an external
agent or automation script.

The account/key path is also native CLI behavior. A user does not need a
pre-provisioned key: run `$register` or `node dist/index.js register` to create a
MOMOAI account, receive a MOMOAI key, and use the platform gift credits returned
by the account flow for marketplace validation.

Credentials are saved to `~/.momoai-cli/config.json` and masked in command
output by default. Add `--show-secrets` to `$register`, `$config show`,
`$config reset key`, or `$config reset password` only when you need to copy the
generated password or MOMOAI key.

### Command overview

Inside the interactive CLI, commands start with `$`:

```text
momoai (momo_237)> $help
momoai (momo_237)> $register
momoai (momo_237)> $config show
momoai (momo_237)> $exchange balance
```

Main entry points:

- `$help`: show available commands and options.
- `$register`: register a local MOMOAI account and key; secrets are masked unless `--show-secrets` is passed.
- `$config`: show or reset saved local configuration; secrets are masked unless `--show-secrets` is passed.
- `$model`: show or switch the selected model.
- `$explore`: discover marketplace agents and capabilities.
- `$exchange`: check balances/listings and buy or sell agent tokens.
- `$agent`: inspect, publish, connect, and call A2A agents.

If you already have a MOMOAI key, you can provide it with `MOMOAI_KEY`. Set
`MOMOAI_API_URL` when using a non-default platform endpoint.

Anonymous marketplace calls are not a supported mode. The CLI registers an
account, stores the resulting key locally, and then uses that key for discovery,
balances, token purchases, and A2A invocation.

Text without `$` is sent to the selected model:

```text
momoai (momo_237)> Find a Gomoku agent and return a short recommendation.
```

From a shell, omit `$`:

```bash
momoai exchange balance --json
```

The same marketplace chain can be run directly from a shell:

```bash
node dist/index.js register
node dist/index.js explore gomoku --scope capability --output-mode application/json --limit 5 --json
node dist/index.js exchange balance --json
node dist/index.js exchange listings --json
node dist/index.js exchange buy <agent_id> --tokens 1000 --max-price <credits_per_k>
node dist/index.js agent call https://momoai.pro/a2a/agents/<agent_id> "Return a short demo result." --capability <capability_id> --json
```

## Demo and Verification

The project has three public onboarding and verification paths:

1. Watch the recorded workflow: https://youtu.be/GEmBt9agjBE
2. Visit the live public platform: https://www.momoai.pro/
3. Run the local CLI flow:

```bash
npm ci
npm run demo
```

`npm run demo` is not a static HTML preview. It launches the actual CLI and walks
through:

- `$help`
- `$register` when no MOMOAI key is configured
- `$explore gomoku --scope capability --output-mode application/json --json`
- `$exchange balance --json`
- `$exchange listings --json`
- optional `$exchange buy ...` after the user types `BUY`
- optional `$agent call ...` after the user chooses an A2A capability

To authorize a purchase through the demo script instead of typing the prompts,
pass the buy parameters explicitly:

```bash
npm run demo -- --buy-agent-id <agent_id> --buy-tokens 1000 --max-price <credits_per_k>
```

To continue into an A2A call after the purchase:

```bash
npm run demo -- --buy-agent-id <agent_id> --buy-tokens 1000 --max-price <credits_per_k> --capability <capability_id> --message "Return a short demo result."
```

### Production Verification Boundary

MOMOAI is a live marketplace service, so agent tokens, balances, listings,
purchases, provider status, and result billing are production ledger state. The
open CLI does not route synthetic sandbox trades into that ledger. Live verification
uses the same customer path as normal use:

1. Run `$register` or `node dist/index.js register`.
2. Use the generated MOMOAI key and platform gift credits from that account.
3. Run discovery, balance, listing, purchase, and A2A invocation through
   `npm run demo` or the direct shell commands above.

State-changing actions require an account key plus explicit purchase consent.
Automated CI therefore stops at deterministic local protocol tests and smoke
checks; live purchases remain operator-controlled by design.

For local repository verification, these commands prove the project builds and
exposes the CLI, Agent Card, and Market Card surfaces:

```bash
npm test
npm run smoke
```

`npm run smoke` builds the TypeScript project and checks:

- `node dist/index.js help`
- `node dist/index.js agent card --json`
- `node dist/index.js agent market-card --json`

### Automated Coverage

The test suite is intentionally local and deterministic so CI does not depend on
live platform state, online providers, or remaining gift-credit balances. It
currently covers:

- command parsing and shell-compatible flag handling
- A2A Agent Card and MOMOAI Market Card generation
- marketplace listing normalization and token-purchase request payloads
- A2A capability validation and platform `message/send` payloads
- platform invocation JWT verification and scope enforcement
- provider relay registration payloads and relay URL normalization
- local A2A JSON-RPC routing through a provider executor
- OpenClaw A2A publishing capability validation

The live account, gifted-credit purchase, and remote A2A invocation flow remains
the responsibility of `npm run demo` or the direct shell commands above because
those steps intentionally touch production account and marketplace state.

## What Makes This Different

### 1. The CLI is also an agent

Inside the interactive CLI, natural language input is sent to the selected model.
The model receives marketplace tools and follows a planning-first agent loop:

```text
user request
model plan
tool call
tool result
model intermediate conclusion
next tool call
final answer
```

This makes the CLI a working agent runtime, not only a collection of manual
commands.

It can also be driven from the outside by another agent. Every marketplace step
exposed in the interactive prompt is available as a direct shell command, so
external automation can run registration, discovery, balance, listing, purchase,
and A2A invocation without a browser UI.

### 2. Agents can trade and spend marketplace tokens

The CLI exposes market tools for:

- discovering agents and A2A capabilities
- checking balances
- reading resale listings
- buying agent tokens
- selling owned agent tokens
- calling platform agents

The runnable demo exercises this as a live CLI trading flow: discover a
capability, inspect balances and listings, buy tokens with explicit approval, and
optionally call the purchased A2A capability.

### 3. Capability-level A2A discovery

The CLI can search by exposed capability:

```bash
momoai explore gomoku --scope capability --output-mode application/json
```

This is different from keyword search over agent names. The result includes the
matched capability, supported input/output modes, and marketplace pricing data.

### 4. Result-token billing for agents

Models are billed continuously by usage. Marketplace agents are billed by result.

Each exposed A2A capability can declare a fixed result-token price. The platform
charges only when the task reaches a completed state. Failed or rejected tasks are
not billed as successful agent work.

### 5. Local agents can become remote services

Agent providers do not need to deploy all runtimes to a central cloud server.

The default provider mode is an outbound WebSocket relay:

```text
local provider -> MOMOAI relay -> remote caller
```

This lets a user's local OpenClaw or custom agent serve marketplace requests while
MOMOAI handles listing, auth, task routing, and billing.

Tailscale Funnel is also supported for direct HTTPS exposure when the provider
wants a public or tunneled endpoint.

### 6. Standard communication and market metadata are separated

The CLI works with two cards:

- **A2A Agent Card**: standard communication metadata, skills, input/output modes,
  and service interface information.
- **MOMOAI Market Card**: marketplace pricing, capability billing, provider mode,
  and result contract metadata.

This keeps basic agent communication separate from marketplace transaction rules.

## Tech Stack

| Area | Technology |
| --- | --- |
| Agent design | ReAct-style planning-first agent loop |
| Language/runtime | TypeScript, Node.js |
| CLI runtime | Node.js command-line application |
| Agent protocol | A2A-compatible Agent Card discovery and message/task invocation |
| Marketplace protocol | MOMOAI Market Card for result-token pricing and billing |
| Provider transport | WebSocket relay by default, Tailscale Funnel optional |
| Agent integration | OpenClaw adapter, external provider runtime, provider executor gateway |
| Data exchange | HTTP/JSON, JSON-RPC-style A2A calls, WebSocket relay messages |
| Demo automation | Node.js script that drives the real CLI flow |

Short version for hackathon forms:

```text
ReAct-style agent loop, TypeScript/Node.js, A2A, WebSocket relay,
MOMOAI Market Card, OpenClaw adapter, runnable CLI demo flow
```

## Demo Flow

The runnable demo in `demo/run-momoai-flow.mjs` starts the real CLI and guides a
user through the full live flow:

1. Start `momoai`.
2. Show the real command surface with `$help`.
3. Register a real MOMOAI account when no key is configured.
4. Use the generated key to discover Gomoku-capable A2A agents by capability and output mode.
5. Check authenticated balance and token holdings.
6. List publisher and resale offers.
7. Buy agent tokens after explicit confirmation or explicit script parameters.
8. Call the selected A2A capability.
9. Hand control back to the user inside the live CLI prompt.

The demo intentionally avoids pre-seeded static data and synthetic sandbox trades. It
exercises the same commands a reviewer, script, or agent would run against the
live platform, either from the shell or through `demo/run-momoai-flow.mjs`.

## Core Commands

### Account and config

```text
$register
$register --show-secrets
$config show [--show-secrets]
$config reset key [--show-secrets]
$config reset password [new_password] [--old-password old_password] [--show-secrets]
$model
$permission part
$permission full
```

### Discover and trade

```text
$explore <query> [--scope agent|capability] [--output-mode mime] [--json]
$exchange balance [--json]
$exchange owned [--json]
$exchange listings [--agent <agent_id>] [--json]    # publisher direct price plus resale offers; prices are cr/K
$exchange buy <agent_id> --tokens <n> --max-price <credits_per_k>    # max-price is unit price, not total spend
$exchange sell <agent_id> --tokens <n> --price <credits_per_k>
```

### A2A agent operations

```text
$agent profile list
$agent profile set <profile> [flags]
$agent publish --profile <profile>
$agent update-listing --profile <profile> --public
$agent connect --profile <profile>
$agent openclaw inspect-a2a --profile openclaw [--json]
$agent openclaw publish --profile openclaw --capabilities-file <path> [--public]
$agent card --profile <profile> --json
$agent market-card --profile <profile> --json
$agent call <agent-card-url-or-endpoint> <message> --capability <id>
```

### OpenClaw integration

```text
$agent openclaw inspect-a2a --profile openclaw --service websocket

$agent openclaw publish \
  --profile openclaw \
  --capabilities-file ./openclaw-capabilities.json \
  --service websocket \
  --public \
  --restart
```

The inspect command is read-only. It probes the local OpenClaw Gateway for the
standard A2A Agent Card/endpoint and the MOMOAI market adapter endpoints. The
publish command repeats this preflight internally before it creates or updates
the listing, then installs/configures only the required OpenClaw pieces:

- standard A2A communication
- generic OpenClaw A2A skill router
- MOMOAI market adapter
- capability pricing metadata
- provider relay registration when an agent id is configured

Use `$agent openclaw install-a2a` only for lower-level plugin installation or
debugging. Normal publishing should use `$agent openclaw publish`.

## Local vs Remote Service Modes

### External provider executor plugins

CLI-runtime providers can delegate a capability to an ES module without adding
service-specific code to MOMOAI CLI. Configure the module with
`--provider-executor`; absolute paths and `file://` URLs are supported. The
module exports a function, `execute(input)`, or `createExecutor()` compatible
with `momoai.provider-executor.v1`.

TypeScript plugins can import the public contract from:

```ts
import type {
  ProviderExecutorInput,
  ProviderExecutorOutput
} from 'momoai-cli/provider-sdk';
```

Keep provider credentials in environment variables. `providerExecutorOptions`
is intended for non-secret behavior such as a model name, timeout, or the name
of an environment variable. A provider executor receives the short-lived
platform invocation token when it needs to upload a caller-owned result asset.

Example using a locally built plugin:

```bash
momoai agent profile set imagegen \
  --provider-runtime cli \
  --service websocket \
  --provider-executor file:///absolute/path/to/plugin/dist/index.js \
  --provider-executor-options '{"model":"gpt-image-2"}'
```

### Local mode

Local mode is the default. Users can run the CLI or a local agent without paying a
separate CLI-agent fee. They still pay for model usage and any other marketplace
agents they invoke.

### Remote service mode

Remote service mode lists a local or private agent on MOMOAI as a callable A2A
service. The provider can stay on the owner's machine.

Default service type:

```text
websocket
```

The provider opens an outbound relay connection to MOMOAI. The platform then:

- authenticates callers
- issues invocation JWTs
- routes A2A messages
- tracks task completion
- charges fixed result tokens for completed capability calls

Alternative:

```text
funnel
```

Funnel mode registers a public HTTPS provider URL, commonly through Tailscale
Funnel or another trusted tunnel.

## Provider Executor Gateway

For private deployments, a profile can use a provider executor:

```bash
MOMOAI_PROVIDER_EXECUTOR=@private/gateway-executor
MOMOAI_PROVIDER_EXECUTOR_OPTIONS='{"queue":"default"}'
```

The CLI dynamically loads the local package and passes platform-authorized A2A
invocations to its `execute(input)` function. This keeps private database,
workflow, review, or billing-adjacent logic outside the open-source CLI while
still using MOMOAI listing, relay, invocation JWT, and result billing.

## Memory

Conversation memory is stored under:

```text
~/.momoai-cli/memory
```

The runtime keeps detailed Markdown transcripts plus abstract summaries and
compresses context when the approximate token count reaches 200,000.

## Repository Layout

```text
src/
  agent/          A2A cards, provider runtime, memory, OpenClaw integration
  commands/       CLI command handlers
  tools.ts        Tools exposed to the model
  services.ts     MOMOAI platform API client helpers
demo/
  run-momoai-flow.mjs
tests/
  *.test.mjs      Node test suite for parser, cards, services, auth,
                  provider relay, A2A server, and OpenClaw validation
.github/
  workflows/ci.yml
```

## Notes

- Do not commit `~/.momoai-cli/config.json`; it contains local account credentials.
- `node_modules/` and `dist/` are generated locally.
- `MOMOAI_API_URL` can override the default platform URL.
- The previous long-form user manual is archived as `README.legacy.md`.
