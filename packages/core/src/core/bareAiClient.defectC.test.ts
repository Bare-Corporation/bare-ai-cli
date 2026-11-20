/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BareAiClient, type OpenAITool } from './bareAiClient.js';

/**
 * Row 562 defect C: completion cap, non-JSON upstream guard, dual auth header.
 *
 * Every case drives the real callApi() through a stubbed fetch and then asserts
 * on the request the client actually built (or the error it actually threw).
 * A stub that only returned a canned result would prove nothing about the code.
 */

const TOOL: OpenAITool = {
  type: 'function',
  function: { name: 'run_shell_command', description: 'Run a command.' },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let captured: Captured | null = null;
let jsonCalls = 0;

function jsonResponse(payload: unknown): object {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

function htmlFailure(status: number, statusText: string): object {
  return {
    ok: false,
    status,
    statusText,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'text/html' : null,
    },
    text: async () => '<html><body>cloudflare error</body></html>',
    // If the guard regresses and this is reached, the test must fail loudly
    // rather than quietly pass on a parse error.
    json: async () => {
      jsonCalls += 1;
      throw new Error('response.json() must not be called on an HTML body');
    },
  };
}

function jsonFailure(status: number, statusText: string): object {
  return {
    ok: false,
    status,
    statusText,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => '{"error":"invalid model"}',
    json: async () => ({ error: 'invalid model' }),
  };
}

/**
 * A 200 response with an immediately-empty stream. Non-tool turns take the
 * streaming path, so they need a readable body or the client throws before any
 * assertion about the request body can run.
 */
function streamResponse(): object {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
      }),
    },
    text: async () => '',
    json: async () => ({}),
  };
}

function stubFetch(response: object): void {
  captured = null;
  jsonCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      captured = {
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      };
      return response;
    }),
  );
}

const saved: Record<string, string | undefined> = {};
const KEYS = [
  'BARE_AI_ENDPOINT',
  'BARE_AI_API_KEY',
  'BARE_AI_MODEL',
  'BARE_AI_MAX_TOKENS',
  'BARE_AI_MAX_TOKENS_TOOLS',
  'BARE_AI_CONSTITUTION',
];

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // A constitution path that does not exist keeps the system prompt out of the
  // way so the assertions are about the request body, not prompt assembly.
  process.env['BARE_AI_CONSTITUTION'] = '/nonexistent/constitution.md';
  process.env['BARE_AI_ENDPOINT'] = 'https://gateway.example/v1';
  process.env['BARE_AI_API_KEY'] = 'test-key';
  process.env['BARE_AI_MODEL'] = 'test-model';
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('completion cap', () => {
  it('gives a tool-calling turn the tool cap, not the text cap', async () => {
    // Regression guard for row 581: capping a tool turn at the text default
    // truncates the arguments JSON, which surfaces as a schema failure
    // ("params must have required property 'command'") rather than as truncation.
    stubFetch(jsonResponse({ choices: [{ message: { content: 'hi' } }] }));
    const client = new BareAiClient();
    await client.generateContent('hello', [], [TOOL]);

    expect(captured).not.toBeNull();
    expect(captured?.body['max_tokens']).toBe(4096);
  });

  it('still caps a non-tool (streaming) turn at the text default', async () => {
    stubFetch(streamResponse());
    const client = new BareAiClient();
    await client.generateContent('hello', []);
    expect(captured?.body['max_tokens']).toBe(512);
  });

  it('honours BARE_AI_MAX_TOKENS_TOOLS for tool turns', async () => {
    process.env['BARE_AI_MAX_TOKENS_TOOLS'] = '2048';
    stubFetch(jsonResponse({ choices: [{ message: { content: 'hi' } }] }));
    const client = new BareAiClient();
    await client.generateContent('hello', [], [TOOL]);
    expect(captured?.body['max_tokens']).toBe(2048);
  });

  it('honours BARE_AI_MAX_TOKENS when it is a positive integer', async () => {
    process.env['BARE_AI_MAX_TOKENS'] = '128';
    stubFetch(streamResponse());
    const client = new BareAiClient();
    await client.generateContent('hello', []);

    expect(captured?.body['max_tokens']).toBe(128);
  });

  it('falls back to 512 when BARE_AI_MAX_TOKENS is not a positive integer', async () => {
    process.env['BARE_AI_MAX_TOKENS'] = 'not-a-number';
    stubFetch(streamResponse());
    const client = new BareAiClient();
    await client.generateContent('hello', []);

    expect(captured?.body['max_tokens']).toBe(512);
  });

  it('leaves the native Anthropic 4096 cap alone (control)', async () => {
    process.env['BARE_AI_ENDPOINT'] = 'https://api.anthropic.com/v1/messages';
    stubFetch(
      jsonResponse({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const client = new BareAiClient();
    // A tool keeps the request on the non-streaming path (useStream is false
    // whenever tools resolve), so the assertion does not depend on a fake
    // readable stream. Native mode drops the tool definitions itself.
    await client.generateContent('hello', [], [TOOL]);

    expect(captured?.body['max_tokens']).toBe(4096);
  });
});

describe('dual auth header', () => {
  it('sends both Authorization Bearer and X-API-Key', async () => {
    stubFetch(jsonResponse({ choices: [{ message: { content: 'hi' } }] }));
    const client = new BareAiClient();
    await client.generateContent('hello', [], [TOOL]);

    expect(captured?.headers['Authorization']).toBe('Bearer test-key');
    expect(captured?.headers['X-API-Key']).toBe('test-key');
  });
});

describe('non-JSON upstream guard', () => {
  it('reports the status instead of parsing an HTML 524', async () => {
    stubFetch(htmlFailure(524, 'A Timeout Occurred'));
    const client = new BareAiClient();

    await expect(client.generateContent('hello', [], [TOOL])).rejects.toThrow(
      /HTTP 524 A Timeout Occurred from https:\/\/gateway\.example\/v1\/chat\/completions/,
    );
    expect(jsonCalls).toBe(0);
  });

  it('names the proxy cause in the message', async () => {
    stubFetch(htmlFailure(502, 'Bad Gateway'));
    const client = new BareAiClient();

    await expect(client.generateContent('hello', [], [TOOL])).rejects.toThrow(
      /non-JSON body \(Cloudflare\/Gateway timeout or proxy error\)/,
    );
  });

  it('keeps the existing path for a JSON error body (control)', async () => {
    stubFetch(jsonFailure(500, 'Internal Server Error'));
    const client = new BareAiClient();

    await expect(client.generateContent('hello', [], [TOOL])).rejects.toThrow(
      /BareAiClient request failed \(500\)/,
    );
  });
});
