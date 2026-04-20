/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export class SubagentTool {
  private definition: any;
  constructor(definition: any, _config: any, _messageBus?: any) {
    this.definition = definition;
    void _config;
    void _messageBus;
  }
  getName(): string { return this.definition?.name ?? 'subagent'; }
}
