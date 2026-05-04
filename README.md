# MOMOAI CLI

English | [中文](#中文)

MOMOAI CLI is an interactive command-line tool for MOMO AI. Commands inside the CLI start with `$`.

## Requirements

- Node.js 18+
- A reachable MOMO AI platform URL, default: `https://hub.momoai.pro`

## Install From Source

```bash
git clone git@github.com:SushangLi/momoai-cli.git
cd momoai-cli
npm install
npm run build
npm start
```

`npm start` runs `node dist/index.js`, so run `npm run build` first.

To install the `momoai` command globally from your local clone:

```bash
npm link
```

After `npm link`, start the interactive CLI from any directory:

```bash
momoai
```

You can also run commands directly without entering the interactive CLI. Omit the leading `$`:

```bash
momoai exchange buy 216 --tokens 200 --max-price 10
```

## Quick Start

Start the CLI:

```bash
npm start
```

Or, after `npm link`:

```bash
momoai
```

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

### `$explore <query> [--limit n] [--json]`

Searches MOMO AI agents.

Examples:

```text
momoai> $explore coding
momoai> $explore video --limit 10
momoai> $explore finance --json
```

### `$exchange balance [--json]`

Shows account credits and owned token balances.

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

### `$run <agent_id> [--json]`

Shows an OpenAI-compatible curl example for running an agent. The `model` value is the numeric `agent_id`.

```text
momoai> $run 237
```

Example output:

```bash
curl -X POST "https://hub.momoai.pro/api/agent-proxy" \
  -H "Authorization: Bearer momo_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"237","messages":[{"role":"user","content":"Hello"}]}'
```

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

## 环境要求

- Node.js 18+
- 可访问的 MOMO AI 平台地址，默认是：`https://hub.momoai.pro`

## 从源码安装

```bash
git clone git@github.com:SushangLi/momoai-cli.git
cd momoai-cli
npm install
npm run build
npm start
```

`npm start` 实际执行的是 `node dist/index.js`，所以需要先运行 `npm run build`。

如果想把 `momoai` 命令安装到本机全局命令中：

```bash
npm link
```

执行 `npm link` 后，可以在任意目录启动交互式 CLI：

```bash
momoai
```

也可以不进入交互式 CLI，直接在终端执行命令。此时不要写开头的 `$`：

```bash
momoai exchange buy 216 --tokens 200 --max-price 10
```

## 快速开始

启动 CLI：

```bash
npm start
```

或者，在执行过 `npm link` 后：

```bash
momoai
```

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

### `$explore <query> [--limit n] [--json]`

搜索 MOMO AI Agents。

示例：

```text
momoai> $explore coding
momoai> $explore video --limit 10
momoai> $explore finance --json
```

### `$exchange balance [--json]`

查看账户积分和已拥有的 token 余额。

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

### `$run <agent_id> [--json]`

显示 OpenAI 兼容的 curl 调用示例。`model` 使用数字形式的 `agent_id`。

```text
momoai> $run 237
```

示例输出：

```bash
curl -X POST "https://hub.momoai.pro/api/agent-proxy" \
  -H "Authorization: Bearer momo_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"237","messages":[{"role":"user","content":"Hello"}]}'
```

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
