export const DEFAULT_LOG_PAGE_BYTE_LIMIT = 32 * 1024;
const UTF8_BOUNDARY_OVERLAP = 3;

export interface ILogPageWindow {
  pageCount: number;
  pageEnd: number;
  pageIndex: number;
  pageStart: number;
  readLength: number;
  readOffset: number;
}

export function getLogPageWindow(
  fileSize: number,
  requestedPageIndex: number,
  pageByteLimit = DEFAULT_LOG_PAGE_BYTE_LIMIT,
): ILogPageWindow {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
    throw new Error('Log file size must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(pageByteLimit) || pageByteLimit <= 0) {
    throw new Error('Log page byte limit must be a positive safe integer');
  }

  const pageCount = Math.max(1, Math.ceil(fileSize / pageByteLimit));
  const pageIndex = Math.max(0, Math.min(Math.trunc(requestedPageIndex), pageCount - 1));
  const pageStart = pageIndex * pageByteLimit;
  const pageEnd = Math.min(pageStart + pageByteLimit, fileSize);
  const readOffset = Math.max(0, pageStart - UTF8_BOUNDARY_OVERLAP);
  const readEnd = Math.min(fileSize, pageEnd + UTF8_BOUNDARY_OVERLAP);

  return {
    pageCount,
    pageEnd,
    pageIndex,
    pageStart,
    readLength: readEnd - readOffset,
    readOffset,
  };
}

function isUtf8ContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xC0) === 0x80;
}

/**
 * Trim overlap bytes and keep a UTF-8 code point wholly on one page.
 * A character crossing a fixed boundary belongs to the preceding page.
 */
export function getUtf8PageBytes(bytes: Uint8Array, window: ILogPageWindow): Uint8Array {
  let start = window.pageStart - window.readOffset;
  let end = window.pageEnd - window.readOffset;

  while (start < bytes.length && isUtf8ContinuationByte(bytes[start])) start++;
  while (end < bytes.length && isUtf8ContinuationByte(bytes[end])) end++;

  return bytes.slice(start, end);
}
