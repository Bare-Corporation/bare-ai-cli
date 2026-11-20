/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Bare-AI fork notice: new code in this fork, distributed under Apache-2.0
// (see LICENSE and NOTICE). Copyright 2026 Cloud Integration Corporation LLC.

/**
 * Regression tests for the Council transcript-corruption defects reported
 * against job fdb8e08c-77f3-43b7-9f42-bd73bd90745e:
 *
 *   Defect 1 - chunk-boundary truncation: a streaming delta whose JSON payload
 *              straddles a network read boundary was dropped, so words arrived
 *              chopped ("conflates" -> "confl", "Commission" -> " ").
 *   Defect 2 - accumulator duplication: a streamed turn was echoed to stdout
 *              AND re-emitted as the aggregated result, printing the whole
 *              answer twice.
 *
 * These tests drive the exact primitives the client uses
 * (SseLineBuffer / parseSseDataLine / shouldEmitFinalText) and reproduce BOTH
 * the broken and the fixed behaviour, so a regression fails loudly.
 */

import { describe, it, expect } from 'vitest';
import {
  SseLineBuffer,
  parseSseDataLine,
  shouldEmitFinalText,
  type GenerateResult,
} from './bareAiClient.js';

const NL = String.fromCharCode(10);

// One OpenAI-compatible streaming frame, exactly as a provider emits on wire.
function frame(content: string): string {
  return (
    'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + NL + NL
  );
}

interface OpenAiDelta {
  choices?: Array<{ delta?: { content?: string } }>;
}

// Reconstructs text exactly as the FIXED generic stream loop does.
function bufferedExtract(rawChunks: string[]): string {
  const buffer = new SseLineBuffer();
  let text = '';
  const handle = (lines: string[]): void => {
    for (const line of lines) {
      const dataStr = parseSseDataLine(line);
      if (dataStr === null || dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr) as OpenAiDelta;
        text += parsed.choices?.[0]?.delta?.content ?? '';
      } catch {
        // Buffered lines are only parsed once complete, so this never fires.
      }
    }
  };
  for (const chunk of rawChunks) handle(buffer.push(chunk));
  handle(buffer.flush());
  return text;
}

// Reproduces the OLD generic stream loop: parse each raw chunk in isolation.
function naiveExtract(rawChunks: string[]): string {
  let text = '';
  for (const chunk of rawChunks) {
    const lines = chunk
      .split(NL)
      .filter((line) => line.trim().startsWith('data: '));
    for (const line of lines) {
      const dataStr = line.replace('data: ', '').trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr) as OpenAiDelta;
        text += parsed.choices?.[0]?.delta?.content ?? '';
      } catch {
        /* dropped, exactly as the buggy client did */
      }
    }
  }
  return text;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// --- Defect 1: chunk-boundary truncation -------------------------------------

describe('Defect 1 - SSE buffering across chunk boundaries', () => {
  // Deliberately split inside real words, mirroring the reported symptoms.
  const tokens = [
    'The Council confl',
    'ates adequacy',
    ' with Commission scope.',
  ];
  const answer = tokens.join('');
  const rawStream = tokens.map(frame).join('') + 'data: [DONE]' + NL + NL;

  it('drops text when each network read is parsed in isolation (the bug)', () => {
    const splitAt = Math.floor(rawStream.length / 2);
    const chunks = [rawStream.slice(0, splitAt), rawStream.slice(splitAt)];
    expect(naiveExtract(chunks)).not.toBe(answer);
  });

  it('re-assembles every token when a read splits the JSON payload', () => {
    const splitAt = Math.floor(rawStream.length / 2);
    const chunks = [rawStream.slice(0, splitAt), rawStream.slice(splitAt)];
    expect(bufferedExtract(chunks)).toBe(answer);
  });

  it('survives a boundary that splits the "data:" prefix itself', () => {
    const chunks = [
      rawStream.slice(0, 3),
      rawStream.slice(3, 4),
      rawStream.slice(4),
    ];
    expect(bufferedExtract(chunks)).toBe(answer);
  });

  it('survives one-character-at-a-time fragmentation', () => {
    expect(bufferedExtract(rawStream.split(''))).toBe(answer);
  });

  it('buffers a final frame that arrives without a trailing newline', () => {
    const partial = frame('conflates').trimEnd();
    const buffer = new SseLineBuffer();
    expect(buffer.push(partial)).toEqual([]); // nothing complete yet
    expect(buffer.flush().map(parseSseDataLine)).toEqual([
      JSON.stringify({ choices: [{ delta: { content: 'conflates' } }] }),
    ]);
  });

  it('ignores non-data SSE lines (event:, comments, blanks)', () => {
    const buffer = new SseLineBuffer();
    const lines = buffer.push(
      'event: message' +
        NL +
        ': keep-alive' +
        NL +
        NL +
        'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) +
        NL,
    );
    const payloads = lines
      .map(parseSseDataLine)
      .filter((x): x is string => x !== null);
    expect(payloads).toHaveLength(1);
    expect(
      (JSON.parse(payloads[0]) as OpenAiDelta).choices?.[0]?.delta?.content,
    ).toBe('ok');
  });
});

// --- Defect 2: accumulator duplication across rounds --------------------------

describe('Defect 2 - per-round transcript duplication', () => {
  // Mirrors the CLI contract for one round: the streaming path has already
  // written `streamedToStdout`, then the caller decides whether to render the
  // aggregated result again.
  function roundOutput(
    streamedToStdout: string,
    result: GenerateResult,
  ): string {
    return streamedToStdout + (shouldEmitFinalText(result) ? result.text : '');
  }

  it('emits each streamed round exactly once across 3 rounds', () => {
    const decisions = [
      'Round 1: the proposal conflates adequacy with Commission scope.',
      'Round 2: agreed, with the caveat on Commission scope.',
      'Round 3: final decision accepted by all agents.',
    ];
    const transcript = decisions
      .map((decision) =>
        roundOutput(decision, { text: decision, streamed: true }),
      )
      .join(NL);

    for (const decision of decisions) {
      expect(countOccurrences(transcript, decision)).toBe(1);
    }
  });

  it('emits a non-streamed (static) result exactly once, too', () => {
    const text = 'Static answer from a non-streaming provider.';
    expect(roundOutput('', { text, streamed: false })).toBe(text);
    expect(roundOutput('', { text })).toBe(text);
  });

  it('shows the old bug would print a streamed consensus block twice', () => {
    const consensus = 'The Council conflates adequacy with Commission scope.';
    const buggyTranscript = consensus + consensus; // streamed + aggregated
    const fixedTranscript = roundOutput(consensus, {
      text: consensus,
      streamed: true,
    });

    expect(countOccurrences(buggyTranscript, consensus)).toBe(2);
    expect(countOccurrences(fixedTranscript, consensus)).toBe(1);
  });

  it('shouldEmitFinalText: false for streamed, true for static/empty', () => {
    expect(shouldEmitFinalText({ text: 'x', streamed: true })).toBe(false);
    expect(shouldEmitFinalText({ text: 'x', streamed: false })).toBe(true);
    expect(shouldEmitFinalText({ text: 'x' })).toBe(true);
    expect(shouldEmitFinalText({ text: '' })).toBe(false);
  });
});
