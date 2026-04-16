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
 * modelCommand.ts — bare-ai-cli Vault credential injector
 * implements a Sovereign Switchboard for hot-swapping ai models.
 * @license
 * Copyright 2026 Cloud Integration Corporation
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * modelCommand.ts — bare-ai-cli Vault credential injector
 * implements a Sovereign Switchboard for hot-swapping ai models.
 */
import {
  ModelSlashCommandEvent,
  logModelSlashCommand,
} from '@bare-ai/core';
import {
  type CommandContext,
  CommandKind,
  type SlashCommand,
} from './types.js';
import { MessageType } from '../types.js';

async function fetchVaultUpdate(modelName: string) {
  const addr = process.env['VAULT_ADDR'];
  const vaultToken = process.env['VAULT_TOKEN'];
  if (!addr || !vaultToken) throw new Error('Sovereign environment not initialized.');

  // Aligned with the vault paths set in setup_bare-ai-worker.sh
  const path = `secret/data/${modelName}/config`;
  const res = await fetch(`${addr}/v1/${path}`, {
    headers: { 'X-Vault-Token': vaultToken },
  });
  const json: any = await res.json();
  if (!json?.data?.data) throw new Error(`Model configuration not found at Vault path: ${path}`);
  return json.data.data;
}

const setModelCommand: SlashCommand = {
  name: 'set',
  description: 'Set the model to use. Usage: /model set <model-name> [--persist]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      context.ui.addItem({ type: MessageType.ERROR, text: 'Usage: /model set <model-name> [--persist]' });
      return;
    }
    const modelName = parts[0];
    const persist = parts.includes('--persist');
    if (context.services.config) {
      context.services.config.setModel(modelName, !persist);
      const event = new ModelSlashCommandEvent(modelName);
      logModelSlashCommand(context.services.config, event);
      context.ui.addItem({ type: MessageType.INFO, text: `Model set to ${modelName}${persist ? ' (persisted)' : ''}` });
    }
  },
};

const manageModelCommand: SlashCommand = {
  name: 'manage',
  description: 'Opens a dialog to configure the model',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    if (context.services.config) {
      await context.services.config.refreshUserQuota();
    }
    return { type: 'dialog', dialog: 'model' };
  },
};

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Manage model configuration or switch via Sovereign ID (e.g., /model 101)',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [manageModelCommand, setModelCommand],
  action: async (context: CommandContext, args: string) => {
    const id = args.trim();
    
    // Pattern Match: 3-digit Sovereign ID
    if (/^\d{3}$/.test(id)) {
      context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Translating ID ${id}...` });
      
      let targetModel = "";
      let disableTools = true;

      switch (id) {
        // Thinkers (No Tools)
        case '001': targetModel = "deepseek-r1:8b"; break;
        case '002': targetModel = "tir-na-ai:latest"; break;
        case '009': targetModel = "tir-na-ai:iGPU"; break;
        case '101': targetModel = "gemini-2.5-flash-lite"; break;
        case '203': targetModel = "o1-preview"; break;
        
        // Doers (Tools Enabled)
        case '003': targetModel = "gemma4:e4b"; disableTools = false; break;
        case '004': targetModel = "gemma4:26b"; disableTools = false; break;
        case '005': targetModel = "gemma4:31b"; disableTools = false; break;
        case '006': targetModel = "granite4:tiny-h"; disableTools = false; break;
        case '007': targetModel = "qwen2.5-coder:32b"; disableTools = false; break;
        case '008': targetModel = "deepseek-coder-v2:latest"; disableTools = false; break;
        case '102': targetModel = "gemini-2.5-flash"; disableTools = false; break;
        case '103': targetModel = "gemini-2.5-pro"; disableTools = false; break;
        case '104': targetModel = "gemini-3-flash-preview"; disableTools = false; break;
        case '105': targetModel = "gemini-3.1-pro-preview"; disableTools = false; break;
        case '201': targetModel = "gpt-4o"; disableTools = false; break;
        case '202': targetModel = "gpt-4-turbo"; disableTools = false; break;
        
        default:
          context.ui.addItem({ type: MessageType.ERROR, text: `[sovereign] Invalid ID: ${id}` });
          return;
      }

      context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Swapping to model ${targetModel}...` });

      try {
        const config = await fetchVaultUpdate(targetModel);
        
        process.env['BARE_AI_ENDPOINT'] = config.base_url.includes('completions') 
          ? config.base_url.trim() 
          : `${config.base_url.trim()}/v1/chat/completions`;
        process.env['BARE_AI_API_KEY'] = (config.api_key || 'none').trim();
        process.env['BARE_AI_MODEL'] = config.model_name.trim();

        // Cure the 400 Tool Crash
        if (disableTools) {
          process.env['BARE_AI_NO_TOOLS'] = "true";
          context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Pure Reasoning mode engaged (Tools disabled).` });
        } else {
          process.env['BARE_AI_NO_TOOLS'] = "false";
        }

        context.services.config?.setModel(config.model_name.trim(), false);
        context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Hot-swap successful.` });

      } catch (err: any) {
        context.ui.addItem({ type: MessageType.ERROR, text: `[sovereign] Swap failed: ${err.message}` });
      }
      return;
    }
    return manageModelCommand.action!(context, args);
  },
};
