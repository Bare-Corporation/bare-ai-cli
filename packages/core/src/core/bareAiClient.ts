/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

/**
############################################################
#    ____ _                 _ _       _        ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
#  BareAiClient * Drop-in replacement                      #
#                 for GeminiClient backend.                #
#                                                          #
#               * Talks to any OpenAI-compatible           #
#                 chat completions End point               #
#                                                          #
#               * Type Script                              #
#                 by Cloud Integration Corporation         #
############################################################
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface GenerateResult {
  text: string;
  toolCalls?: ToolCall[];
}

// Type guard for Ollama response
interface OllamaResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
}

const isOllamaResponse = (obj: unknown): obj is OllamaResponse => typeof obj === 'object' && obj !== null;

const logDebug = (...args: unknown[]) => {
  if (process.env['DEBUG_BARE_AI']) {
    const output = args
      .map((arg) =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg),
      )
      .join(' ');
    process.stderr.write('[bare-ai-debug] ' + output + '\n');
  }
};

const logError = (...args: unknown[]) => {
  process.stderr.write('[bare-ai] ❌ ' + args.map(String).join(' ') + '\n');
};

const logSuccess = (...args: unknown[]) => {
  process.stderr.write('[bare-ai] ✅ ' + args.map(String).join(' ') + '\n');
};

const logWarn = (...args: unknown[]) => {
  process.stderr.write('[bare-ai] ⚠️ ' + args.map(String).join(' ') + '\n');
};

export class BareAiClient {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private systemPrompt: string | null;

  constructor() {
    this.endpoint =
      process.env['BARE_AI_ENDPOINT'] ??
      'http://localhost:11434/v1/chat/completions';
    this.apiKey = process.env['BARE_AI_API_KEY'] ?? 'none';
    this.model = process.env['BARE_AI_MODEL'] ?? 'default';
    this.systemPrompt = this.loadConstitution();
  }

  private loadConstitution(): string | null {
    // Robust path resolution - handles ~ properly
    const rawPath =
      process.env['BARE_AI_CONSTITUTION'] ?? '~/.bare-ai/constitution.md';
    const resolvedPath = rawPath.startsWith('~')
      ? path.join(os.homedir(), rawPath.slice(1))
      : path.resolve(rawPath);

    try {
      if (fs.existsSync(resolvedPath)) {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        logSuccess(
          `Constitution loaded: ${resolvedPath} (${content.length} bytes)`,
        );
        return content;
      }
      logWarn(`Constitution not found at ${resolvedPath}`);
      return null;
    } catch (err) {
      logError(`Error loading constitution: ${err}`);
      return null;
    }
  }

  private async callApi(
    messages: Message[],
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    // Prepend system prompt if constitution exists
    const allMessages: Message[] = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }, ...messages]
      : messages;

    // Build request body with stream: false to prevent streaming issues
    const body: Record<string, unknown> = {
      model: this.model,
      messages: allMessages,
      stream: false, // CRITICAL: Disable streaming for reliable JSON parsing
      temperature: 0.0, // More deterministic responses
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }

    // Debug logging
    logDebug('Sending request to:', this.endpoint);
    logDebug('Request model:', this.model);
    logDebug('Messages count:', allMessages.length);
    logDebug('Tools count:', tools?.length ?? 0);

    logDebug('Full request body:', JSON.stringify(body, null, 2));

    const controller = new AbortController();
    const timeout = 180000; // Increased to 3 minutes for CPU-bound models
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timeoutId);
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `BareAiClient request timed out after ${timeout / 1000} seconds.`,
        );
      }
      logError('Fetch error:', error);
      throw error;
    }

    logDebug('Response status:', response.status);

    // Get response as text first for debugging
    const responseText = await response.text();

    logDebug('Raw response (first 500 chars):', responseText.substring(0, 500));

    if (!response.ok) {
      throw new Error(
        `BareAiClient request failed (${response.status}): ${responseText.substring(0, 200)}`,
      );
    }

    // Parse JSON response with type safety
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseError) {
      logError('Failed to parse JSON response:');
      logError(responseText.substring(0, 500));
      throw new Error(`Failed to parse Ollama response as JSON: ${parseError}`);
    }

    // Use type guard to safely access data
    if (!isOllamaResponse(parsedData)) {
      throw new Error('Invalid response format from Ollama');
    }

    const message = parsedData?.choices?.[0]?.message;
    const result = {
      text: message?.content ?? '',
      toolCalls: message?.tool_calls?.length ? message.tool_calls : undefined,
    };

    logDebug('Response parsed successfully');
    if (result.toolCalls) {
      logDebug(`Tool calls: ${result.toolCalls.length}`);
    } else {
      logDebug('Text response length:', result.text.length);
    }

    return result;
  }

  async generateContent(
    prompt: string,
    history: Message[] = [],
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    const messages: Message[] = [...history, { role: 'user', content: prompt }];
    return this.callApi(messages, tools);
  }

  async sendToolResult(
    history: Message[],
    toolCallId: string,
    toolName: string,
    result: string,
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    const messages: Message[] = [
      ...history,
      {
        role: 'tool',
        content: result,
        tool_call_id: toolCallId,
        name: toolName,
      },
    ];
    return this.callApi(messages, tools);
  }

  getChat() {
    const history: Message[] = [];
    return {
      sendMessage: async (prompt: string): Promise<string> => {
        const result = await this.generateContent(prompt, history);
        history.push({ role: 'user', content: prompt });
        history.push({ role: 'assistant', content: result.text });
        return result.text;
      },
      getHistory: (): Message[] => [...history],
    };
  }
}
