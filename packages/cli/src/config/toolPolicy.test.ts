/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  applyToolFlags,
  applyToolModeFromCapability,
  getToolOverride,
  isToolModeLocked,
  lockToolMode,
  NO_TOOLS_ENV,
  TOOL_OVERRIDE_ENV,
} from './toolPolicy.js';

// Precedence contract under test (see toolPolicy.ts):
//   --disable-tools / --tools  >  BARE_AI_NO_TOOLS  >  catalogue capability
//
// Every case below asserts BOTH the returned decision and the value the model
// client actually reads (BARE_AI_NO_TOOLS), because the client only ever sees
// the environment variable.
const MANAGED = [NO_TOOLS_ENV, TOOL_OVERRIDE_ENV];

describe('toolPolicy', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of MANAGED) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of MANAGED) {
      const original = saved[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  describe('catalogue default (nothing overridden)', () => {
    it('withholds tools for a thinker row', () => {
      expect(applyToolModeFromCapability('thinker')).toBe(true);
      expect(process.env[NO_TOOLS_ENV]).toBe('true');
    });

    it('allows tools for a doer row', () => {
      expect(applyToolModeFromCapability('doer')).toBe(false);
      expect(process.env[NO_TOOLS_ENV]).toBe('false');
    });

    // Negative control: if a capability write also created a lock, the very
    // next swap would silently freeze the policy and every later assertion in
    // this file would pass for the wrong reason.
    it('does not lock the policy for the rest of the execution', () => {
      applyToolModeFromCapability('doer');
      expect(isToolModeLocked()).toBe(false);
      expect(applyToolModeFromCapability('thinker')).toBe(true);
      expect(process.env[NO_TOOLS_ENV]).toBe('true');
    });
  });

  describe('caller-supplied BARE_AI_NO_TOOLS (ticket 164)', () => {
    it('survives a hot-swap to a doer row', () => {
      process.env[NO_TOOLS_ENV] = 'true';

      expect(applyToolFlags({})).toBe('no-tools');
      // The swap: a doer row used to re-enable tools here.
      expect(applyToolModeFromCapability('doer')).toBe(true);
      expect(process.env[NO_TOOLS_ENV]).toBe('true');
      expect(getToolOverride()).toBe('no-tools');
    });

    it('can also force tools ON for a thinker row', () => {
      process.env[NO_TOOLS_ENV] = 'false';

      expect(applyToolFlags({})).toBe('tools');
      expect(applyToolModeFromCapability('thinker')).toBe(false);
      expect(process.env[NO_TOOLS_ENV]).toBe('false');
    });

    it('stays sticky across swaps in both directions', () => {
      lockToolMode('no-tools');
      expect(applyToolModeFromCapability('doer')).toBe(true);
      expect(applyToolModeFromCapability('thinker')).toBe(true);
      expect(process.env[NO_TOOLS_ENV]).toBe('true');
    });

    it('ignores a value that is not a boolean, so nothing locks by accident', () => {
      process.env[NO_TOOLS_ENV] = 'please';

      expect(applyToolFlags({})).toBeUndefined();
      expect(isToolModeLocked()).toBe(false);
      expect(applyToolModeFromCapability('doer')).toBe(false);
    });
  });

  describe('per-execution flags', () => {
    it('honours --disable-tools over a caller env that allows tools', () => {
      process.env[NO_TOOLS_ENV] = 'false';

      expect(applyToolFlags({ 'disable-tools': true })).toBe('no-tools');
      expect(process.env[NO_TOOLS_ENV]).toBe('true');
      expect(applyToolModeFromCapability('doer')).toBe(true);
    });

    it('honours --tools over a caller env that withholds tools', () => {
      process.env[NO_TOOLS_ENV] = 'true';

      expect(applyToolFlags({ tools: true })).toBe('tools');
      expect(process.env[NO_TOOLS_ENV]).toBe('false');
      expect(applyToolModeFromCapability('thinker')).toBe(false);
    });

    it('accepts the camelCase spelling yargs also produces', () => {
      expect(applyToolFlags({ disableTools: true })).toBe('no-tools');
      expect(isToolModeLocked()).toBe(true);
    });

    it('treats an explicitly false flag as no statement of intent', () => {
      expect(
        applyToolFlags({ 'disable-tools': false, tools: false }),
      ).toBeUndefined();
      expect(isToolModeLocked()).toBe(false);
    });

    it('tolerates a missing or non-object argv', () => {
      expect(applyToolFlags(undefined)).toBeUndefined();
      expect(applyToolFlags('bogus')).toBeUndefined();
      expect(isToolModeLocked()).toBe(false);
    });
  });
});
