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

interface OllamaResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
}

const isOllamaResponse = (obj: unknown): obj is OllamaResponse => typeof obj === 'object' && obj !== null;

// Safe Type Guard to satisfy the linter
function isRecordObj(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

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

  // 8b removed: models 8b and higher get full capabilities
  private readonly LEAN_TOOL_MODELS = ['tiny', 'small', 'mini', '1b', '3b'];

  private isNoToolModel(): boolean {
    return process.env['BARE_AI_NO_TOOLS'] === 'true';
  }

  constructor() {
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
    logDebug('Model configured as:', this.model);
    logDebug('Is Lean Mode active?', this.isLeanModel());
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

  private isLeanModel(): boolean {
    if (process.env['BARE_AI_LEAN_TOOLS'] === 'true') return true;
    if (process.env['BARE_AI_LEAN_TOOLS'] === 'false') return false;

    return this.LEAN_TOOL_MODELS.some((tag) =>
      this.model.toLowerCase().includes(tag),
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

        // Safe runtime checks instead of unsafe type assertions
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

        const result: OpenAITool = {
          type: 'function',
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

        return result;
      });
  }

  private async callApi(
    messages: Message[],
    tools?: OpenAITool[],
  ): Promise<GenerateResult> {
    const allMessages: Message[] = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }, ...messages]
      : messages;

    const resolvedTools =
      tools && tools.length > 0
        ? this.isLeanModel()
          ? this.stripTools(tools)
          : tools
        : undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: allMessages,
      stream: false,
      temperature: 0.1,
      ...(this.isLeanModel() && { options: { num_ctx: 8192 } }),
    };

    if (resolvedTools) {
      body['tools'] = resolvedTools;
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
