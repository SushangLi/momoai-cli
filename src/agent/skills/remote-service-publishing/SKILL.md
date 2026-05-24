# Remote Service Publishing Skill

This agent can help the user publish, update, and run local CLI agent profiles as MOMOAI A2A remote services. The goal is to make a local machine provide one or more billable A2A services through the MOMOAI platform gateway.

## Available Tools

- `publish_local_agent_listing`: Create a delisted MOMOAI A2A remote-service draft for a local profile. Use it after the plan defines the profile name, public name, description, capabilities, and fixed result-token prices.
- `update_local_agent_listing`: Update an existing remote-service listing for a local profile. Use it to change name, description, price, capabilities, available inventory, or visibility.

## CLI Commands

- `$agent profile list`: Show local profiles and stored platform agent ids.
- `$agent profile set <profile> --name <name> --description <text> --capabilities-file <path> --service polling|http --provider-url <url>`: Save or update a local profile.
- `$agent publish --profile <profile> --name <name> --capabilities-file <path> --service polling|http --provider-url <url>`: Create a delisted A2A draft on MOMOAI and save the returned `agent_id` into the profile.
- `$agent connect --profile <profile>`: Start the provider for that profile. Keep this process running.
- `$agent connect --profile <profile>` defaults to realtime HTTP service.
- `$agent connect --profile <profile> --service polling`: Use delayed polling. The provider checks the platform about once per hour and does not expose an inbound HTTP port.
- `$agent connect --profile <profile> --service http --provider-url https://<public-or-tunnel-host>/a2a`: Use realtime HTTP. The CLI starts the local A2A server and registers the reachable endpoint with the platform.
- `$agent update-listing --profile <profile> --public`: Publish the listing publicly after the provider node is online.
- `$agent update-listing --profile <profile> --delisted`: Hide the listing again.
- `$agent card --profile <profile> --mode remote_service --json`: Inspect the exposed A2A capability card.

## Workflow

1. Plan before acting. Identify the target profile, public name, description, capabilities, fixed result-token prices, and whether the service should remain delisted.
2. Confirm every enabled capability has a stable `id`, user-facing `name`, concise `description`, and positive `fixedTokens`.
3. Create or update the profile locally.
4. Publish with `publish_local_agent_listing` or `$agent publish`; this creates a delisted draft first.
5. Choose a service type:
   - `http`: default and realtime. It requires a provider URL that momoai.pro can reach, usually a reverse proxy or tunnel ending in `/a2a`.
   - `polling`: safer and private, but delayed. It checks for queued work about once per hour and callers retrieve results later with `tasks/get`.
6. Ask the user to run `$agent connect --profile <profile> --service <type>` and keep it online.
7. Only after the provider is online, update the listing to public.
8. For changes to capabilities or prices, update the profile and listing, then reconnect if the running provider needs the new local profile data.

## Billing Rules

- A2A agent billing is fixed-result billing by capability.
- The caller pays the selected capability's fixed token amount only when the task returns `completed`.
- Failed, expired, canceled, or non-completed tasks are not charged.
- Internal model/tool usage is not exposed as continuous caller billing on this A2A path.

## Multi-Agent Hosting

- One machine can host multiple CLI agent profiles.
- The platform routes by `agent_id`; each running provider process is tied to one profile and one platform agent id.
- Polling providers do not require public inbound ports.
- HTTP providers require a distinct local `host:port` per concurrently running profile, plus a distinct public/tunnel `provider-url` that forwards to that profile's `/a2a`.
- The provider URL is stored for platform routing and should not be exposed in the public agent card.

## Constraints

- Do not make a listing public before an online provider node exists.
- Do not invent capability ids or fixed token prices. Ask the user when missing.
- Do not set `fixedTokens` to zero or a negative number.
- Do not tell users to configure platform private signing keys on their machine; providers normally verify platform JWTs through MOMOAI JWKS.
- Do not use `http` unless the endpoint is reachable by momoai.pro and protected by the platform invocation JWT.
