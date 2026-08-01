/**
 * TiddlyWiki tiddler file parser
 * Extracted and adapted from TiddlyWiki5 boot.js for mobile use with Expo FileSystem
 *
 * Purpose: Parse .tid and .meta files from filesystem into tiddler field objects
 */

import type { ITiddlerFields } from 'tiddlywiki';

import contentTypeInfo, { type ContentTypeInfoEntry } from './contentTypeInfo';

/**
 * Content type registry that knows how to map a tiddler MIME type to its on-disk
 * representation (file extension and body encoding).
 *
 * It combines:
 *   1. A static table generated at build time from TiddlyWiki's empty edition
 *      (`contentTypeInfo.ts`). This does not include plugin types.
 *   2. A mutable runtime table that the WebView syncadaptor populates with
 *      `$tw.config.contentTypeInfo` after plugins have registered their types.
 *
 * Encapsulating the registry as a class keeps mutable state out of the module
 * closure and makes it easy to inject into services (e.g. TiddlerRoutingService).
 */
export class ContentTypeRegistry {
  readonly #staticInfo: Readonly<Record<string, ContentTypeInfoEntry>>;
  readonly #runtimeInfo = new Map<string, ContentTypeInfoEntry>();

  constructor(staticInfo: Readonly<Record<string, ContentTypeInfoEntry>> = contentTypeInfo) {
    this.#staticInfo = staticInfo;
  }

  /**
   * Register additional content type mappings discovered at runtime.
   * Later registrations override earlier ones, allowing the WebView to
   * update/extend the build-time static table.
   */
  register(info: Record<string, ContentTypeInfoEntry>): void {
    for (const [type, entry] of Object.entries(info)) {
      this.#runtimeInfo.set(type, entry);
    }
  }

  /**
   * Clear runtime registrations. Useful for tests.
   */
  clear(): void {
    this.#runtimeInfo.clear();
  }

  /**
   * Check whether a tiddler type is known to the registry (static build-time
   * table or runtime registrations from the WebView). Unknown types fall back
   * to .tid extension, so this helper is needed to distinguish "explicitly
   * wikitext" from "unknown plugin type".
   */
  isKnown(tiddlerType: string | undefined): boolean {
    return this.#getEntry(tiddlerType) !== undefined;
  }

  /**
   * Get the file extension (with leading dot, e.g. `.tid`, `.md`) for a tiddler type.
   * Checks runtime registrations first, then the build-time static table.
   * Falls back to '.tid' for unknown or untyped tiddlers.
   */
  getExtension(tiddlerType: string | undefined): string {
    if (!tiddlerType) return '.tid';
    const entry = this.#getEntry(tiddlerType);
    if (!entry) return '.tid';
    return Array.isArray(entry.extension) ? entry.extension[0] : entry.extension;
  }

  /**
   * Get the file encoding for a tiddler type's body file.
   * Checks runtime registrations first, then the build-time static table.
   * Falls back to 'utf8' for unknown types.
   *
   * Note: this mirrors the historical behavior of contentTypeInfo.ts, which only
   * distinguishes 'base64' from everything else. The only core type using
   * 'utf16le' is application/hta and is not relevant for mobile plugin files.
   */
  getEncoding(tiddlerType: string | undefined): 'utf8' | 'base64' {
    if (!tiddlerType) return 'utf8';
    const entry = this.#getEntry(tiddlerType);
    if (!entry) return 'utf8';
    return entry.encoding === 'base64' ? 'base64' : 'utf8';
  }

  /**
   * Whether a tiddler type stores body and metadata as separate files.
   * Checks runtime registrations first, then the build-time static table.
   * Desktop TW writes .tid as self-contained (header+body), and every other
   * extension as body-only + .meta companion.
   */
  usesSeparateMetaFile(tiddlerType: string | undefined): boolean {
    if (!tiddlerType) return false;
    const entry = this.#getEntry(tiddlerType);
    if (entry) {
      const extension = Array.isArray(entry.extension) ? entry.extension[0] : entry.extension;
      return extension !== '.tid';
    }
    // Unknown type: conservatively assume separate-meta if caller cannot be sure,
    // because writing unknown types as .tid can corrupt plugin files.
    return true;
  }

