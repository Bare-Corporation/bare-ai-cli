/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  tokenLimit,
  DEFAULT_TOKEN_LIMIT,
  DEEPSEEK_TOKEN_LIMIT,
  CLAUDE_TOKEN_LIMIT,
  GPT_TOKEN_LIMIT,
} from './tokenLimits.js';
import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  PREVIEW_GEMINI_MODEL,
} from '../config/models.js';

afterEach(() => {
  delete process.env['BARE_AI_CONTEXT_WINDOW'];
});

describe('tokenLimit', () => {
  it('should return the correct token limit for default models', () => {
    expect(tokenLimit(DEFAULT_GEMINI_MODEL)).toBe(1_048_576);
    expect(tokenLimit(DEFAULT_GEMINI_FLASH_MODEL)).toBe(1_048_576);
    expect(tokenLimit(DEFAULT_GEMINI_FLASH_LITE_MODEL)).toBe(1_048_576);
  });

  it('should return the correct token limit for preview models', () => {
    expect(tokenLimit(PREVIEW_GEMINI_MODEL)).toBe(1_048_576);
    expect(tokenLimit(PREVIEW_GEMINI_FLASH_MODEL)).toBe(1_048_576);
  });

  it('should return the default token limit for an unknown model', () => {
    expect(tokenLimit('unknown-model')).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it('should return the default token limit if no model is provided', () => {
    // @ts-expect-error testing invalid input
    expect(tokenLimit(undefined)).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it('should have the correct default token limit value', () => {
    expect(DEFAULT_TOKEN_LIMIT).toBe(1_048_576);
  });

  it('should map non-Gemini provider families to their context windows', () => {
    expect(tokenLimit('deepseek-v4-flash')).toBe(DEEPSEEK_TOKEN_LIMIT);
    expect(tokenLimit('claude-sonnet-4-6')).toBe(CLAUDE_TOKEN_LIMIT);
    expect(tokenLimit('gpt-4o')).toBe(GPT_TOKEN_LIMIT);
    expect(tokenLimit('o1-preview')).toBe(200_000);
  });

  it('should match provider prefixes case-insensitively', () => {
    expect(tokenLimit('DeepSeek-v4-flash')).toBe(DEEPSEEK_TOKEN_LIMIT);
    expect(tokenLimit('CLAUDE-sonnet-4-6')).toBe(CLAUDE_TOKEN_LIMIT);
  });

  it('should honour the BARE_AI_CONTEXT_WINDOW env override', () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '32768';
    expect(tokenLimit('deepseek-v4-flash')).toBe(32768);
    expect(tokenLimit(DEFAULT_GEMINI_MODEL)).toBe(32768);
  });

  it('should ignore a non-positive BARE_AI_CONTEXT_WINDOW override', () => {
    process.env['BARE_AI_CONTEXT_WINDOW'] = '0';
    expect(tokenLimit('deepseek-v4-flash')).toBe(DEEPSEEK_TOKEN_LIMIT);
  });
});
