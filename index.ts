/**
 * Clinch Protocol — OpenClaw Skill (Full Duality)
 *
 * Ensures clinch-cli is installed, handles auto-starting the 
 * background daemons (both buyer long-polling and seller HTTP),
 * and maps every CLI command to the OpenClaw agent's toolbelt.
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import type {
  SkillContext,
  ToolCall,
  ToolResult,
  WebhookPayload,
} from "@openclaw/skill-sdk";

const execFileAsync = promisify(execFile);

const CLI_PACKAGE = "agent-clinch";
const CLI_BIN = "clinch";
const APPROVAL_REQUIRED_MSG =
  "⚠️ A deal is CONFIRMED. Run clinch_approve with the session_id to sign the deal, or clinch_cancel to walk away. Always ask the user for confirmation before approving.";

// ============================================================================
// SKILL LIFECYCLE
// ============================================================================

export async function onLoad(ctx: SkillContext): Promise<void> {
  await ensureCLIInstalled(ctx);

  if (ctx.webhookUrl) {
    await runCLI(["config", "--webhook", ctx.webhookUrl], ctx);
    ctx.log(`Registered native OpenClaw webhook with Clinch: ${ctx.webhookUrl}`);
  }

  // Ensure the long-polling buyer daemon is running to catch callbacks
  startBackgroundProcess("start", [], ctx);

  ctx.log("Clinch skill loaded. Full Buyer/Seller duality enabled.");
}

// ============================================================================
// TOOL DISPATCH
// ============================================================================

export async function onToolCall(
  call: ToolCall,
  ctx: SkillContext
): Promise<ToolResult> {
  switch (call.name) {
    // Buyer / General Tools
    case "clinch_negotiate":
      return negotiate(call.params as any, ctx);
    case "clinch_status":
      return runCLI(["status", "--direct"], ctx);
    case "clinch_deals":
      return runCLI(["deals", "--direct"], ctx);
    case "clinch_counter":
      return counter(call.params as any, ctx);
    case "clinch_approve":
      return approve(call.params as any, ctx);
    case "clinch_cancel":
      return runCLI(["cancel", (call.params as any).session_id, "--direct"], ctx);

    // Seller / Management Tools
    case "clinch_config":
      return runCLI(["config", "--mode", (call.params as any).mode], ctx);
    case "clinch_node_register":
      return registerNode(call.params as any, ctx);
    case "clinch_serve":
      return serve(call.params as any, ctx);

    default:
      return { error: `Unknown tool: ${call.name}` };
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

async function negotiate(
  params: { constraints_json: string; target?: string },
  ctx: SkillContext
): Promise<ToolResult> {
  // Pass the raw JSON string straight to the CLI
  const args = ["negotiate", params.constraints_json, "--direct"];
  if (params.target) args.push("--target", params.target);

  const result = await runCLI(args, ctx);
  if (result.error) return result;

  if (result.status === "CANCELLED") {
    return { ...result, agent_note: "The seller immediately rejected this proposal." };
  }
  if (result.session?.state === "CONFIRMED") {
    return { ...result, agent_note: APPROVAL_REQUIRED_MSG };
  }
  if (result.session?.state === "COUNTERED") {
    return { ...result, agent_note: `Seller countered at $${result.session.lastPrice}. Ask user to accept, counter, or cancel.` };
  }

  return { ...result, agent_note: "Proposal sent. We will receive a webhook notification when the seller responds." };
}

async function counter(
  params: { session_id: string; price: number; reason?: string },
  ctx: SkillContext
): Promise<ToolResult> {
  const args = ["counter", params.session_id, params.price.toString(), "--direct"];
  if (params.reason) args.push("--reason", params.reason);

  const result = await runCLI(args, ctx);
  if (result.error) return result;

  if (result.status === "CANCELLED") return { ...result, agent_note: "Seller cancelled at max turns." };
  if (result.session?.state === "CONFIRMED") return { ...result, agent_note: APPROVAL_REQUIRED_MSG };

  return result;
}

async function approve(
  params: { session_id: string },
  ctx: SkillContext
): Promise<ToolResult> {
  const result = await runCLI(["approve", params.session_id, "--direct"], ctx);
  if (result.status === "SIGNED") {
    return { ...result, agent_note: `Deal securely signed and bilaterally committed.` };
  }
  return result;
}

async function registerNode(
  params: { endpoint: string; categories: string },
  ctx: SkillContext
): Promise<ToolResult> {
  const args = ["node-register", params.endpoint, "--categories", params.categories];
  return runCLI(args, ctx);
}

async function serve(
  params: { port: number; config_path?: string },
  ctx: SkillContext
): Promise<ToolResult> {
  const args = ["--port", params.port.toString(), "--direct"];
  if (params.config_path) args.push("--config", params.config_path);

  // Serve runs indefinitely in the background
  startBackgroundProcess("serve", args, ctx);
  
  return { 
    status: "SUCCESS", 
    message: `Seller node started locally on port ${params.port}. Ensure your public endpoint routes to this port.` 
  };
}

// ============================================================================
// WEBHOOK: ASYNC EVENT PUSH FROM DAEMON
// ============================================================================

export async function onWebhook(
  payload: WebhookPayload,
  ctx: SkillContext
): Promise<void> {
  const { event, session } = payload.body as {
    event: string;
    session: Record<string, any>;
  };

  switch (event) {
    case "approval_required":
      ctx.notify({
        title: "Clinch — Deal Ready to Sign",
        body: `${session.targetId.substring(0,8)}... agreed to $${session.lastPrice} for "${session.constraints?.item}".`,
        action: {
          tool: "clinch_approve",
          params: { session_id: session.sessionId },
          requiresUserConfirmation: true,
          confirmationPrompt: `A seller agreed to $${session.lastPrice} for "${session.constraints?.item}". Do you want to securely sign and commit this deal?`,
        },
      });
      ctx.pushToAgent({ role: "system", content: `${APPROVAL_REQUIRED_MSG} Session ID: ${session.sessionId}, Price: $${session.lastPrice}.` });
      break;

    case "counter_received":
      ctx.notify({ title: "Clinch — Counter Offer", body: `Counter from seller: $${session.lastPrice} for "${session.constraints?.item}".` });
      ctx.pushToAgent({ role: "system", content: `Counter received on session ${session.sessionId}. Seller offered $${session.lastPrice}. Ask the user: accept, counter again, or cancel?` });
      break;

    case "session_cancelled":
      ctx.pushToAgent({ role: "system", content: `Session ${session.sessionId} was cancelled by the counterparty.` });
      break;

    default:
      ctx.log(`Unhandled Clinch event: ${event}`);
  }
}

// ============================================================================
// INTERNAL EXECUTION HELPERS
// ============================================================================

/**
 * Execute the Clinch CLI using execFile for safe argument parsing
 */
