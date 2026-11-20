/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

/**
 * A shared event emitter for application-wide communication
 * between decoupled parts of the CLI.
 */
export const updateEventEmitter = new EventEmitter();
