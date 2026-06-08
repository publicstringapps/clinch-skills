---
name: clinch-protocol
description: Negotiate deals, schedules, and service agreements with other AI agents using the Clinch Protocol ANP layer.
homepage: https://clinchprotocol.web.app
metadata:
  openclaw:
    requires:
      bins: ["clinch"]
    primaryEnv: "CLINCH_PASSPHRASE"
---

# Clinch Protocol

Clinch is an open Agent Negotiation Protocol (ANP). It lets you negotiate purchases, schedules, and service agreements directly with other AI agents — no human back-and-forth required. Your agent handles the full negotiation loop. You only step in to approve or reject a final deal before anything is signed.

## When to use this skill

Trigger this skill whenever the user mentions:
- Wanting to buy, book, or hire something and mentions Clinch or "negotiate with an agent"
- Scheduling something with another party via an AI agent
- Checking the status of an active negotiation
- Approving, countering, or cancelling a deal in progress
- Browsing available sellers on the network
- Setting up their node as a seller on the Clinch network

## Prerequisites — check before every session

Run this check silently before any Clinch command:

```bash
clinch --version
```

If the binary is missing, install it:

```bash
npm install -g agent-clinch
```

If the vault is not configured, guide the user to initialize one based on their role:

**For Buyers:**
```bash
clinch init
```
This generates a secure local identity.

**For Sellers:**
Sellers must first claim a domain (e.g., `amazon.anp`) on the Clinch Dashboard. The dashboard will issue an official private key. Import it by running:
```bash
clinch init --key <YOUR_DASHBOARD_PRIVATE_KEY>
```

Tell the user: "You'll be prompted to create a vault passphrase. Once set, add it to your OpenClaw environment as `CLINCH_PASSPHRASE` so I can act on your behalf."

`CLINCH_PASSPHRASE` must be set in the environment before any command that touches the vault (negotiate, counter, approve, cancel, serve, node register, discover). If it is missing, stop and tell the user to set it.

## Core workflow — Buyer

### 1. Discovering sellers

Before negotiating, browse what's available on the registry:

```bash
clinch discover <category> --direct
```

The output provides read-only parameters synced from the central dashboard:

| Field | Description |
|---|---|
| `agent_id` | The registered `.anp` domain (e.g., `ginger.anp`) |
| `display_name` | The store name |
| `official_node` | Verified by the network administrators |
| `categories` | Items or services offered |
| `capabilities` | Capabilities supported by the node |
| `supported_modes` | Protocol capabilities |
| `reputation_score` | Derived dynamically from historical deal acceptance rate |

Pass the chosen `agent_id` as `--target` when calling negotiate.

### 2. Starting a negotiation

Extract the user's intent into a strict JSON constraints object, then pass it as the argument to `clinch negotiate`:

```bash
clinch negotiate '{"intent":"purchase","item":"domain name","max_budget":20,"terms":{}}' --target ginger.anp --direct
```

For schedule negotiations where there is no money involved, set `max_budget` to `null`:

```bash
clinch negotiate '{"intent":"schedule","item":"1-hour consultation","max_budget":null,"terms":{"preferred_day":"Tuesday"}}' --target schedule.anp --direct
```

Always use `--direct` so output is clean JSON you can parse. Handle each `session.state`:

- `PROPOSED` — proposal sent, awaiting seller response.
- `COUNTERED` — seller replied with a counter price. Ask the user what to do: accept, counter again, or cancel.
- `CONFIRMED` — seller agreed. **Surface this to the user immediately and ask for approval.** Do not call approve without explicit confirmation.
- `CANCELLED` — seller rejected outright.

### 3. Checking active negotiations

```bash
clinch status --direct
```

### 4. Countering a seller's offer

```bash
clinch counter <session_id> <price> --reason "Your reason here" --direct
```

### 5. Approving a confirmed deal — HUMAN GATE

**Never call this without explicit user confirmation.** 

Only after confirmation:

```bash
clinch approve <session_id> --direct
```

A successful response returns `status: "SIGNED"` and an `artifact` object containing cryptographic signatures. Tell the user the deal is committed and share the artifact ID.

### 6. Cancelling a negotiation

```bash
clinch cancel <session_id> --direct
```

### 7. Viewing signed deals

```bash
clinch deals --direct
```

## Seller workflow

### 1. Registering the Domain Endpoint

As a seller, your primary identity (Domain, Name, Instructions, Keys) is controlled entirely via the Clinch Dashboard. 

You can find the seller's dashboard in this link:
```bash
https://clinchprotocol.web.app/sellers.html
```

Once your domain (e.g., `mybrand.anp`) is claimed and your dashboard private key is imported into the CLI (`clinch init --key ...`), you must bind your physical server endpoint to your domain:

```bash
clinch node register mybrand.anp https://my-public-endpoint.com/api \
  --categories "retail,electronics" \
  --capabilities "http-webhook,room_routing" \
  --modes "ANP/C"
```

### 2. Starting the seller server

```bash
clinch serve --port 8080 --config /path/to/seller-config.json
```

The seller config JSON sets your machine's local logic: pricing floor, auto-approve threshold, and max negotiation turns. If no config is provided, defaults are used (floor $45, approve $100, maxTurns 5).

### Configuring node mode

```bash
clinch config --mode buyer     # default
clinch config --mode seller
clinch config --mode both
```

### Blind Key Pass (for gated seller nodes)

If a seller requires a pre-shared token to accept proposals:

```bash
clinch key --set <seller_agent_id> --value <secret_token>
```

This stores the token encrypted in the vault. It is silently injected into every handshake and counter sent to that seller. 

## Handling incoming events (daemon callbacks)

The Clinch daemon pushes events via the OpenClaw webhook when configured.

- `approval_required` — A deal is CONFIRMED. Notify the user and ask for confirmation before calling `clinch approve`.
- `counter_received` — A counter offer arrived. Tell the user the new price.
- `session_cancelled` — The counterparty cancelled.

## Error handling

- `"Vault Locked or Uninitialized"` → user needs to run `clinch init` and set `CLINCH_PASSPHRASE`
- `"No sellers found"` → registry has no matching nodes; check the category.
- `"Seller unreachable"` → the seller node is offline.
- `"Approval Gate Blocked"` → session is not in CONFIRMED state.
- `"Agent ID not found"` → Node registration failed because the user has not claimed the domain on the dashboard yet.

## Important constraints

- Never call `clinch approve` without explicit user confirmation in that session. This is a cryptographic commitment.
- Never store or log `CLINCH_PASSPHRASE` anywhere.
- `official_node`, `display_name`, and `reputation_score` are strictly assigned by the network registry. Do not attempt to configure them via the CLI.
