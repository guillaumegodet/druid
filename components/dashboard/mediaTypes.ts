// Vocabulary of the media-monitoring media types (media_watch) — extracted into a
// separate module so that MediaMentionsPanel.tsx and MediaSourcesAdmin.tsx
// can both import it without a circular dependency between them (a cycle
// had broken module init once minified: TDZ on TYPE_LABELS).
// Translatable labels (msg) resolved via `mediaTypeLabel` (i18n._) — callers
// put i18n.locale in the dependencies of their memos.
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

export const TYPE_LABELS: Record<string, MessageDescriptor> = {
  presse: msg`Press`,
  video: msg`Video`,
  radio: msg`Radio / podcast`,
  podcast: msg`Radio / podcast`,
  tv: msg`TV`,
  blog: msg`Blog`,
  mediation: msg`Outreach`,
  institutionnel: msg`Institutional`,
};

/** Translated label of a media type (raw key as fallback). */
export const mediaTypeLabel = (key: string): string => {
  const m = TYPE_LABELS[key];
  return m ? i18n._(m) : key;
};
