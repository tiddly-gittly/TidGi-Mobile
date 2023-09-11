/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/**
 * Tiddlers that won't sync to other devices
 */
export const getSyncIgnoredTiddlers = (
  title?: string,
) => [...((title?.startsWith('Draft of ') || title?.startsWith('$:/temp') || title?.startsWith('$:/state')) ? [title] : []), '$:/StoryList', '$:/layout', '$:/Import'];
/**
 * Tiddlers that should save to SQLite as full tiddlers. Like plugins that starts with `$:/`.
 *
 * For example, `$:/layout`, if is skinny, will cause `Uncaught Linked List only accepts string values, not null` error
 */
export const getFullSaveTiddlers = (
  title?: string,
) => [...((title?.startsWith('$:/')) ? [title] : [])];
