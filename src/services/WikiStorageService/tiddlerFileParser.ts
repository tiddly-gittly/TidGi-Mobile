/**
 * TiddlyWiki tiddler file parser
 * Extracted and adapted from TiddlyWiki5 boot.js for mobile use with Expo FileSystem
 *
 * Purpose: Parse .tid and .meta files from filesystem into tiddler field objects
 */

import type { ITiddlerFields } from 'tiddlywiki';

/**
 * Parse a tiddler DIV in a *.tid file. It looks like this:
 *
 * title: HelloThere
 * modifier: JoeBloggs
 * created: 20140608120850047
 *
 * Text of the tiddler
 */
export function parseTiddlerFile(text: string, fields?: Partial<ITiddlerFields>): ITiddlerFields {
  // Initialize fields to empty object if undefined
  const result: Partial<ITiddlerFields> = fields ?? {};

  // Find the first blank line (separating headers from body)
  const blankLineMatch = /\r?\n\r?\n/.exec(text);
  // When no blank line exists, the entire file is headers with no text body.
  const headerText = blankLineMatch !== null ? text.substring(0, blankLineMatch.index) : text;
  const bodyText = blankLineMatch !== null ? text.substring(blankLineMatch.index + blankLineMatch[0].length) : undefined;

  // Parse header lines
  const headerLines = headerText.split(/\r?\n/);
  for (const line of headerLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const name = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      if (name) {
        (result as Record<string, string | string[]>)[name] = value;
      }
    }
  }

  // Preserve body text exactly as-is
  if (bodyText !== undefined && bodyText !== '') {
    (result as Partial<ITiddlerFields> & { text: string }).text = bodyText;
  }

  // Ensure title exists (required field)
  if (!result.title) {
    throw new Error('Tiddler file must contain a title field');
  }

  return result as ITiddlerFields;
}

/**
 * Parse only the header portion of a .tid file, skipping the text body.
 * Useful for determining whether `shouldSaveFullTiddler` before committing to
 * loading the (potentially large) text body into memory.
 *
 * Returns the parsed header fields and the byte offset where the body starts
 * (or -1 if no body exists), so the caller can read the body on demand.
 */
export function parseTiddlerFileHeaderOnly(
  text: string,
  fields?: Partial<ITiddlerFields>,
): { fields: ITiddlerFields; bodyOffset: number; estimatedBodyLength: number } {
  const result: Partial<ITiddlerFields> = fields ?? {};

  const blankLineMatch = /\r?\n\r?\n/.exec(text);
  const headerText = blankLineMatch !== null ? text.substring(0, blankLineMatch.index) : text;
  const bodyOffset = blankLineMatch !== null ? blankLineMatch.index + blankLineMatch[0].length : -1;
  const estimatedBodyLength = bodyOffset >= 0 ? text.length - bodyOffset : 0;

  const headerLines = headerText.split(/\r?\n/);
  for (const line of headerLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const name = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      if (name) {
        (result as Record<string, string | string[]>)[name] = value;
      }
    }
  }
  if (!result.title) {
    throw new Error('Tiddler file must contain a title field');
  }
  return { fields: result as ITiddlerFields, bodyOffset, estimatedBodyLength };
}

/**
 * Parse JSON safely without throwing
 */
export function parseJSONSafe<T = unknown>(text: string, fallbackValue?: T): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallbackValue;
  }
}

/**
 * Parse metadata from a .meta file
 * A .meta file contains only field definitions without text body
 */
export function parseMetadataFile(text: string, fields?: Partial<ITiddlerFields>): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = fields ? { ...fields } as Record<string, string | string[]> : {};
  const lines = text.split(/\r?\n/mg);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const name = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      if (name) {
        result[name] = value;
      }
    }
  }
  return result;
}

/**
 * Process field values according to TiddlyWiki conventions
 * - Parse 'tags' into array
 * - Parse 'list' into array
 * - Parse date fields
 */
export function processFields(fields: Partial<ITiddlerFields>): Record<string, string | string[] | number> {
  const result: Record<string, string | string[] | number> = { ...fields } as Record<string, string | string[] | number>;

  // Process tags field
  if (typeof result.tags === 'string') {
    result.tags = parseStringArray(result.tags);
  }

  // Process list field
  if (typeof result.list === 'string') {
    result.list = parseStringArray(result.list);
  }

  // Ensure title exists
  if (!result.title) {
    throw new Error('Tiddler must have a title');
  }

  return result;
}

/**
 * Parse a string array in TiddlyWiki format
 * e.g., "[[Tag One]] TagTwo [[Tag Three]]"
 */
export function parseStringArray(value: string): string[] {
  const results: string[] = [];
  const regex = /\[\[([^\]]+)\]\]|(\S+)/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    results.push(match[1] || match[2]);
  }
  return results;
}

/**
 * Determine file type from extension
 */
export function getFileType(filename: string): 'tid' | 'meta' | 'json' | 'binary' | 'unknown' {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.tid')) return 'tid';
  if (lowerName.endsWith('.meta')) return 'meta';
  if (lowerName.endsWith('.json')) return 'json';

  // Comprehensive binary file extensions list
  const binaryExtensions = [
    // Images (note: .svg is text/xml in TiddlyWiki, not binary)
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.ico',
    '.webp',
    '.tiff',
    '.tif',
    // Documents
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    // Archives
    '.zip',
    '.tar',
    '.gz',
    '.7z',
    '.rar',
    // Audio
    '.mp3',
    '.wav',
    '.ogg',
    '.m4a',
    '.flac',
    // Video
    '.mp4',
    '.avi',
    '.mkv',
    '.mov',
    '.webm',
    // Fonts
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',
  ];

  for (const extension of binaryExtensions) {
    if (lowerName.endsWith(extension)) return 'binary';
  }

  return 'unknown';
}

/**
 * Get tiddler title from filename
 * Removes extension and restores special characters
 */
export function getTitleFromFilename(filename: string): string {
  // Remove extension
  const title = filename.replace(/\.(tid|meta|json)$/i, '');

  // Restore special characters that were replaced with underscore
  // This should match the INVALID_CHARACTERS_REGEX in paths.ts
  // For now, keep underscore as is (lossy conversion)

  return title;
}

/**
 * Create skinny tiddler (without text field) for faster initial loading.
 * Sets _is_skinny so TiddlyWiki's syncer triggers lazyLoad events.
 */
export function makeSkinnyTiddler(fields: ITiddlerFields): Omit<ITiddlerFields, 'text'> & { _is_skinny: string } {
  const { text: _text, ...skinny } = fields;
  return { ...skinny, _is_skinny: 'yes' };
}

/**
 * Check if tiddler should be saved with full text in the initial boot store.
 * System tiddlers, plugins, and small tiddlers should include text.
 * `estimatedTextLength` can be provided from header-only parsing to avoid
 * reading the full body just to measure its size.
 */
export function shouldSaveFullTiddler(fields: ITiddlerFields, estimatedTextLength?: number): boolean {
  const title = fields.title;
  const type = fields.type;

  // System tiddlers
  if (title.startsWith('$:/')) {
    return true;
  }

  // Plugins
  if (type === 'application/json' && fields['plugin-type']) {
    return true;
  }

  // Small tiddlers (less than 10KB)
  const textLength = estimatedTextLength ?? (fields.text || '').length;
  if (textLength < 10000) {
    return true;
  }

  return false;
}
