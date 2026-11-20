/**
 * @license
 * Copyright 2025 Google LLC
 * Copyright 2026 Bare-AI, a trading name of Consulting Hailing Services LTD
 * SPDX-License-Identifier: Apache-2.0
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Bridge to zod-to-json-schema's stale type signature.
 *
 * zod-to-json-schema 3.25.2 is the latest release and declares zod
 * "^3.25.28 || ^4" as a supported peer, so it works with zod 4 at runtime.
 * Its TypeScript declarations, however, still describe the zod 3 generic
 * shape (ZodType<any, ZodTypeDef, any>), which a zod 4 schema does not
 * structurally satisfy. Rather than assert at every call site, or swap in a
 * different converter and risk changing the JSON Schema we send to the model,
 * this wrapper is the single place where the two type generations meet.
 *
 * The runtime call is exactly the one it replaced.
 */
export function zodSchemaToJsonSchema(
  schema: unknown,
  options?: Parameters<typeof zodToJsonSchema>[1],
): ReturnType<typeof zodToJsonSchema> {
  return zodToJsonSchema(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- bridges the zod 3 declaration to a zod 4 schema
    schema as Parameters<typeof zodToJsonSchema>[0],
    options,
  );
}
