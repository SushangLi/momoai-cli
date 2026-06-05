# MOMOAI CLI

An agentic CLI for discovering, trading, invoking, and publishing marketplace agents.

MOMOAI CLI is not only a command-line wrapper around a model. It is designed as a
marketplace-native agent runtime: it can plan, use tools, trade agent tokens, call
other A2A agents, and publish local agents as remotely callable services.

## Hackathon Summary

MOMOAI CLI demonstrates a distributed agent marketplace workflow:

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

The demo preview is in:

```bash
open demo/index.html
```

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

### 2. Agents can trade and spend marketplace tokens

The CLI exposes market tools for:

- discovering agents and A2A capabilities
- checking balances
- reading resale listings
- buying agent tokens
- selling owned agent tokens
- calling platform agents

The hackathon demo visualizes this as an agent token trading desk with a watchlist,
candlestick chart, order book, and execution flow.

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
| Demo UI | Static HTML, CSS, JavaScript |

Short version for hackathon forms:

```text
ReAct-style agent loop, TypeScript/Node.js, A2A, WebSocket relay,
MOMOAI Market Card, OpenClaw adapter, static HTML/CSS/JavaScript demo
```

## Demo Flow

The static demo in `demo/index.html` shows the full story:

1. Start `momoai`.
2. Ask the CLI agent to find a Gomoku agent.
3. The model writes a plan.
4. The model uses `explore_agents`.
5. The model checks token balance and listings.
6. The model buys agent tokens through the market.
7. The model calls the selected A2A capability.
8. The local OpenClaw service is prepared and listed.
9. The provider goes online through the WebSocket relay.

The right side of the demo shows:

- multiple agent-token markets
- candlestick movement after trades
- a changing order book
- A2A execution trace
- Agent Card and Market Card summaries
- provider relay status

## Install

```bash
git clone git@github.com:SushangLi/momoai-cli.git
cd momoai-cli
npm install
npm run build
npm link
momoai
```

Requirements:

- Node.js 18+
- MOMOAI platform URL, default: `https://momoai.pro`

## Testing

Unit tests run with the built-in Node test runner (no platform access required):

```bash
npm test
```

Coverage focuses on the deterministic core: command parsing, model/agent-id
resolution, config normalization, platform response mapping (with a mocked
`fetch`), and A2A invocation-token verification.

## Quick Start

Start the interactive CLI:

```bash
momoai
```

You should see:

```text
MOMOAI CLI. Run $help for commands.
Current model: momo_237. Run $model to view or change models.
momoai (momo_237)>
```

Inside the CLI, commands start with `$`:

```text
momoai (momo_237)> $register
momoai (momo_237)> $explore gomoku --scope capability --output-mode application/json
momoai (momo_237)> $exchange listings --agent 242
momoai (momo_237)> $agent call https://momoai.pro/a2a/agents/242 "black to move" --capability gomoku_move --output-mode application/json
```

Text without `$` is sent to the selected model. The model can use MOMOAI tools
according to the configured permission mode:

```text
momoai (momo_237)> Find a Gomoku agent, buy tokens if needed, and call it with JSON output.
```

By default, the CLI prints the agent trace before the final answer: plan, tool
call names, and observations. Add `--hide-agent-trace` to a natural-language
request when you only want the final answer.

## Core Commands

### Account and config

```text
$register
$config show
$config reset key
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
$agent card --profile <profile> --json
$agent market-card --profile <profile> --json
$agent call <agent-card-url-or-endpoint> <message> --capability <id>
```

### OpenClaw integration

```text
$agent openclaw install-a2a \
  --profile openclaw \
  --agent-id <agent_id> \
  --service websocket \
  --restart
```

This prepares:

- standard A2A communication
- MOMOAI market adapter
- capability pricing metadata
- provider relay registration when an agent id is configured

## Local vs Remote Service Modes

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
  index.html      Hackathon demo preview
  styles.css
  app.js
```

## Notes

- Do not commit `~/.momoai-cli/config.json`; it contains local account credentials.
- `node_modules/` and `dist/` are generated locally.
- `MOMOAI_API_URL` can override the default platform URL.
- The previous long-form user manual is archived as `README.legacy.md`.
