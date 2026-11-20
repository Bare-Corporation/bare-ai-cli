/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import type express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestStorage = new AsyncLocalStorage<{ req: express.Request }>();
