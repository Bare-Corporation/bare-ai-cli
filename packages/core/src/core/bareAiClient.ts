/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
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
#                 chat completions endpoint                #
#                                                          #
#               * Special handling for:                    #
#                 - Ollama (local, streaming + usage)      #
#                 - Gemini (Google OpenAI-compat layer)    #
#                 - Anthropic Claude (x-api-key headers)   #
#                 - DeepSeek, Mistral, xAI, Moonshot, etc  #
#                                                          #
#               * TypeScript                               #
#                 by Cloud Integration Corporation         #
############################################################
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// =============================================================================
// TYPES
// =============================================================================

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

interface OllamaResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
  usage?: UsageMetrics;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  usage?: UsageMetrics;
}

// =============================================================================
// ENDPOINT DETECTION
// Identifies the provider from the active endpoint URL so we can apply
// provider-specific header overrides and feature flags cleanly.
// =============================================================================

type EndpointProvider =
  | 'ollama'
  | 'anthropic'
  | 'gemini'
  | 'openai'
  | 'generic';

function detectProvider(endpoint: string): EndpointProvider {
  const url = endpoint.toLowerCase();
  if (url.includes('anthropic.com')) return 'anthropic';
  if (url.includes('googleapis.com')) return 'gemini';
  if (url.includes('openai.com')) return 'openai';
  if (
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('100.64.')
  ) {
    return 'ollama';
  }
  return 'generic';
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

function isOllamaResponse(obj: unknown): obj is OllamaResponse {
  return typeof obj === 'object' && obj !== null;
}

function isStreamChunk(obj: unknown): obj is StreamChunk {
  return typeof obj === 'object' && obj !== null;
}

function isRecordObj(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// =============================================================================
// FILE TRACER LOGGING
// Writes to a log file instead of stdout to avoid TUI interference.
// Enable verbose debug output by setting DEBUG_BARE_AI=true.
// =============================================================================

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
    // Intentionally silent — never interfere with the TUI
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

// =============================================================================
// BARE-AI CLIENT
// =============================================================================

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
    logDebug('BareAiClient Initialized (Multi-Provider Routing Enabled)');
  }

  // ---------------------------------------------------------------------------
  // CONSTITUTION LOADER
  // Loads the system prompt from the path set in BARE_AI_CONSTITUTION.
  // Falls back gracefully if the file is missing.
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // MODEL CAPABILITY FLAGS
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // TOOL STRIPPING
  // Lean models get a reduced tool set with stripped descriptions to save
  // context window space.
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // HEADER BUILDER
  // Constructs the correct headers for each provider.
  //
  // Provider matrix:
  //   Ollama / Generic  → Authorization: Bearer <key>
  //   OpenAI / Gemini   → Authorization: Bearer <key>
  //   Anthropic Claude  → Authorization: Bearer <key>   (OpenAI compat layer)
  //                     + x-api-key: <key>              (required by Anthropic)
  //                     + anthropic-version: 2023-06-01  (required by Anthropic)
  //
  // NOTE: Anthropic's OpenAI-compatible endpoint still requires x-api-key and
  // anthropic-version even when using Bearer auth. Without these the API
  // returns a 404 Not Found despite the request physically reaching Anthropic's
  // servers (the request_id in the error body confirms this).
  // ---------------------------------------------------------------------------

  private buildHeaders(
    provider: EndpointProvider,
    apiKey: string,
  ): Record<string, string> {
    const base: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (provider === 'anthropic') {
      base['x-api-key'] = apiKey;
      base['anthropic-version'] = '2023-06-01';
    }

    return base;
  }

  // ---------------------------------------------------------------------------
  // REQUEST BODY BUILDER
  // Constructs the request body with provider-specific feature flags.
  //
  // stream_options.include_usage:
  //   Supported by Ollama — sends token counts on the final streaming chunk.
  //   NOT sent to Anthropic or other cloud endpoints to avoid compatibility
  //   issues.
  //
  // options.num_ctx:
  //   Ollama-specific context window override for lean local models.
  //   Not sent to cloud endpoints.
  // ---------------------------------------------------------------------------

  private buildRequestBody(
    provider: EndpointProvider,
    activeModel: string,
    allMessages: Message[],
    resolvedTools: OpenAITool[] | undefined,
    useStream: boolean,
  ): Record<string, unknown> {
    const isOllama = provider === 'ollama';

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: allMessages,
      stream: useStream,
      temperature: 0.1,
    };

    // stream_options: Ollama only — sends usage metrics on final streaming chunk
    if (useStream && isOllama) {
      body['stream_options'] = { include_usage: true };
    }

    // num_ctx: Ollama-specific context window cap for lean local models
    if (this.isLeanModel() && isOllama) {
      body['options'] = { num_ctx: 8192 };
    }

    // Attach tools if applicable
    if (resolvedTools) {
      body['tools'] = resolvedTools;
    }

    logDebug(
      `Request body built for provider [${provider}]`,
      `| stream=${useStream}`,
      `| stream_options=${isOllama && useStream ? 'yes' : 'no'}`,
      `| tools=${resolvedTools ? resolvedTools.length : 0}`,
    );

    return body;
  }

  // ---------------------------------------------------------------------------
  // TELEMETRY WRITER
  // Writes token usage to stdout in a dimmed colour. Visible in the terminal
  // scroll buffer but does not break the TUI render cycle.
  // ---------------------------------------------------------------------------

  private writeTelemetry(
    activeModel: string,
    mode: 'Stream' | 'Static',
    metrics: UsageMetrics,
  ): void {
    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      total_tokens,
    } = metrics;
    const total = total_tokens ?? prompt_tokens + completion_tokens;
    process.stdout.write(
      `\n\x1b[90m[Telemetry | Engine: ${activeModel} | Mode: ${mode}] ` +
        `Tokens: ${total} (Prompt: ${prompt_tokens}, Completion: ${completion_tokens})\x1b[0m\n`,
    );
  }

  // ---------------------------------------------------------------------------
  // CORE API CALL
  // Routes the request to the active endpoint, handles streaming and static
  // responses, and returns a normalised GenerateResult.
  // ---------------------------------------------------------------------------

  private async callApi(
    messages: Message[],
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    const activeEndpoint =
      process.env['BARE_AI_ENDPOINT'] ??
      'http://localhost:11434/v1/chat/completions';
    const activeApiKey = process.env['BARE_AI_API_KEY'] ?? 'none';
    const activeModel = process.env['BARE_AI_MODEL'] ?? 'default';

    // Detect provider from endpoint URL for header/feature branching
    const provider = detectProvider(activeEndpoint);

    // Prepend system prompt if we have one
    const allMessages: Message[] = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }, ...messages]
      : messages;

    // Resolve tool set based on model capability flags
    const resolvedTools =
      tools && tools.length > 0
        ? this.isNoToolModel()
          ? undefined
          : this.isLeanModel()
            ? this.stripTools(tools)
            : tools
        : undefined;

    // Tools require a non-streaming call (Doer models — Granite, Qwen Coder)
    const useStream = !resolvedTools;

    const body = this.buildRequestBody(
      provider,
      activeModel,
      allMessages,
      resolvedTools,
      useStream,
    );

    const headers = this.buildHeaders(provider, activeApiKey);

    logDebug(`Routing to [${provider}] at: ${activeEndpoint}`);
    logDebug(`Model: ${activeModel} | Stream: ${useStream}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000);

    try {
      const response = await fetch(activeEndpoint, {
        signal: controller.signal,
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        logError(`API Failed (${response.status}):`, errText);
        throw new Error(
          `BareAiClient request failed (${response.status}): ${errText.substring(0, 500)}`,
        );
      }

      // -----------------------------------------------------------------------
      // NON-STREAMING PATH
      // Used when tools are active (Doer models — Granite, Qwen Coder, etc.)
      // -----------------------------------------------------------------------
      if (!useStream) {
        const parsedData: unknown = await response.json();

        if (!isOllamaResponse(parsedData)) {
          throw new Error('Invalid response format from API');
        }

        if (parsedData.usage) {
          this.writeTelemetry(activeModel, 'Static', parsedData.usage);
        }

        const message = parsedData.choices?.[0]?.message;
        return {
          text: message?.content ?? '',
          toolCalls: message?.tool_calls?.length
            ? message.tool_calls
            : undefined,
        };
      }

      // -----------------------------------------------------------------------
      // STREAMING PATH
      // Used for conversational models (Thinkers — DeepSeek, Gemma, Claude, etc.)
      // -----------------------------------------------------------------------
      if (!response.body) {
        throw new Error('ReadableStream not supported in this environment.');
      }

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

            // Capture usage metrics from the final chunk.
            // Ollama sends these when stream_options.include_usage is set.
            // Anthropic does not send usage in the stream — finalMetrics stays
            // null for Claude, which is handled gracefully below.
            if (parsed.usage) {
              finalMetrics = parsed.usage;
            }
          } catch (_e) {
            logDebug('Failed to parse streaming chunk:', dataStr);
          }
        }
      }

      // Write telemetry if metrics were received (Ollama and some generic providers)
      // Anthropic does not send streaming usage — just write a newline for clean output
      if (finalMetrics) {
        this.writeTelemetry(activeModel, 'Stream', finalMetrics);
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

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------

  async generateContent(
    prompt: string,
    history: Message[] = [],
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    const messages: Message[] = [
      ...history,
      { role: 'user', content: prompt },
    ];
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
