/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Cloud Integration Corporation 
 * SPDX-License-Identifier: Apache-2.0
 */

/**
############################################################
#    ____ _                 _ _       _        ____        #
#   / ___| | ___  _   _  ___| (_)_ __ | |_     / ___|___   #
#  | |   | |/ _ \| | | |/ __| | | '_ \| __|   | |   / _ \  #
#  | |___| | (_) | |_| | (__| | | | | | |_    | |__| (_) | #
#   \____|_|\___/ \__,_|\___|_|_|_| |_|\__|    \____\___/  #
#                                                          #
#  client.ts customized                                    #
#  by Cloud Integration Corporation                        #
############################################################
*/

/**
 * Web Search Tool
 *
 * Search backend is selected at runtime via the BARE_AI_SEARCH_URL env var:
 *   - If set, uses a local SearXNG instance (sovereign, no data leaves network)
 *   - If unset, falls back to Google Search via the Gemini API (original behaviour)
 *
 * Set in your environment:
 *   export BARE_AI_SEARCH_URL="http://localhost:8080"   # local SearXNG
 *   export BARE_AI_SEARCH_URL="http://100.64.0.4:8080"  # remote SearXNG via Tailscale
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { WEB_SEARCH_TOOL_NAME } from './tool-names.js';
import type { GroundingMetadata } from '@google/genai';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import { type Config } from '../config/config.js';
import { getResponseText } from '../utils/partUtils.js';
import { debugLogger } from '../utils/debugLogger.js';
import { WEB_SEARCH_DEFINITION } from './definitions/coreTools.js';
import { resolveToolDeclaration } from './definitions/resolver.js';
import { LlmRole } from '../telemetry/llmRole.js';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
}

interface SearXNGResponse {
  results: SearXNGResult[];
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

class WebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  constructor(
    private readonly config: Config,
    params: WebSearchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  override getDescription(): string {
    const backend = process.env['BARE_AI_SEARCH_URL'] ? 'SearXNG' : 'Google';
    return `Searching the web for: "${this.params.query}" (via ${backend})`;
  }

  // -------------------------------------------------------------------------
  // SearXNG backend — used when BARE_AI_SEARCH_URL is set
  // -------------------------------------------------------------------------
  // Modified by Cloud Integration Corporation 2026
  // Original Google Search backend replaced with sovereign SearXNG integration.
  // Google fallback retained for non-sovereign deployments.
  
  private async executeViaSearXNG(signal: AbortSignal): Promise<WebSearchToolResult> {
    const searxngUrl = process.env['BARE_AI_SEARCH_URL']!;
    const encoded = encodeURIComponent(this.params.query);

    const response = await fetch(
      `${searxngUrl}/search?q=${encoded}&format=json`,
      { signal },
    );

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status}`);
    }

    const rawData: unknown = await response.json();
    if (
      typeof rawData !== 'object' ||
      rawData === null ||
      !('results' in rawData) ||
      !Array.isArray((rawData as { results: unknown }).results)
    ) {
      throw new Error('Unexpected response format from SearXNG');
    }
    const results = (rawData as SearXNGResponse).results;

    if (!results || results.length === 0) {
      return {
        llmContent: `No search results found for query: "${this.params.query}"`,
        returnDisplay: 'No results found.',
      };
    }

    // Lean pruning: top 5 results, title + url + snippet only
    const MAX_RESULTS = 5;
    const trimmed = results.slice(0, MAX_RESULTS);

    const formatted = trimmed
      .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content}`)
      .join('\n\n');

    const sources: GroundingChunkItem[] = trimmed.map(r => ({
      web: { uri: r.url, title: r.title },
    }));

    return {
      llmContent: `Web search results for "${this.params.query}":\n\n${formatted}`,
      returnDisplay: `Search results for "${this.params.query}" returned.`,
      sources,
    };
  }

  // -------------------------------------------------------------------------
  // Google / Gemini backend — original behaviour, used as fallback
  // -------------------------------------------------------------------------
  private async executeViaGoogle(signal: AbortSignal): Promise<WebSearchToolResult> {
    const geminiClient = this.config.getGeminiClient();

    const response = await geminiClient.generateContent(
      { model: 'web-search' },
      [{ role: 'user', parts: [{ text: this.params.query }] }],
      signal,
      LlmRole.UTILITY_TOOL,
    );

    const responseText = getResponseText(response);
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    const sources = groundingMetadata?.groundingChunks as GroundingChunkItem[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const groundingSupports = groundingMetadata?.groundingSupports as GroundingSupportItem[] | undefined;

    if (!responseText || !responseText.trim()) {
      return {
        llmContent: `No search results or information found for query: "${this.params.query}"`,
        returnDisplay: 'No information found.',
      };
    }

    let modifiedResponseText = responseText;
    const sourceListFormatted: string[] = [];

    if (sources && sources.length > 0) {
      sources.forEach((source: GroundingChunkItem, index: number) => {
        const title = source.web?.title || 'Untitled';
        const uri = source.web?.uri || 'No URI';
        sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
      });

      if (groundingSupports && groundingSupports.length > 0) {
        const insertions: Array<{ index: number; marker: string }> = [];
        groundingSupports.forEach((support: GroundingSupportItem) => {
          if (support.segment && support.groundingChunkIndices) {
            const citationMarker = support.groundingChunkIndices
              .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
              .join('');
            insertions.push({
              index: support.segment.endIndex,
              marker: citationMarker,
            });
          }
        });

        insertions.sort((a, b) => b.index - a.index);

        const encoder = new TextEncoder();
        const responseBytes = encoder.encode(modifiedResponseText);
        const parts: Uint8Array[] = [];
        let lastIndex = responseBytes.length;
        for (const ins of insertions) {
          const pos = Math.min(ins.index, lastIndex);
          parts.unshift(responseBytes.subarray(pos, lastIndex));
          parts.unshift(encoder.encode(ins.marker));
          lastIndex = pos;
        }
        parts.unshift(responseBytes.subarray(0, lastIndex));

        const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
        const finalBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
          finalBytes.set(part, offset);
          offset += part.length;
        }
        modifiedResponseText = new TextDecoder().decode(finalBytes);
      }

      if (sourceListFormatted.length > 0) {
        modifiedResponseText += '\n\nSources:\n' + sourceListFormatted.join('\n');
      }
    }

    return {
      llmContent: `Web search results for "${this.params.query}":\n\n${modifiedResponseText}`,
      returnDisplay: `Search results for "${this.params.query}" returned.`,
      sources,
    };
  }

  // -------------------------------------------------------------------------
  // Main entry point — routes to the appropriate backend
  // -------------------------------------------------------------------------
  async execute(signal: AbortSignal): Promise<WebSearchToolResult> {
    const useSearXNG = !!process.env['BARE_AI_SEARCH_URL'];

    debugLogger.log(
      `[WebSearchTool] Backend: ${useSearXNG ? `SearXNG (${process.env['BARE_AI_SEARCH_URL']})` : 'Google/Gemini'}`
    );

    try {
      return useSearXNG
        ? await this.executeViaSearXNG(signal)
        : await this.executeViaGoogle(signal);
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${
        this.params.query
      }": ${getErrorMessage(error)}`;
      debugLogger.warn(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }
}

/**
 * A tool to perform web searches.
 * Uses SearXNG when BARE_AI_SEARCH_URL is set, otherwise falls back to
 * Google Search via the Gemini API.
 */
export class WebSearchTool extends BaseDeclarativeTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name = WEB_SEARCH_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      WebSearchTool.Name,
      'WebSearch',
      WEB_SEARCH_DEFINITION.base.description!,
      Kind.Search,
      WEB_SEARCH_DEFINITION.base.parametersJsonSchema,
      messageBus,
      true,  // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  protected override validateToolParamValues(
    params: WebSearchToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: WebSearchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new WebSearchToolInvocation(
      this.config,
      params,
      messageBus ?? this.messageBus,
      _toolName,
      _toolDisplayName,
    );
  }

  override getSchema(modelId?: string) {
    return resolveToolDeclaration(WEB_SEARCH_DEFINITION, modelId);
  }
}
