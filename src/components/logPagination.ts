export const DEFAULT_LOG_PAGE_CHARACTER_LIMIT = 20_000;

export function paginateLogContent(
  content: string,
  characterLimit = DEFAULT_LOG_PAGE_CHARACTER_LIMIT,
): string[] {
  if (!Number.isFinite(characterLimit) || characterLimit <= 0) {
    throw new Error('Log page character limit must be greater than zero');
  }
  if (content.length === 0) return [''];

  const pages: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(offset + characterLimit, content.length);
    if (end < content.length) {
      const lineEnd = content.lastIndexOf('\n', end - 1);
      if (lineEnd >= offset) end = lineEnd + 1;
      if (
        end > offset &&
        /[\uD800-\uDBFF]/.test(content[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(content[end] ?? '')
      ) {
        end -= 1;
      }
    }
    if (end <= offset) end = Math.min(offset + characterLimit, content.length);
    pages.push(content.slice(offset, end));
    offset = end;
  }
  return pages;
}
