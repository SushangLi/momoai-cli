# MOMOAI CLI

English | [中文](#中文)

MOMOAI CLI is an interactive command-line tool for MOMO AI. Commands inside the CLI start with `$`.
Text entered without `$` is sent to the selected model as an OpenAI-compatible chat request.

## Requirements

- Node.js 18+
- A reachable MOMO AI platform URL, default: `https://momoai.pro`

## Install From Source

```bash
git clone git@github.com:SushangLi/momoai-cli.git
cd momoai-cli
npm install
npm run build
npm link
momoai
```

## Quick Start

Start the CLI:

```bash
momoai
```

There are two equivalent ways to run commands:

```text
momoai> $exchange buy 237 --tokens 1000 --max-price 5
```

```bash
momoai exchange buy 237 --tokens 1000 --max-price 5
```

Use the leading `$` only inside the interactive CLI. Outside the CLI, start with `momoai` and omit `$`.

Register a generated CLI account:

```text
momoai> $register
```

The CLI generates a Gmail-style account, creates the MOMO AI user, gets the MOMO key, and stores account details locally.

Show stored config:

```text
momoai> $config show
```

Search agents:

```text
momoai> $explore coding
momoai> $explore image --limit 5
```

Get OpenAI-compatible run information:

```text
momoai> $run 237
```

Start this CLI as a local A2A agent:

```text
momoai> $agent serve --host 127.0.0.1 --port 41241
```

Local mode is the default. It does not charge a CLI agent fee and does not require a platform invocation JWT.
Expose `/.well-known/agent-card.json` and `/.well-known/momoai-a2a/market-card.json` from the same host when another local agent or the MOMOAI market needs to discover it.

Choose the chat model:

```text
momoai> $model
momoai> $model momo_237
```

Chat with the selected model:

```text
momoai> hello
```

Chat requests can let the model use MOMOAI tools for `$explore` and `$exchange`. Set the tool permission mode:

```text
momoai> $permission
momoai> $permission part
momoai> $permission full
```

Outside the interactive CLI, text that does not start with a CLI command is also sent as chat:

```bash
momoai hello
```

Exit:

```text
momoai> $quit
```

## Commands

### `$register`

Creates one local CLI account if no account is already stored.

Generated account format:

```text
momocli-yyyymmdd-xxxx@gmail.com
```

`xxxx` is 4 random characters from `0-9a-zA-Z`.

The stored config includes:

```json
{
  "model": "momo_237",
  "defaultModels": ["momo_237"],
  "account": {
    "email": "...",
    "username": "...",
    "password": "...",
    "momoKey": "momo_...",
    "createdAt": "..."
  }
}
```

If an account already exists, `$register` will not create another one.

### `$config show`

Prints all local config details, including the stored email, username, password, and MOMO key.

Config file location:

```text
~/.momoai-cli/config.json
```

### `$config reset key`

Resets the MOMO key for the stored account.

The CLI logs in with the stored email/password, requests a new MOMO key, prints it, and stores it under `account.momoKey`.

### `$explore <query> [--limit n] [--scope agent|capability] [--json]`

Searches MOMO AI agents.

Use `--scope capability` to search A2A capabilities instead of only agent names, tags, and intros. Capability search can also filter with `--input-mode`, `--output-mode`, `--max-fixed-tokens`, and `--online-only false`.

Examples:

```text
momoai> $explore coding
momoai> $explore video --limit 10
momoai> $explore gomoku --scope capability --output-mode application/json
momoai> $explore finance --json
```

### `$exchange balance [--json]`

Shows account credits and token balances for agents you have bought or used, including zero and negative balances.

```text
momoai> $exchange balance
```

### `$exchange owned [--json]`

Shows agents whose tokens you own and can resell.

```text
momoai> $exchange owned
```

### `$exchange listings [--agent <agent_id>] [--json]`

Shows resale listings.

```text
momoai> $exchange listings
momoai> $exchange listings --agent 237
```

### `$exchange buy <agent_id> --tokens <n> --max-price <credits_per_k>`

Buys tokens for an agent using eligible listings up to your max price.

```text
momoai> $exchange buy 237 --tokens 1000 --max-price 5
```

### `$exchange sell <agent_id> --tokens <n> --price <credits_per_k>`

Lists owned tokens for resale.

```text
momoai> $exchange sell 237 --tokens 1000 --price 6
```

### `$model [model]`

Shows or changes the model used for chat input. The default model is `momo_237`.

`defaultModels` are advertised models shown even before you buy tokens. Other models are shown from your `$exchange balance` list. Negative balances are still valid for selection.

Accepted examples:

```text
momoai> $model
momoai> $model 237
momoai> $model momo_237
```

After setting a model, any interactive line that does not start with `$` is sent to `/v1/chat/completions` with this OpenAI-compatible body:

```json
{
  "model": "momo_237",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

Outside the interactive CLI, `momoai hello` uses the same chat path. If the first word is a CLI command such as `exchange` or `config`, it runs that command instead.

If an advertised default model has no tokens yet, the chat request may ask you to buy tokens first.

### `$permission part|full`

Controls which model tool calls can run automatically during chat.

```text
momoai> $permission
momoai> $permission part
momoai> $permission full
```

Modes:

- `part`: explore, balance, owned, and listings tools run automatically. Buy and sell tools ask for confirmation.
- `full`: all explore and exchange tools run automatically, including buy and sell.

The model receives market tools backed by `$explore`, `$exchange`, and platform agent calls.

### `$run <agent_id> [--json]`

Shows an OpenAI-compatible curl example for running an agent. The `model` value is the numeric `agent_id`.

```text
momoai> $run 237
```

Example output:

```bash
curl -X POST "https://momoai.pro/api/agent-proxy" \
  -H "Authorization: Bearer momo_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"237","messages":[{"role":"user","content":"Hello"}]}'
```

### `$agent profile|publish|update-listing|serve|connect|card|market-card|call`

Runs this CLI as one or more A2A-capable agents, creates or updates MOMOAI remote-service listings, connects a profile as a provider, prints capability metadata, or calls another A2A agent.

```text
momoai> $agent serve --host 127.0.0.1 --port 41241
momoai> $agent profile set trader --name "Trading CLI" --agent-id 237 --capabilities-file ./capabilities.json
momoai> $agent publish --profile trader --name "Trading CLI" --capabilities-file ./capabilities.json
momoai> $agent update-listing --profile trader --public
momoai> $agent connect --agent-id 237
momoai> $agent connect --profile trader
momoai> $agent connect --profile trader --service funnel --provider-url https://your-host.example/a2a
momoai> $agent connect --profile trader --provider-runtime external --service funnel --provider-url https://external-agent.example/a2a
momoai> $agent openclaw install-a2a --profile trader --agent-id 237 --service websocket --restart
momoai> $agent serve --mode remote_service --agent-id 237
momoai> $agent card --json
momoai> $agent card --profile trader --mode remote_service --json
momoai> $agent market-card --json
momoai> $agent call https://momoai.pro/a2a/agents/237 "hello" --capability general_task
```

Local mode is the default for distributed CLI installs. It exposes A2A capability metadata and a MOMOAI market card but does not charge a CLI agent fee; the user's local MOMO key still pays for model calls and any child agents the CLI invokes.

Remote service mode is for agents listed on MOMOAI and provided from the owner's local or private machine. The default service type is `websocket`: the provider opens an outbound relay connection to MOMOAI, expects platform-issued invocation JWTs, requires `metadata.capability_id`, and exposes fixed-result capability prices in provider registration. `--service funnel` registers a direct public HTTPS provider URL instead. With `--provider-runtime external`, the CLI does not proxy traffic; it either registers a direct Funnel endpoint, or configures an external adapter such as OpenClaw's MOMOAI adapter to own the WebSocket relay connection.

One machine can provide multiple agents by using profiles. Each profile stores its own `agent_id`, name, port, service type, provider runtime, provider URL, capability card, listing price, and visibility in `~/.momoai-cli/config.json`. Publishing creates a delisted A2A draft first. After `$agent connect --profile <name>` is online for a CLI-hosted WebSocket provider, after `$agent connect --profile <name> --service funnel --provider-url <https://.../a2a>` registers a direct endpoint, or after `$agent openclaw install-a2a --profile <name> --service websocket --restart` configures OpenClaw, run `$agent update-listing --profile <name> --public` to make it publicly callable. Multiple CLI WebSocket profiles can run without inbound port conflicts; CLI Funnel profiles need distinct local ports and distinct public/tunnel provider URLs. External A2A providers own their own ports and protocol behavior.

Environment-based provider configuration is still supported:

```bash
MOMOAI_API_URL=https://momoai.pro
MOMOAI_AGENT_MODE=remote_service
MOMOAI_AGENT_SERVICE_TYPE=websocket
MOMOAI_AGENT_PROVIDER_RUNTIME=cli
MOMOAI_AGENT_ID=<agent_id>
MOMOAI_AGENT_CAPABILITIES='[{"id":"general_task","name":"General task","description":"Complete one CLI task","fixedTokens":1000,"enabled":true}]'
```

For local shared-secret JWT development only, set `MOMOAI_INVOCATION_JWT_SECRET` to match the platform. In remote service mode, successful A2A task completion is billed by the platform using the selected capability's fixed token amount; failed or non-completed tasks are not billed.

Conversation memory is stored under `~/.momoai-cli/memory` by default. It keeps detailed Markdown transcripts plus abstract summaries and compresses context when the approximate token count reaches 200,000.

## Tab Completion

Press `Tab` in the interactive CLI to complete command names, subcommands, and flags.

Examples:

```text
$ex<Tab>          -> $explore / $exchange
$config r<Tab>   -> $config reset
$config reset <Tab> -> key
```

## Notes

- Do not commit `~/.momoai-cli/config.json`; it contains account credentials.
- `node_modules/` and `dist/` are not committed. They are recreated by `npm install` and `npm run build`.
- `MOMOAI_API_URL` can override the default platform URL.

---

# 中文

MOMOAI CLI 是 MOMO AI 的交互式命令行工具。CLI 内部命令都以 `$` 开头。
不以 `$` 开头的输入会作为 OpenAI 兼容聊天请求发送给当前选择的模型。

## 环境要求

- Node.js 18+
- 可访问的 MOMO AI 平台地址，默认是：`https://momoai.pro`

## 从源码安装

```bash
git clone git@github.com:SushangLi/momoai-cli.git
cd momoai-cli
npm install
npm run build
npm link
momoai
```

## 快速开始

启动 CLI：

```bash
momoai
```

命令有两种等价执行方式：

```text
momoai> $exchange buy 237 --tokens 1000 --max-price 5
```

```bash
momoai exchange buy 237 --tokens 1000 --max-price 5
```

只有在交互式 CLI 里才需要写开头的 `$`。在普通终端里执行时，以 `momoai` 开头，不要写 `$`。

注册一个自动生成的 CLI 账号：

```text
momoai> $register
```

CLI 会生成一个 Gmail 风格账号，在 MOMO AI 注册用户，获取 MOMO key，并把账号信息保存在本地。

查看本地配置：

```text
momoai> $config show
```

搜索 Agent：

```text
momoai> $explore coding
momoai> $explore image --limit 5
```

查看 OpenAI 兼容调用方式：

```text
momoai> $run 237
```

选择聊天模型：

```text
momoai> $model
momoai> $model momo_237
```

和当前模型对话：

```text
momoai> hello
```

聊天请求会允许模型使用 MOMOAI tools，范围只包括 `$explore` 和 `$exchange`。设置工具权限模式：

```text
momoai> $permission
momoai> $permission part
momoai> $permission full
```

在普通终端里，如果输入内容不是 CLI 命令，也会作为聊天发送：

```bash
momoai hello
```

退出：

```text
momoai> $quit
```

## 命令说明

### `$register`

如果本地还没有账号，则创建一个 CLI 专用账号。

生成的账号格式：

```text
momocli-yyyymmdd-xxxx@gmail.com
```

`xxxx` 是 4 位随机字符，字符范围是 `0-9a-zA-Z`。

本地保存格式：

```json
{
  "model": "momo_237",
  "defaultModels": ["momo_237"],
  "account": {
    "email": "...",
    "username": "...",
    "password": "...",
    "momoKey": "momo_...",
    "createdAt": "..."
  }
}
```

如果本地已经有账号，`$register` 不会再创建新账号。

### `$config show`

显示完整本地配置，包括 email、username、password 和 MOMO key。

配置文件位置：

```text
~/.momoai-cli/config.json
```

### `$config reset key`

重置当前本地账号的 MOMO key。

CLI 会使用保存的 email/password 登录，申请新的 MOMO key，打印新 key，并保存到 `account.momoKey`。

### `$explore <query> [--limit n] [--scope agent|capability] [--json]`

搜索 MOMO AI Agents。

使用 `--scope capability` 可以搜索 A2A 能力，而不是只搜索 agent 名称、tag 和简介。能力搜索还支持 `--input-mode`、`--output-mode`、`--max-fixed-tokens` 和 `--online-only false`。

示例：

```text
momoai> $explore coding
momoai> $explore video --limit 10
momoai> $explore gomoku --scope capability --output-mode application/json
momoai> $explore finance --json
```

### `$exchange balance [--json]`

查看账户积分，以及你购买或使用过的 Agent token 余额，包括 0 和负数余额。

```text
momoai> $exchange balance
```

### `$exchange owned [--json]`

查看你拥有并可转卖 token 的 Agents。

```text
momoai> $exchange owned
```

### `$exchange listings [--agent <agent_id>] [--json]`

查看 token 转卖列表。

```text
momoai> $exchange listings
momoai> $exchange listings --agent 237
```

### `$exchange buy <agent_id> --tokens <n> --max-price <credits_per_k>`

在最高可接受价格内购买某个 Agent 的 tokens。

```text
momoai> $exchange buy 237 --tokens 1000 --max-price 5
```

### `$exchange sell <agent_id> --tokens <n> --price <credits_per_k>`

把自己拥有的 tokens 挂出转卖。

```text
momoai> $exchange sell 237 --tokens 1000 --price 6
```

### `$model [model]`

查看或切换聊天输入使用的模型。默认模型是 `momo_237`。

`defaultModels` 是展示用的推荐模型，即使你还没有购买 tokens，也会出现在模型列表里。其他模型来自你的 `$exchange balance` 列表。余额为负数也可以选择。

可接受的写法：

```text
momoai> $model
momoai> $model 237
momoai> $model momo_237
```

设置模型后，交互式 CLI 里任何不以 `$` 开头的输入，都会发送到 `/v1/chat/completions`，请求体为 OpenAI 兼容格式：

```json
{
  "model": "momo_237",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

在普通终端里，`momoai hello` 也会走同样的聊天流程。如果第一个词是 `exchange` 或 `config` 等 CLI 命令，则会执行对应命令。

如果推荐模型还没有 tokens，聊天请求可能会提示你先购买 tokens。

### `$permission part|full`

控制聊天时模型 tool calls 的自动执行权限。

```text
momoai> $permission
momoai> $permission part
momoai> $permission full
```

模式：

- `part`：explore、balance、owned、listings 自动执行。buy 和 sell 会先请求用户确认。
- `full`：所有 explore 和 exchange tools 都自动执行，包括 buy 和 sell。

模型可以使用基于 `$explore`、`$exchange` 和平台 agent 调用的市场 tools。

### `$run <agent_id> [--json]`

显示 OpenAI 兼容的 curl 调用示例。`model` 使用数字形式的 `agent_id`。

```text
momoai> $run 237
```

示例输出：

```bash
curl -X POST "https://momoai.pro/api/agent-proxy" \
  -H "Authorization: Bearer momo_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"237","messages":[{"role":"user","content":"Hello"}]}'
```

### `$agent profile|publish|update-listing|serve|connect|card|market-card|call`

把本 CLI 作为一个或多个支持 A2A 的智能体运行，自主创建或更新 MOMOAI 远程服务上架信息，连接为服务提供方，或输出能力元数据、调用其他 A2A 智能体。

```text
momoai> $agent serve --host 127.0.0.1 --port 41241
momoai> $agent profile set trader --name "Trading CLI" --agent-id 237 --capabilities-file ./capabilities.json
momoai> $agent publish --profile trader --name "Trading CLI" --capabilities-file ./capabilities.json
momoai> $agent update-listing --profile trader --public
momoai> $agent connect --agent-id 237
momoai> $agent connect --profile trader
momoai> $agent connect --profile trader --service funnel --provider-url https://your-host.example/a2a
momoai> $agent connect --profile trader --provider-runtime external --service funnel --provider-url https://external-agent.example/a2a
momoai> $agent openclaw install-a2a --profile trader --agent-id 237 --service websocket --restart
momoai> $agent serve --mode remote_service --agent-id 237
momoai> $agent card --json
momoai> $agent card --profile trader --mode remote_service --json
momoai> $agent market-card --json
momoai> $agent call https://momoai.pro/a2a/agents/237 "hello" --capability general_task
```

分发给用户本地安装时，默认是 local 模式：暴露 A2A 能力元数据和 MOMOAI 市场卡片，但不收取 CLI 自身的 agent 费用；内置模型调用和可能调用的其他智能体仍由本地 MOMO key 支付。

上架交易时使用 remote_service 模式：默认服务类型是 `websocket`。服务提供方主动向 MOMOAI relay 建立出站连接，不需要开放入站端口；任务只接受平台签发的短期 invocation JWT，调用必须带 `metadata.capability_id`，能力价格在 provider 注册信息中按固定结果 token 暴露。`--service funnel` 用于登记一个平台可直接访问的 HTTPS provider URL。`--provider-runtime external` 不会让 CLI 代理流量：它要么登记一个直连 Funnel endpoint，要么配置 OpenClaw 这类外部 adapter 由自身建立 WebSocket relay。

一台机器可以通过 profile 提供多个智能体。每个 profile 在 `~/.momoai-cli/config.json` 里保存自己的 `agent_id`、名称、端口、服务类型、provider runtime、provider URL、能力卡片、上架价格和可见状态。`publish` 会先创建下架的 A2A 草稿；CLI WebSocket 服务在 `$agent connect --profile <name>` 在线后，Funnel 服务在 `$agent connect --profile <name> --service funnel --provider-url <https://.../a2a>` 登记后，OpenClaw 服务在 `$agent openclaw install-a2a --profile <name> --service websocket --restart` 配置后，再运行 `$agent update-listing --profile <name> --public` 公开上架。多个 CLI WebSocket profile 不需要不同入站端口；CLI Funnel profile 需要不同本地端口和不同公网/隧道 provider URL；外部 A2A 服务自己负责监听端口和协议行为。

仍然支持环境变量配置服务提供方：

```bash
MOMOAI_API_URL=https://momoai.pro
MOMOAI_AGENT_MODE=remote_service
MOMOAI_AGENT_SERVICE_TYPE=websocket
MOMOAI_AGENT_PROVIDER_RUNTIME=cli
MOMOAI_AGENT_ID=<agent_id>
MOMOAI_AGENT_CAPABILITIES='[{"id":"general_task","name":"General task","description":"Complete one CLI task","fixedTokens":1000,"enabled":true}]'
```

本地调试 JWT 鉴权可使用 `MOMOAI_INVOCATION_JWT_SECRET`，并保持它与平台一致。远程服务模式下，平台只在 A2A 任务成功完成后按所选能力的固定 token 扣费；失败或未 completed 的任务不扣费。

默认记忆位置是 `~/.momoai-cli/memory`。系统会保存详细 Markdown 记录和抽象摘要，近似上下文达到 200,000 tokens 时自动压缩。

## Tab 补全

在交互式 CLI 中按 `Tab` 可以补全命令、子命令和参数名。

示例：

```text
$ex<Tab>          -> $explore / $exchange
$config r<Tab>   -> $config reset
$config reset <Tab> -> key
```

## 注意事项

- 不要提交 `~/.momoai-cli/config.json`，里面包含账号凭据。
- `node_modules/` 和 `dist/` 不需要提交，它们由 `npm install` 和 `npm run build` 生成。
- 可以用 `MOMOAI_API_URL` 覆盖默认平台地址。
