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

async function fetchVaultUpdate(id: string) {
  const addr = process.env['VAULT_ADDR'];
  const vaultToken = process.env['VAULT_TOKEN'];
  if (!addr || !vaultToken) throw new Error('Sovereign environment not initialized.');

  const path = `secret/data/tir-na-ai/${id}`;
  const res = await fetch(`${addr}/v1/${path}`, {
    headers: { 'X-Vault-Token': vaultToken },
  });
  const json: any = await res.json();
  if (!json?.data?.data) throw new Error(`Model ${id} not found in Vault.`);
  return json.data.data;
}

const setModelCommand: SlashCommand = {
  name: 'set',
  description:
    'Set the model to use. Usage: /model set <model-name> [--persist]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: 'Usage: /model set <model-name> [--persist]',
      });
      return;
    }

    const modelName = parts[0];
    const persist = parts.includes('--persist');

    if (context.services.config) {
      context.services.config.setModel(modelName, !persist);
      const event = new ModelSlashCommandEvent(modelName);
      logModelSlashCommand(context.services.config, event);

      context.ui.addItem({
        type: MessageType.INFO,
        text: `Model set to ${modelName}${persist ? ' (persisted)' : ''}`,
      });
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
    return {
      type: 'dialog',
      dialog: 'model',
    };
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
      context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Swapping to model ${id}...` });
      try {
        const config = await fetchVaultUpdate(id);
        
        process.env['BARE_AI_ENDPOINT'] = config.base_url.includes('completions') 
          ? config.base_url.trim() 
          : `${config.base_url.trim()}/v1/chat/completions`;
        process.env['BARE_AI_API_KEY'] = (config.api_key || 'none').trim();
        process.env['BARE_AI_MODEL'] = config.model_name.trim();

        context.services.config?.setModel(config.model_name.trim(), false);
        context.ui.addItem({ type: MessageType.INFO, text: `[sovereign] Hot-swap successful: ${config.model_name}` });
      } catch (err: any) {
        context.ui.addItem({ type: MessageType.ERROR, text: `[sovereign] Swap failed: ${err.message}` });
      }
      return;
    }
    return manageModelCommand.action!(context, args);
  },
};
