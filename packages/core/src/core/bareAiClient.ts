/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 * @license
 */

/**
############################################################
#    ____ _                  _ _       ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_      / ___|___   #
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

interface UsageMetrics {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

// usage field added here so both streaming and static paths
// can read token counts without any unsafe casts
interface OllamaResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  usage?: UsageMetrics;
}

// Typed shape for SSE stream chunks — eliminates the `any` chain from JSON.parse
interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  usage?: UsageMetrics;
}

const isOllamaResponse = (obj: unknown): obj is OllamaResponse =>
  typeof obj === 'object' && obj !== null;

const isStreamChunk = (obj: unknown): obj is StreamChunk =>
  typeof obj === 'object' && obj !== null;

function isRecordObj(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// --- FILE TRACER LOGGING (Bypasses the TUI) ---
const TRACE_LOG = path.join(
  os.homedir(),
  '.bare-ai',
  'logs',
  'bare-ai-trace.log',
);

const writeTrace = (prefix: string, ...args: unknown[]): void => {
  const output = args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg),
    )
    .join(' ');
  const timestamp = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(TRACE_LOG), { recursive: true });
    fs.appendFileSync(TRACE_LOG, `[${timestamp}] ${prefix} ${output}\n`);
  } catch (_e) {
    // Silence is intentional to prevent TUI interference
  }
};

const logDebug = (...args: unknown[]): void => {
  if (process.env['DEBUG_BARE_AI']) writeTrace('[DEBUG]', ...args);
};
const logError = (...args: unknown[]): void =>
  writeTrace('[ERROR] ❌', ...args);
const logSuccess = (...args: unknown[]): void =>
  writeTrace('[SUCCESS] ✅', ...args);
const logWarn = (...args: unknown[]): void => writeTrace('[WARN] ⚠️', ...args);
// ----------------------------------------------

export class BareAiClient {
  private systemPrompt: string | null;
  private readonly LEAN_TOOL_MODELS = ['tiny', 'small', 'mini', '1b', '3b'];

  constructor() {
    try {
      fs.mkdirSync(path.dirname(TRACE_LOG), { recursive: true });
      fs.writeFileSync(TRACE_LOG, '--- STARTING BARE-AI SESSION ---\n');
    } catch (_e) {
      /* ignore */
    }
    this.systemPrompt = this.loadConstitution();
    logDebug('BareAiClient Initialized (Dynamic Switchboard Routing Enabled)');
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

  private isNoToolModel(): boolean {
    return process.env['BARE_AI_NO_TOOLS'] === 'true';
  }

  private isLeanModel(): boolean {
    if (process.env['BARE_AI_LEAN_TOOLS'] === 'true') return true;
    if (process.env['BARE_AI_LEAN_TOOLS'] === 'false') return false;
    const currentModel = process.env['BARE_AI_MODEL'] ?? 'default';
    return this.LEAN_TOOL_MODELS.some((tag) =>
      currentModel.toLowerCase().includes(tag),
    );
  }

  private stripTools(tools: OpenAITool[]): OpenAITool[] {
    const essentialTools = [
      'run_shell_command',
      'read_file',
      'write_file',
      'list_directory',
      'google_web_search',
      'web_fetch',
    ];
    return tools
      .filter((tool) => essentialTools.includes(tool.function.name))
      .map((tool) => {
        const params = tool.function.parameters;
        const leanProps: Record<string, { type: string }> = {};
        let required: string[] = [];

        if (isRecordObj(params)) {
          const reqArr = params['required'];
          if (Array.isArray(reqArr)) {
            required = reqArr
              .filter((item) => typeof item === 'string')
              .map(String);
          }
          const props = params['properties'];
          if (isRecordObj(props)) {
            for (const key of required) {
              const propVal = props[key];
              if (isRecordObj(propVal)) {
                const typeVal = propVal['type'];
                leanProps[key] = {
                  type: typeof typeVal === 'string' ? typeVal : 'string',
                };
              }
            }
          }
        }

        return {
          type: 'function' as const,
          function: {
            name: tool.function.name,
            description:
              typeof tool.function.description === 'string'
                ? tool.function.description.split('.')[0]
                : undefined,
            parameters:
              required.length > 0
                ? { type: 'object', properties: leanProps, required }
                : { type: 'object', properties: {} },
          },
        };
      });
  }

  private async callApi(
    messages: Message[],
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    const activeEndpoint =
      process.env['BARE_AI_ENDPOINT'] ??
      'http://localhost:11434/v1/chat/completions';
    const activeApiKey = process.env['BARE_AI_API_KEY'] ?? 'none';
    const activeModel = process.env['BARE_AI_MODEL'] ?? 'default';

    const allMessages: Message[] = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }, ...messages]
      : messages;

    const resolvedTools =
      tools && tools.length > 0
        ? this.isNoToolModel()
          ? undefined
          : this.isLeanModel()
            ? this.stripTools(tools)
            : tools
        : undefined;

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: allMessages,
      stream: true,
      temperature: 0.1,
      ...(this.isLeanModel() &&
        !(activeEndpoint || '').match(/googleapis|openai/i) && {
          options: { num_ctx: 8192 },
        }),
    };

    if (resolvedTools) {
      body['tools'] = resolvedTools;
      body['stream'] = false;
    }

    logDebug(
      `Routing Request to [${activeModel}] at endpoint:`,
      activeEndpoint,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      const response = await fetch(activeEndpoint, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeApiKey}`,
        },
        body: JSON.stringify(body),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        logError(`API Failed (${response.status}):`, errText);
        throw new Error(
          `BareAiClient request failed (${response.status}): ${errText.substring(0, 200)}`,
        );
      }

      // --- NON-STREAMING: tool calls active (Doer models e.g. Granite) ---
      if (!body['stream']) {
        const parsedData: unknown = await response.json();

        if (!isOllamaResponse(parsedData))
          throw new Error('Invalid response format from API');

        // Telemetry for static responses — usage is typed directly on
        // OllamaResponse so no cast or `any` is needed here
        if (parsedData.usage) {
          const {
            prompt_tokens = 0,
            completion_tokens = 0,
            total_tokens,
          } = parsedData.usage;
          const total = total_tokens ?? prompt_tokens + completion_tokens;
          process.stdout.write(
            `\n\x1b[90m[Telemetry | Engine: ${activeModel} | Mode: Static] Tokens: ${total} (Prompt: ${prompt_tokens}, Completion: ${completion_tokens})\x1b[0m\n`,
          );
        }

        const message = parsedData.choices?.[0]?.message;
        return {
          text: message?.content ?? '',
          toolCalls: message?.tool_calls?.length
            ? message.tool_calls
            : undefined,
        };
      }

      // --- REAL-TIME STREAMING: no tools active (Thinker models) ---
      if (!response.body)
        throw new Error('ReadableStream not supported in this environment.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let finalMetrics: UsageMetrics | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split('\n')
          .filter((line) => line.trim().startsWith('data: '));

        for (const line of lines) {
          const dataStr = line.replace('data: ', '').trim();
          if (dataStr === '[DONE]') continue;

          try {
            const parsed: unknown = JSON.parse(dataStr);

            if (!isStreamChunk(parsed)) continue;

            const deltaContent = parsed.choices?.[0]?.delta?.content ?? '';
            if (deltaContent) {
              fullText += deltaContent;
              process.stdout.write(deltaContent);
            }

            if (parsed.usage) {
              finalMetrics = parsed.usage;
            }
          } catch (_e) {
            logDebug('Failed to parse streaming chunk:', dataStr);
          }
        }
      }

      // Telemetry for streaming responses
      if (finalMetrics) {
        const {
          prompt_tokens = 0,
          completion_tokens = 0,
          total_tokens,
        } = finalMetrics;
        const total = total_tokens ?? prompt_tokens + completion_tokens;
        process.stdout.write(
          `\n\n\x1b[90m[Telemetry | Engine: ${activeModel} | Mode: Stream] Tokens: ${total} (Prompt: ${prompt_tokens}, Completion: ${completion_tokens})\x1b[0m\n`,
        );
      } else {
        process.stdout.write('\n');
      }

      logSuccess('Streaming response completed successfully');
      return { text: fullText };
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

  getChat(): {
    sendMessage: (prompt: string) => Promise<string>;
    getHistory: () => Message[];
  } {
    const history: Message[] = [];
    return {
      sendMessage: async (prompt: string): Promise<string> => {
        const result = await this.generateContent(prompt, history);
        history.push(
          { role: 'user', content: prompt },
          { role: 'assistant', content: result.text },
        );
        return result.text;
      },
      getHistory: (): Message[] => [...history],
    };
  }
}
