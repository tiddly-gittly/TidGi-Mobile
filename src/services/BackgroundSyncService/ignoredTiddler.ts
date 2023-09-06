/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
export const getLogIgnoredTiddler = (
  title?: string,
) => [...((title?.startsWith('Draft of ') || title?.startsWith('$:/temp') || title?.startsWith('$:/state')) ? [title] : []), '$:/StoryList'];
