/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
  GEMMA_4_31B_IT_MODEL,
  GEMMA_4_26B_A4B_IT_MODEL,
  QWEN_3_8_FLASH_NEXT_MODEL,
} from '../config/models.js';

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;
export const GEMMA_4_TOKEN_LIMIT = 256_000;
export const QWEN_3_8_FLASH_NEXT_TOKEN_LIMIT = 131072; // matches .13 llama.cpp server n_ctx (128K)
export const DEEPSEEK_TOKEN_LIMIT = 131072; // DeepSeek-V3 class models advertise 128K
export const CLAUDE_TOKEN_LIMIT = 200_000;
export const GPT_TOKEN_LIMIT = 128_000;

export function tokenLimit(model: Model): TokenCount {
  // Explicit operator override wins over every built-in table. Set
  // BARE_AI_CONTEXT_WINDOW (tokens) when serving a model whose window the
  // prefixes below do not match (e.g. custom fleet builds).
  const envLimit = Number(process.env['BARE_AI_CONTEXT_WINDOW']);
  if (Number.isFinite(envLimit) && envLimit > 0) {
    return envLimit;
  }

  if (!model || typeof model !== 'string' || model.length === 0) {
    return DEFAULT_TOKEN_LIMIT;
  }

  // Non-Gemini families served via BareAiClient (BARE_AI_ENDPOINT). These are
  // approximate provider windows so the footer's context gauge reports a
  // sensible percentage instead of dividing against the 1M Gemini default.
  const lower = model.toLowerCase();
  if (lower.startsWith('deepseek-')) return DEEPSEEK_TOKEN_LIMIT;
  if (lower.startsWith('claude-')) return CLAUDE_TOKEN_LIMIT;
  if (lower.startsWith('gpt-')) return GPT_TOKEN_LIMIT;
  if (
    lower.startsWith('o1-') ||
    lower.startsWith('o3-') ||
    lower.startsWith('o4-')
  ) {
    return 200_000;
  }

  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models
  switch (model) {
    case QWEN_3_8_FLASH_NEXT_MODEL:
      return QWEN_3_8_FLASH_NEXT_TOKEN_LIMIT;
    case GEMMA_4_31B_IT_MODEL:
    case GEMMA_4_26B_A4B_IT_MODEL:
      return GEMMA_4_TOKEN_LIMIT;
    case PREVIEW_GEMINI_MODEL:
    case PREVIEW_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_MODEL:
    case DEFAULT_GEMINI_FLASH_MODEL:
    case DEFAULT_GEMINI_FLASH_LITE_MODEL:
      return 1_048_576;
    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