  /**
   * Get the file extension for a tiddler's body file, respecting canonical URI
   * override (forces .tid extension).
   */
  getBodyFileExtension(fields: { type?: string; _canonical_uri?: string }): string {
    if (typeof fields._canonical_uri === 'string' && fields._canonical_uri.length > 0) {
      return '.tid';
    }
    return this.getExtension(fields.type);
  }

  /**
   * Determine whether a body file extension is base64-encoded binary content.
   * Looks up the extension in contentTypeInfo to match TW's registerFileType.
   * Returns true for extensions like .jpg, .png, .pdf, .wasm, etc.
   */
  isBase64EncodedExtension(extension: string): boolean {
    if (!extension || extension === '.tid' || extension === '.meta') return false;
    for (const info of [...this.#runtimeInfo.values(), ...Object.values(this.#staticInfo)]) {
      const extensions = Array.isArray(info.extension) ? info.extension : [info.extension];
      if (extensions.includes(extension)) {
        return info.encoding === 'base64';
      }
    }
    return false;
  }

  #getEntry(tiddlerType: string | undefined): ContentTypeInfoEntry | undefined {
    if (!tiddlerType) return undefined;
    return this.#runtimeInfo.get(tiddlerType) ?? this.#staticInfo[tiddlerType];
  }
}

/**
 * Replace the file extension in a relative path with the target extension.
 * Preserves directory prefixes and title sanitization produced by the routing
 * service. If the path has no extension, the target extension is appended.
 *
 * This is a pure utility function with no side effects.
 */
export function replaceFileExtension(relativePath: string, targetExtension: string): string {
  const lastDotIndex = relativePath.lastIndexOf('.');
  const lastSlashIndex = relativePath.lastIndexOf('/');
  const hasExtension = lastDotIndex > lastSlashIndex && lastDotIndex > 0;
  if (hasExtension) {
    return `${relativePath.slice(0, lastDotIndex)}${targetExtension}`;
  }
  return `${relativePath}${targetExtension}`;
}

/**
 * Given a `.meta` file path, return the path of its companion body file.
 * For example, `tiddlers/Foo.md.meta` → `tiddlers/Foo.md`.
 */
export function getBodyFilePathFromMetaPath(metaPath: string): string {
  return metaPath.replace(/\.meta$/, '');
}

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
 * Tiddlers that must keep full text even during quick load, otherwise boot can
 * end up with empty module registrations or missing startup state.
 */
export function shouldPreserveFullTextInQuickLoad(
  fields: Pick<ITiddlerFields, 'title'> & Partial<Pick<ITiddlerFields, 'type'>> & Record<string, unknown>,
): boolean {
  const title = fields.title;
  const type = fields.type;

  if (title.startsWith('$:/')) {
    return true;
  }

  if (type === 'application/json' && fields['plugin-type']) {
    return true;
  }

  if ((fields as Record<string, unknown>)['module-type']) {
    return true;
  }

  return false;
}

/**
 * Check if tiddler should be saved with full text in the initial boot store.
 * System tiddlers, plugins, and small tiddlers should include text.
 * `estimatedTextLength` can be provided from header-only parsing to avoid
 * reading the full body just to measure its size.
 */
export function shouldSaveFullTiddler(fields: ITiddlerFields, estimatedTextLength?: number): boolean {
  if (shouldPreserveFullTextInQuickLoad(fields)) {
    return true;
  }

  // Small tiddlers (less than 10KB)
  const textLength = estimatedTextLength ?? (fields.text || '').length;
  if (textLength < 10000) {
    return true;
  }

  return false;
}
