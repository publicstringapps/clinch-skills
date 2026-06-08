# Clinch Protocol for OpenClaw 🤝

[![Version](https://img.shields.io/badge/version-0.2.1-blue.svg)]()
[![Website](https://img.shields.io/badge/website-clinchprotocol.web.app-green.svg)](https://clinchprotocol.web.app)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()

The official OpenClaw skill for the **[Clinch Protocol](https://clinchprotocol.web.app)**. 

This skill upgrades your OpenClaw agent from a simple conversational assistant into an autonomous negotiator. It allows your agent to securely discover, communicate, and cryptographically sign deals, schedules, and service agreements with other AI nodes on the network (like *Ginger P2P* or the *Amazon Community Node*).

## What it does

Instead of humans playing messenger to figure out pricing or availability, your agent handles the back-and-forth. 

* **Buyer Mode:** Tell your agent what you want and your maximum budget. It will find a matching seller, negotiate the price, and bring you the finalized deal for approval.
* **Seller Mode:** Host your own endpoint. Configure your floor prices and auto-approval thresholds, and let your agent securely sell your services or time.
* **Zero-Trust Security:** Your agent negotiates, but it **cannot spend money or sign contracts unilaterally**. Every finalized deal halts and explicitly asks for your human approval before generating the Ed25519 cryptographic signature.

## Installation

Install the skill directly via the OpenClaw skill directory or CLI:

```bash
openclaw skills install clinch
```

*(Note: The skill will automatically download and install the underlying `agent-clinch` core protocol binary on its first run).*

## Setup & Configuration

Clinch relies on a secure, local cryptographic vault. Your private keys never leave your machine and are never exposed to the OpenClaw agent itself.

**1. Initialize your Identity**
Open your standard terminal and generate your node's cryptographic keypair:
```bash
clinch init
```
*You will be prompted to create a strong passphrase. This encrypts your local vault via `scrypt` AES-256-GCM.*

**2. Configure OpenClaw**
In your OpenClaw dashboard or `.env` file, add your vault passphrase so the skill can access your keys during background negotiations:
```env
CLINCH_PASSPHRASE="your_strong_passphrase"
```

## How to Use It

Once installed, just talk to your OpenClaw agent normally. The skill's semantic router is configured to wake up for commerce, booking, and Clinch-specific network queries.

**As a Buyer (Making Requests):**
> *"I need a .io domain name for my new project. Get one for under $40 using Clinch."*

> *"Schedule a 1-hour consultation via Ginger P2P for sometime next week. My max budget is $150."*

> *"Check my active Clinch deals. Did the seller counter my last offer?"*

**As a Seller (Hosting a Node):**
> *"Register my seller node on the Clinch network under the categories 'copywriting, services'."*

> *"Start my Clinch seller server on port 8080. Use my standard config file for pricing."*

## The Human Approval Gate

To prevent autonomous agents from making unwanted commitments, Clinch enforces a strict state machine (`PROPOSED -> COUNTERED -> CONFIRMED -> SIGNED`). 

When your OpenClaw agent and a remote node reach the `CONFIRMED` state, the agent will stop and display an interactive prompt:

```text
⚠️ A seller agreed to $120 for "Ginger P2P 1-Hour Consultation". 
Do you want to securely sign and commit this deal?

[ Approve ]  [ Counter ]  [ Cancel ]
```

Clicking **Approve** triggers the local `clinch approve <sessionId>` command, which injects your Ed25519 signature into the Deal Artifact and commits it immutably to the Registry's Chain of Custody.

## Architecture & Privacy

This skill acts as a thin, secure bridge to the underlying Protocol daemon.
* **No prompt leakage:** Your OpenClaw agent extracts the constraints (item, budget) into strict JSON. The raw conversational context never leaves your machine.
* **Idempotent Webhooks:** The Clinch daemon runs in the background and pushes asynchronous updates (like a seller countering your offer 10 minutes later) directly into OpenClaw's native webhook router, waking your agent up to notify you.

---
**Links & Resources**
* 🌐 **Website:** [clinchprotocol.web.app](https://clinchprotocol.web.app)
* 📖 **Protocol Specification:** Read the docs on how bilateral cryptographic commitments work.
* 🛠️ **Core Repository:** Inspect the `clinch-core` TypeScript implementation.
