/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../test-utils/render.js';
import { useLogger } from './useLogger.js';
import {
  sessionId as globalSessionId,
  Logger,
  type Storage,
  type Config,
} from '@bare-ai/core';
import { ConfigContext } from '../contexts/ConfigContext.js';
import type React from 'react';

let deferredInit: { resolve: (val?: unknown) => void };

// Mock Logger
vi.mock('@bare-ai/core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@bare-ai/core')>();
  return {
    ...actual,
    Logger: vi.fn().mockImplementation((id: string) => ({
      initialize: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            deferredInit = { resolve };
          }),
      ),
      sessionId: id,
    })),
  };
});

describe('useLogger', () => {
  const mockStorage = {} as Storage;
  const mockConfig = {
    getSessionId: vi.fn().mockReturnValue('active-session-id'),
    storage: mockStorage,
  } as unknown as Config;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with the sessionId from config', async () => {
    const { result } = await renderHook(() => useLogger(mockConfig));

    expect(result.current).toBeNull();

    await act(async () => {
      deferredInit.resolve();
    });

    expect(result.current).not.toBeNull();
    expect(Logger).toHaveBeenCalledWith('active-session-id', mockStorage);
  });
});