async function runCLI(args: string[], ctx: SkillContext): Promise<Record<string, any>> {
  const passphrase = process.env.CLINCH_PASSPHRASE;
  
  if (!passphrase && requiresVault(args)) {
    return {
      error: "Vault Locked or Uninitialized",
      agent_note: "Instruct the user to open their terminal, run `clinch init`, and then save their passphrase in the skill settings as CLINCH_PASSPHRASE."
    };
  }

  try {
    const { stdout } = await execFileAsync(CLI_BIN, args, {
      env: { ...process.env, CLINCH_PASSPHRASE: passphrase },
      timeout: 45000, 
    });

    try { return JSON.parse(stdout.trim()); } 
    catch { return { status: "SUCCESS", output: stdout.trim() }; } 
    
  } catch (err: any) {
    const stderr = err.stderr || "";
    try { return JSON.parse(stderr.trim()); } 
    catch {
      ctx.log(`CLI execution failed: ${err.message}`);
      if (err.message.includes("Run 'clinch init'")) {
         return { error: "Initialization Required", agent_note: "Tell user to run `clinch init` in their terminal." };
      }
      return { error: `CLI execution failed: ${err.message}` };
    }
  }
}

function requiresVault(args: string[]): boolean {
  const vaultCommands = ["negotiate", "counter", "approve", "cancel", "serve", "node-register"];
  return vaultCommands.some((cmd) => args.includes(cmd));
}

async function ensureCLIInstalled(ctx: SkillContext): Promise<void> {
  try {
    await execFileAsync("which", [CLI_BIN]);
  } catch {
    ctx.log("clinch-cli not found. Installing...");
    try {
      await execFileAsync("npm", ["install", "-g", CLI_PACKAGE]);
      ctx.log("clinch-cli installed.");
    } catch (e) {
      ctx.log(`Failed to install clinch-cli. Install manually: npm install -g ${CLI_PACKAGE}`);
    }
  }
}

function startBackgroundProcess(command: string, args: string[], ctx: SkillContext): void {
  const passphrase = process.env.CLINCH_PASSPHRASE;
  if (!passphrase) return; 

  const child = spawn(CLI_BIN, [command, ...args], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CLINCH_PASSPHRASE: passphrase }
  });

  child.unref();
  ctx.log(`Clinch background process spawned: ${command}`);
}
