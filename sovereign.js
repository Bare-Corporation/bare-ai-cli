#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* global process, console, URL */
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
 * Link: https://github.com/Bare-Corporation/bare-ai-agent
 *
 * TLS: verification is ALWAYS enabled. For self-signed fleet endpoints
 * (Tailscale Vault, local llama-server) provide a CA bundle instead of
 * disabling verification:
 *   1. NODE_EXTRA_CA_CERTS=/path/to/ca.pem  (Node core; covers every TLS
 *      connection this process and its children make)
 *   2. BARE_AI_CA_CERT=/path/to/ca.pem      (this file; used for Vault calls)
 * We deliberately never set NODE_TLS_REJECT_UNAUTHORIZED=0.
 */
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';

function vaultAgent() {
  const caPath = process.env.BARE_AI_CA_CERT;
  if (caPath) {
    return new https.Agent({
      ca: [fs.readFileSync(caPath)],
      rejectUnauthorized: true,
    });
  }
  return new https.Agent({ rejectUnauthorized: true });
}

// Minimal JSON request helper (http/https) that keeps TLS verification on.
function vaultRequest(method, url, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(
      parsed,
      {
        method,
        headers,
        agent: parsed.protocol === 'https:' ? vaultAgent() : undefined,
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      },
    );
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

// Global Config from Environment
const { VAULT_ADDR, VAULT_ROLE_ID, VAULT_SECRET_ID, VAULT_SECRET_PATH } =
  process.env;

// Halt if mandatory security variables are missing
if (!VAULT_ROLE_ID || !VAULT_SECRET_ID || !VAULT_ADDR || !VAULT_SECRET_PATH) {
  console.error('[sovereign] ERROR: Missing Vault environment variables.');
  console.error(
    '[sovereign] Ensure ADDR, ROLE_ID, SECRET_ID, and PATH are exported.',
  );
  process.exit(1);
}

/**
 * Orchestrates Vault Auth and Config Retrieval
 * Returns both the configuration data and the temporary session token
 */
async function getVaultContext() {
  // 1. AppRole Login
  const loginRes = await vaultRequest(
    'POST',
    `${VAULT_ADDR}/v1/auth/approle/login`,
    { 'Content-Type': 'application/json' },
    { role_id: VAULT_ROLE_ID, secret_id: VAULT_SECRET_ID },
  );
  const loginData = loginRes.json;
  if (!loginData.auth)
    throw new Error(`Vault login failed: ${JSON.stringify(loginData)}`);

  const token = loginData.auth.client_token;

  // 2. Fetch model config using the token
  const secretRes = await vaultRequest(
    `${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`,
    {
      'X-Vault-Token': token,
    },
  );
  const secretData = secretRes.json;
  if (!secretData?.data?.data)
    throw new Error(`Path ${VAULT_SECRET_PATH} returned no data.`);

  return {
    config: secretData.data.data,
    token: token,
  };
}

async function main() {
  try {
    console.error('[sovereign] Synchronizing with Vault...');
    const { config, token } = await getVaultContext();
    console.error(
      '[sovereign] Vault context secured. Launching Bare AI CLI...\n',
    );

    const secureEnv = {
      ...process.env,
      // Dynamic endpoint logic
      BARE_AI_ENDPOINT:
        config.base_url.includes('completions') ||
        config.base_url.includes('messages')
          ? config.base_url.trim()
          : `${config.base_url.trim()}/v1/chat/completions`,

      BARE_AI_API_KEY: (config.api_key || 'none').trim(),
      BARE_AI_MODEL: config.model_name.trim(),

      // Temporary token for mid-session hot-swapping
      VAULT_TOKEN: token,

      // Mock key to satisfy internal Google SDK checks
      GEMINI_API_KEY: 'bare-ai-local',
    };

    // SECURITY: Scrub master keys before spawning the child process
    delete secureEnv.VAULT_ROLE_ID;
    delete secureEnv.VAULT_SECRET_ID;

    // Dynamically inject the system prompt if the bash script provided one
    const spawnArgs = ['bundle/bare-ai.js', '--yolo'];
    if (process.env.BARE_AI_SYSTEM_PROMPT) {
      spawnArgs.push('-i', process.env.BARE_AI_SYSTEM_PROMPT);
    }

    // Append any extra arguments the user passed (like --model)
    spawnArgs.push(...process.argv.slice(2));

    const cli = spawn('node', spawnArgs, {
      stdio: 'inherit',
      env: secureEnv,
    });

    cli.on('close', (code) => process.exit(code));
  } catch (err) {
    console.error('[sovereign] Security halt:', err.message);
    process.exit(1);
  }
}

main();
