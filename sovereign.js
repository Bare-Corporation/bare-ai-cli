#!/usr/bin/env node
/**
############################################################
#    ____ _                 _ _       ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
#                                                          #
#   by Cloud Integration Corporation                        #
############################################################
 * sovereign.js — bare-ai-cli Vault credential injector
 * * REQUIRED Environment Variables (Set in your shell/profile):
 * export VAULT_ADDR="https://your-vault-ip:8200"
 * export VAULT_ROLE_ID="your-role-id"
 * export VAULT_SECRET_ID="your-secret-id"
 * export VAULT_SECRET_PATH="secret/data/models/gemini-flash"
 * Note: Use the bare-ai-agent git hub repo to simplify this vault integration.
 * Link: https://github.com/Cian-CloudIntCorp/bare-ai-agent
 */
import { spawn } from 'node:child_process';

// Internal routing bypass for self-signed Vault/Tailscale certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Global Config from Environment
const {
  VAULT_ADDR,
  VAULT_ROLE_ID,
  VAULT_SECRET_ID,
  VAULT_SECRET_PATH
} = process.env;

// Halt if mandatory security variables are missing
if (!VAULT_ROLE_ID || !VAULT_SECRET_ID || !VAULT_ADDR || !VAULT_SECRET_PATH) {
  console.error('[sovereign] ERROR: Missing Vault environment variables.');
  console.error('[sovereign] Ensure ADDR, ROLE_ID, SECRET_ID, and PATH are exported.');
  process.exit(1);
}

/**
 * Orchestrates Vault Auth and Config Retrieval
 * Returns both the configuration data and the temporary session token
 */
async function getVaultContext() {
  // 1. AppRole Login
  const loginRes = await fetch(`${VAULT_ADDR}/v1/auth/approle/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: VAULT_ROLE_ID, secret_id: VAULT_SECRET_ID }),
  });
  const loginData = await loginRes.json();
  if (!loginData.auth) throw new Error(`Vault login failed: ${JSON.stringify(loginData)}`);
  
  const token = loginData.auth.client_token;

  // 2. Fetch model config using the token
  const secretRes = await fetch(`${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`, {
    headers: { 'X-Vault-Token': token },
  });
  const secretData = await secretRes.json();
  if (!secretData?.data?.data) throw new Error(`Path ${VAULT_SECRET_PATH} returned no data.`);

  return { 
    config: secretData.data.data, 
    token: token 
  };
}

async function main() {
  try {
    console.error('[sovereign] Synchronizing with Vault...');
    const { config, token } = await getVaultContext();
    console.error('[sovereign] Vault context secured. Launching Bare AI CLI...\n');

    const secureEnv = {
      ...process.env,
      // Dynamic endpoint logic
      BARE_AI_ENDPOINT: config.base_url.includes('completions') || config.base_url.includes('messages') 
        ? config.base_url.trim() 
        : `${config.base_url.trim()}/v1/chat/completions`,
      
      BARE_AI_API_KEY: (config.api_key || 'none').trim(),
      BARE_AI_MODEL:   config.model_name.trim(),
      
      // Temporary token for mid-session hot-swapping
      VAULT_TOKEN: token,
      
      // Mock key to satisfy internal Google SDK checks
      GEMINI_API_KEY: 'bare-ai-local',
    };

    // SECURITY: Scrub master keys before spawning the child process
    delete secureEnv.VAULT_ROLE_ID;
    delete secureEnv.VAULT_SECRET_ID;

    // Dynamically inject the system prompt if the bash script provided one
    const spawnArgs = ['bundle/gemini.js', '--yolo'];
    if (process.env.BARE_AI_SYSTEM_PROMPT) {
        spawnArgs.push('--system-instruction', process.env.BARE_AI_SYSTEM_PROMPT);
    }
    
    // Append any extra arguments the user passed (like --model)
    spawnArgs.push(...process.argv.slice(2));

    const cli = spawn('node', spawnArgs, {
      stdio: 'inherit',
      env: secureEnv,
    });  

    cli.on('close', code => process.exit(code));
  } catch (err) {
    console.error('[sovereign] Security halt:', err.message);
    process.exit(1);
  }
}

main();
