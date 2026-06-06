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

If no vault exists yet (first run), guide the user to initialize one:

```bash
clinch init
```

Tell the user: "You'll be prompted to create a vault passphrase. Once set, add it to your OpenClaw environment as `CLINCH_PASSPHRASE` so I can sign deals on your behalf."

`CLINCH_PASSPHRASE` must be set in the environment before any command that touches the vault (negotiate, counter, approve, cancel, serve, node register). If it is missing, stop and tell the user to set it — never proceed without it.

## Core workflow — Buyer

### 1. Starting a negotiation

Extract the user's intent into a strict JSON constraints object, then pass it as the argument to `clinch negotiate`:

```bash
clinch negotiate '{"intent":"purchase","item":"domain name","max_budget":20,"terms":{}}' --direct
```

For schedule negotiations where there is no money involved, set `max_budget` to `null`:

```bash
clinch negotiate '{"intent":"schedule","item":"1-hour consultation","max_budget":null,"terms":{"preferred_day":"Tuesday","duration_minutes":60}}' --direct
```

Always use `--direct` so output is clean JSON you can parse.

The response includes `session.state`. Handle each state:

- `PROPOSED` — proposal sent, awaiting seller response. Tell the user the daemon will notify them when the seller responds.
- `COUNTERED` — seller replied with a counter price. Tell the user the counter price and ask what they'd like to do: accept, counter again, or cancel.
- `CONFIRMED` — seller agreed. **Surface this to the user immediately and ask for approval before proceeding.** Do not call approve without explicit user confirmation.
- `CANCELLED` — seller rejected outright. Inform the user and ask if they want to try a different seller or adjust constraints.

### 2. Checking active negotiations

```bash
clinch status --direct
```

This reads the local state file. No vault needed.

### 3. Countering a seller's offer

```bash
clinch counter <session_id> <price> --reason "Your reason here" --direct
```

Parse the response the same way as negotiate — the seller may confirm, counter again, or cancel.

### 4. Approving a confirmed deal — HUMAN GATE

**Never call this without explicit user confirmation.** Always tell the user the final price and item, and ask: "Do you want to sign and commit this deal?"

Only after confirmation:

```bash
clinch approve <session_id> --direct
```

A successful response returns `status: "SIGNED"` and a `artifact` object containing both cryptographic signatures. Tell the user the deal is committed and share the artifact ID.

### 5. Cancelling a negotiation

```bash
clinch cancel <session_id> --direct
```

This notifies the counterparty and marks the session as cancelled. Use this any time before signing.

### 6. Viewing signed deals

```bash
clinch deals --direct
```

No vault needed. Returns all completed deals with item, price, timestamp, and artifact ID.

## Seller workflow

### Registering a node

```bash
clinch node register <public_endpoint_url> --categories "services,consulting,scheduling"
```

`<public_endpoint_url>` must be a publicly reachable HTTPS URL where the seller HTTP server is running.

### Starting the seller server

```bash
clinch serve --port 8080 --config /path/to/seller-config.json
```

The seller config JSON sets pricing floor, auto-approve threshold, and max negotiation turns. If no config is provided, defaults are used (floor $45, approve $100, maxTurns 5).

After starting, remind the user to ensure their public endpoint routes to the chosen port and that they've registered it with `clinch node register`.

### Configuring node mode

```bash
clinch config --mode buyer     # default
clinch config --mode seller
clinch config --mode both
```

## Handling incoming events (daemon callbacks)

The Clinch daemon pushes events via the OpenClaw webhook when configured. When you receive a webhook event from Clinch, handle it as follows:

- `approval_required` — A deal is CONFIRMED. Notify the user with the price and item. Ask for explicit confirmation before calling `clinch approve`.
- `counter_received` — A counter offer arrived. Tell the user the new price and ask how to respond.
- `session_cancelled` — The counterparty cancelled. Inform the user.

## Output format

All `--direct` commands return JSON. Key fields:

- `status` — `"SUCCESS"`, `"SIGNED"`, `"COUNTERED"`, `"CANCELLED"`, or `"ERROR"`
- `session.state` — current state machine state
- `session.sessionId` — use this for follow-up commands
- `session.lastPrice` — the most recent agreed or countered price
- `artifact` — present only on `SIGNED`; contains `sessionId`, `item`, `price`, `buyerSignature`, `sellerSignature`
- `error` — present on failure; surface this to the user clearly

## Error handling

- `"Vault Locked or Uninitialized"` → user needs to run `clinch init` and set `CLINCH_PASSPHRASE`
- `"No sellers found"` → registry has no matching nodes; tell the user to try different search terms or use `--target` to specify a node directly
- `"Seller unreachable"` → the seller node is offline; suggest trying another seller
- `"Approval Gate Blocked"` → session is not in CONFIRMED state; check status first
- Registry 401 → JWT expired; the CLI handles this automatically via PoW re-solve; retry the command

## Important constraints

- Never pass raw user messages as the intent string — always extract and structure the constraints yourself as JSON before calling negotiate.
- Never call `clinch approve` without explicit user confirmation in that session. This is a cryptographic commitment.
- Never store or log `CLINCH_PASSPHRASE` anywhere.
- The `clinch status` and `clinch deals` commands do not require the vault — they read local state files directly. Do not ask for the passphrase for these.

