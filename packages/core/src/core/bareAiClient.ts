/**
 * BareAiClient - drop-in replacement for GeminiClient backend.
 * Talks to any OpenAI-compatible chat completions endpoint.
 */
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

export class BareAiClient {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private systemPrompt: string | null;

  constructor() {
    this.endpoint = process.env['BARE_AI_ENDPOINT'] ?? 'http://localhost:11434/v1/chat/completions';
    this.apiKey = process.env['BARE_AI_API_KEY'] ?? 'none';
    this.model = process.env['BARE_AI_MODEL'] ?? 'default';
    this.systemPrompt = this.loadConstitution();
  }

  private loadConstitution(): string | null {
    const constitutionPath = process.env['BARE_AI_CONSTITUTION']
      ?? `${process.env['HOME'] ?? '~'}/.bare-ai/constitution.md`;
    try {
      const content = require('fs').readFileSync(constitutionPath, 'utf8');
      process.stderr.write(`[bare-ai] Constitution loaded from ${constitutionPath}\n`);
      return content;
    } catch {
      return null;
    }
  }

  private async callApi(messages: Message[], tools?: OpenAITool[]): Promise<GenerateResult> {
    // Prepend system prompt if constitution exists
    const allMessages: Message[] = this.systemPrompt
      ? [{ role: 'system', content: this.systemPrompt }, ...messages]
      : messages;
    const body: Record<string, unknown> = { model: this.model, messages: allMessages };
    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BareAiClient request failed (${response.status}): ${text}`);
    }
    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
    };
    const message = data?.choices?.[0]?.message;
    return {
      text: message?.content ?? '',
      toolCalls: message?.tool_calls?.length ? message.tool_calls : undefined,
    };
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
      { role: 'tool', content: result, tool_call_id: toolCallId, name: toolName },
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
