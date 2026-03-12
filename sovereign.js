#!/usr/bin/env node
/**
 * sovereign.js — bare-ai-cli Vault credential injector
 * 
 * NEVER hardcode secrets here. Set these in your shell before running:
 *   export VAULT_ROLE_ID="your-role-id"
 *   export VAULT_SECRET_ID="your-secret-id"
 *
 * Optional overrides:
 *   VAULT_ADDR        (default: https://100.64.0.2:8200)
 *   VAULT_SECRET_PATH (default: secret/data/tir-na-ai/config)
 */
import { spawn } from 'node:child_process';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const VAULT_ADDR        = process.env.VAULT_ADDR        || 'https://100.64.0.2:8200';
const VAULT_SECRET_PATH = process.env.VAULT_SECRET_PATH || 'secret/data/tir-na-ai/config';
const VAULT_ROLE_ID     = process.env.VAULT_ROLE_ID;
const VAULT_SECRET_ID   = process.env.VAULT_SECRET_ID;

if (!VAULT_ROLE_ID || !VAULT_SECRET_ID) {
  console.error('[sovereign] ERROR: VAULT_ROLE_ID and VAULT_SECRET_ID must be exported in your shell.');
  console.error('[sovereign] Run: export VAULT_ROLE_ID="..." && export VAULT_SECRET_ID="..."');
  process.exit(1);
}

async function fetchVaultConfig() {
  const loginRes = await fetch(`${VAULT_ADDR}/v1/auth/approle/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_id: VAULT_ROLE_ID, secret_id: VAULT_SECRET_ID }),
  });
  const loginData = await loginRes.json();
  if (!loginData.auth) throw new Error(`Vault login failed: ${JSON.stringify(loginData)}`);

  const secretRes = await fetch(`${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`, {
    headers: { 'X-Vault-Token': loginData.auth.client_token },
  });
  const secretData = await secretRes.json();
  if (!secretData?.data?.data) throw new Error('Vault secret path returned no data');
  return secretData.data.data;
}

async function main() {
  try {
    console.error('[sovereign] Fetching credentials from Vault...');
    const config = await fetchVaultConfig();
    console.error('[sovereign] Credentials loaded. Launching bare-ai-cli...\n');

    const secureEnv = {
      ...process.env,
      BARE_AI_ENDPOINT: `${config.base_url.trim()}/v1/chat/completions`,
      BARE_AI_API_KEY:  config.api_key.trim(),
      BARE_AI_MODEL:    config.model_name.trim(),
      // Satisfies Google SDK constructor — actual routing bypassed
      GEMINI_API_KEY:   'bare-ai-local',
    };

    // Scrub Vault creds from child process
    delete secureEnv.VAULT_ROLE_ID;
    delete secureEnv.VAULT_SECRET_ID;

    const cli = spawn('node', ['bundle/gemini.js', ...process.argv.slice(2)], {
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
