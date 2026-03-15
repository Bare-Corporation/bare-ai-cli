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

// --- FILE TRACER LOGGING (Bypasses the TUI) ---
const TRACE_LOG = path.join(process.cwd(), 'bare-ai-trace.log');

const writeTrace = (prefix: string, ...args: unknown[]) => {
  const output = args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg),
    )
    .join(' ');
  const timestamp = new Date().toISOString();

  try {
    fs.appendFileSync(TRACE_LOG, `[${timestamp}] ${prefix} ${output}\n`);
  } catch (_e) {
    // Silence is intentional to prevent TUI interference
  }
};

const logDebug = (...args: unknown[]) => {
  if (process.env['DEBUG_BARE_AI']) {
    writeTrace('[DEBUG]', ...args);
  }
};

const logError = (...args: unknown[]) => writeTrace('[ERROR] ❌', ...args);
const logSuccess = (...args: unknown[]) => writeTrace('[SUCCESS] ✅', ...args);
const logWarn = (...args: unknown[]) => writeTrace('[WARN] ⚠️', ...args);
// ----------------------------------------------

export class BareAiClient {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private systemPrompt: string | null;

  constructor() {
    // Reset the trace log on startup
    try {
      fs.writeFileSync(TRACE_LOG, '--- STARTING BARE-AI SESSION ---\n');
    } catch (_e) {
      /* ignore */
    }

    this.endpoint =
      process.env['BARE_AI_ENDPOINT'] ??
      'http://localhost:11434/v1/chat/completions';
    this.apiKey = process.env['BARE_AI_API_KEY'] ?? 'none';
    this.model = process.env['BARE_AI_MODEL'] ?? 'default';
    this.systemPrompt = this.loadConstitution();

    logDebug('BareAiClient Initialized with endpoint:', this.endpoint);
  }

  private loadConstitution(): string | null {
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
    const allMessages: Message[] = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }, ...messages]
      : messages;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: allMessages,
      stream: false,
      temperature: 0.1,
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      //Remove tool_choice entirely for Granite by commenting out auto
      // body['tool_choice'] = 'auto';
    }

    logDebug('Sending Request Body:', body);

    const controller = new AbortController();
    const timeout = 180000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.endpoint, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timeoutId);

      logDebug('Response received. Status:', response.status);

      const responseText = await response.text();
      logDebug('Raw Response Data:', responseText);

      if (!response.ok) {
        logError(`API Failed (${response.status}):`, responseText);
        throw new Error(
          `BareAiClient request failed (${response.status}): ${responseText.substring(0, 200)}`,
        );
      }

      const parsedData: unknown = JSON.parse(responseText);

      if (!isOllamaResponse(parsedData)) {
        logError('Ollama response failed type guard');
        throw new Error('Invalid response format from Ollama');
      }

      const message = parsedData?.choices?.[0]?.message;
      const result = {
        text: message?.content ?? '',
        toolCalls: message?.tool_calls?.length ? message.tool_calls : undefined,
      };

      logSuccess('Response parsed successfully');
      return result;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      logError('Critical API Failure:', error);
      throw error;
    }
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
