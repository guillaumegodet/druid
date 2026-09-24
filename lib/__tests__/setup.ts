// Vitest setup: activate a Lingui locale so that lib/ modules using the `t` / `msg`
// macros (lib/gristService.ts, lib/apiErrors.ts…) can run outside the React tree.
// English with an empty catalog: every message falls back to its source text.
import { i18n } from '@lingui/core';

i18n.load('en', {});
i18n.activate('en');
