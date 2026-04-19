/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Key } from '../hooks/useKeypress.js';
import type { KeyBindingConfig } from './keyBindings.js';
import { Command, defaultKeyBindingConfig } from './keyBindings.js';

function matchCommand(
  command: Command,
  key: Key,
  config: KeyBindingConfig = defaultKeyBindingConfig,
): boolean {
  const bindings = config.get(command);
  if (!bindings) return false;
  return bindings.some((binding) => binding.matches(key));
}

type KeyMatcher = (key: Key) => boolean;

export type KeyMatchers = {
  readonly [C in Command]: KeyMatcher;
};

export function createKeyMatchers(
  config: KeyBindingConfig = defaultKeyBindingConfig,
): KeyMatchers {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const matchers = {} as { [C in Command]: KeyMatcher };
  for (const command of Object.values(Command)) {
    matchers[command] = (key: Key) => matchCommand(command, key, config);
  }
  return matchers as KeyMatchers;
}

export const defaultKeyMatchers: KeyMatchers = createKeyMatchers(defaultKeyBindingConfig);

export { Command };

// Compatibility shim for shielded files
export const keyMatchers = defaultKeyMatchers;
export async function loadKeyMatchers(): Promise<{ matchers: KeyMatchers; errors: string[] }> {
  return { matchers: defaultKeyMatchers, errors: [] };
}
