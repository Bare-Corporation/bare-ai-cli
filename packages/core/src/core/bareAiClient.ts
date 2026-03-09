/**
 * BareAiClient - drop-in replacement for GeminiClient backend.
 * Talks to any OpenAI-compatible chat completions endpoint.
 *
 * Env vars:
 *   BARE_AI_ENDPOINT  (default: http://localhost:11434/v1/chat/completions)
 *   BARE_AI_API_KEY   (default: none)
 *   BARE_AI_MODEL     (default: default)
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class BareAiClient {
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor() {
    this.endpoint =
      process.env['BARE_AI_ENDPOINT'] ??
      'http://localhost:11434/v1/chat/completions';
    this.apiKey = process.env['BARE_AI_API_KEY'] ?? 'none';
    this.model = process.env['BARE_AI_MODEL'] ?? 'default';
  }

  async generateContent(
    prompt: string,
    history: Message[] = [],
  ): Promise<string> {
    const messages: Message[] = [
      ...history,
      { role: 'user', content: prompt },
    ];

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `BareAiClient request failed (${response.status}): ${text}`,
      );
    }

    const data: { choices?: Array<{ message?: { content?: string } }> } = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };

    return data?.choices?.[0]?.message?.content ?? '';
  }

  getChat() {
    const history: Message[] = [];
    return {
      sendMessage: async (prompt: string): Promise<string> => {
        const text = await this.generateContent(prompt, history);
        history.push({ role: 'user', content: prompt });
        history.push({ role: 'assistant', content: text });
        return text;
      },
      getHistory: (): Message[] => [...history],
    };
  }
}
