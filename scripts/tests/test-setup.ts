/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

// Partial mock of fs: only appendFileSync is replaced.
//
// WHY the factory is async and the actuals are awaited: vi.importActual returns
// a PROMISE, and spreading a promise contributes no exports at all. The mock
// therefore exposed appendFileSync and nothing else, so every test in this
// suite that imports mkdtempSync, writeFileSync, rmSync or mkdirSync failed
// with "No <name> export is defined on the fs mock" - a failure that named the
// mock rather than the test.
vi.mock('fs', async () => ({
  ...(await vi.importActual<typeof import('fs')>('fs')),
  appendFileSync: vi.fn(),
}));
