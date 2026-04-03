/**
 * FileSystem-based tiddlers read stream
 * Replaces SQLiteTiddlersReadStream for git-based workspace storage
 *
 * Purpose: Read .tid/.meta files from filesystem and stream them as JSON chunks to WebView
 *
 * Performance: When the native `batchParseTidFiles` method is available
 * (expo-tiddlywiki-filesystem-android-external-storage ≥ 2.0.0), a single
 * bridge call parses the entire batch in Kotlin using coroutine parallelism.
 * This eliminates 100+ per-file round-trips and avoids JSON re-serialization.
 */

import { Directory, File } from 'expo-file-system';
import { ExternalStorage, toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { Platform } from 'react-native';
import { Readable } from 'readable-stream';
import type { ITiddlerFields } from 'tiddlywiki';
import { getWikiTiddlerFolderPath } from '../../../constants/paths';
import {
  getTitleFromFilename,
  makeSkinnyTiddler,
  parseMetadataFile,
  parseTiddlerFileHeaderOnly,
  shouldPreserveFullTextInQuickLoad,
  shouldSaveFullTiddler,
} from '../../../services/WikiStorageService/tiddlerFileParser';
import { IWikiWorkspace } from '../../../store/workspace';

const timestamp = () => new Date().toISOString();

/**
 * Runtime check for the native batch parser.
 * Returns the batchParseTidFiles function if available, else undefined.
 */
const getNativeBatchParser = (): ((filePaths: string[], quickLoadMode: boolean) => Promise<string>) | undefined => {
  if (Platform.OS !== 'android') return undefined;
  const nativeModule = ExternalStorage as unknown as Record<string, unknown>;
  if (typeof nativeModule.batchParseTidFiles === 'function') {
    return nativeModule.batchParseTidFiles as (filePaths: string[], quickLoadMode: boolean) => Promise<string>;
  }
  return undefined;
};

function safeDecodePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

function toInternalFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/**
 * Whether a path points to external/shared storage.
 */
function isExternalPath(filepath: string): boolean {
  const plain = toPlainPath(filepath);
  return plain.startsWith('/storage/') || plain.startsWith('/sdcard/');
}

export interface IFileSystemTiddlersReadStreamOptions {
  additionalContent?: string[];
  chunkSize?: number;
  quickLoad?: boolean;
}

/**
 * Read tiddlers from filesystem and stream them as JSON array chunks
 * Supports both skinny loading (without text) and full loading
 */
export class FileSystemTiddlersReadStream extends Readable {
  private readonly workspaces: IWikiWorkspace[];
  private readonly chunkSize: number;
  private readonly additionalContent?: string[];
  private readonly quickLoadMode: boolean;

  private tiddlerFiles: Array<{ filePath: string; workspace: IWikiWorkspace }> = [];
  private currentIndex = 0;
  private hasStarted = false;
  private tiddlerCount = 0;
  private initDone = false;
  private nativeSystemProbeDone = false;

  constructor(workspace: IWikiWorkspace | IWikiWorkspace[], options?: IFileSystemTiddlersReadStreamOptions) {
    super({ encoding: 'utf8' });
    this.workspaces = Array.isArray(workspace) ? workspace : [workspace];
    // With native batch parsing, a single bridge call handles the entire batch,
    // so larger batches are more efficient. With JS fallback, 100 is reasonable.
    const defaultChunkSize = getNativeBatchParser() !== undefined ? 500 : 100;
    this.chunkSize = options?.chunkSize ?? defaultChunkSize;
    this.additionalContent = options?.additionalContent;
    this.quickLoadMode = options?.quickLoad === true;
  }

  init(): void {
    // init is sync but we need async for external paths — fire and forget,
    // stream won't start reading until _read() is called which waits on this.
    void this.initAsync();
  }

  private async initAsync(): Promise<void> {
    try {
      const initStartedAt = Date.now();
      this.tiddlerFiles = [];
      for (const workspace of this.workspaces) {
        const workspaceStartedAt = Date.now();
        const tiddlerFolderPath = getWikiTiddlerFolderPath(workspace);
        console.log(`${timestamp()} [FileSystemTiddlersReadStream] init workspace ${workspace.id}: tiddlerFolderPath=${tiddlerFolderPath}`);

        if (Platform.OS === 'android' || isExternalPath(tiddlerFolderPath)) {
          const plainPath = safeDecodePath(toPlainPath(tiddlerFolderPath));
          const info = await ExternalStorage.getInfo(plainPath);
          console.log(
            `${timestamp()} [FileSystemTiddlersReadStream] (native scan) folder exists=${String(info.exists)}, isDirectory=${String(info.isDirectory)}, path=${plainPath}`,
          );
          if (info.exists && info.isDirectory) {
            const relativePaths = await ExternalStorage.readDirRecursive(plainPath);
            this.tiddlerFiles.push(
              ...relativePaths
                .filter(p => p.endsWith('.tid') || p.endsWith('.json') || p.endsWith('.meta'))
                .map(p => ({
                  filePath: `${plainPath}${plainPath.endsWith('/') ? '' : '/'}${p}`,
                  workspace,
                })),
            );
          }
        } else {
          const folder = new Directory(tiddlerFolderPath);
          console.log(`${timestamp()} [FileSystemTiddlersReadStream] (internal) folder.exists=${String(folder.exists)}, folder.uri=${folder.uri}`);
          if (folder.exists) {
            this.tiddlerFiles.push(...this.collectTiddlerFiles(folder, workspace));
          }
        }

        console.log(`${timestamp()} [FileSystemTiddlersReadStream] workspace ${workspace.id} scan finished in ${Date.now() - workspaceStartedAt}ms`);
      }

      console.log(`${timestamp()} [FileSystemTiddlersReadStream] Found ${this.tiddlerFiles.length} tiddler files in ${Date.now() - initStartedAt}ms`);
      if (this.tiddlerFiles.length > 0) {
        console.log(`${timestamp()} [FileSystemTiddlersReadStream] First few files: ${this.tiddlerFiles.slice(0, 5).map(file => file.filePath).join(', ')}`);
      }

      this.initDone = true;
    } catch (error) {
      console.error(`[FileSystemTiddlersReadStream] init error: ${(error as Error).message}`, (error as Error).stack);
      this.initDone = true;
      this.emit('error', error);
    }
  }

  private async waitForInitDone(maxWaitMs = 30_000): Promise<boolean> {
    const sleepMs = 50;
    const maxChecks = Math.ceil(maxWaitMs / sleepMs);
    for (let checkIndex = 0; checkIndex < maxChecks; checkIndex++) {
      if (this.initDone) return true;
      await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
    return this.initDone;
  }

  /**
   * Recursively collect tiddler file URIs from a directory tree.
   * Collects .tid files, .json tiddler files, and .meta companion files.
   * Skips .git, node_modules, and other non-tiddler directories.
   */
  private collectTiddlerFiles(directory: Directory, workspace: IWikiWorkspace): Array<{ filePath: string; workspace: IWikiWorkspace }> {
    const result: Array<{ filePath: string; workspace: IWikiWorkspace }> = [];
    try {
      const entries = directory.list();
      for (const entry of entries) {
        if (entry instanceof Directory) {
          const directoryName = entry.name.replace(/\/$/, '');
          if (directoryName === '.git' || directoryName === 'node_modules' || directoryName === '.DS_Store' || directoryName === 'output') {
            continue;
          }
          result.push(...this.collectTiddlerFiles(entry, workspace));
        } else if (entry instanceof File) {
          // Collect .tid and .json tiddler files
          if (entry.name.endsWith('.tid') || entry.name.endsWith('.json')) {
            result.push({ filePath: entry.uri, workspace });
          } // Collect .meta files (they accompany binary files like images)
          // We'll parse the .meta to load binary tiddler metadata
          else if (entry.name.endsWith('.meta')) {
            result.push({ filePath: entry.uri, workspace });
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to list directory ${directory.uri}: ${(error as Error).message}`);
    }
    return result;
  }

  _read(): void {
    // Use promise internally but don't return it (Readable spec)
    void (async () => {
      try {
        // Wait for async init to finish
        if (!this.initDone) {
          const initCompleted = await this.waitForInitDone();
          if (!initCompleted) {
            console.error('[FileSystemTiddlersReadStream] init timed out after 30s');
            this.push(null);
            return;
          }
        }

        // First chunk: output array opening bracket
        if (!this.hasStarted) {
          this.hasStarted = true;
          console.log(
            `${timestamp()} [FileSystemTiddlersReadStream] _read: starting stream, totalFiles=${this.tiddlerFiles.length}, chunkSize=${this.chunkSize}, nativeBatch=${
              getNativeBatchParser() !== undefined
            }`,
          );
          this.push('[');

          // Add additional content if provided
          if (this.additionalContent && this.additionalContent.length > 0) {
            const additionalJson = this.additionalContent.join(',');
            this.push(additionalJson);
            if (this.tiddlerFiles.length > 0) {
              this.push(',');
            }
          }
          return;
        }

        // Check if we've reached the end
        if (this.currentIndex >= this.tiddlerFiles.length) {
          console.log(`${timestamp()} [FileSystemTiddlersReadStream] _read: end of files (index=${this.currentIndex}, total=${this.tiddlerFiles.length})`);
          this.push(']'); // Close the JSON array
          this.push(null); // Signal end of stream
          return;
        }

        // Read and process a chunk of tiddlers
        const endIndex = Math.min(this.currentIndex + this.chunkSize, this.tiddlerFiles.length);
        const limitedEndIndex = endIndex;
        const batch = this.tiddlerFiles.slice(this.currentIndex, limitedEndIndex);

        // Try native batch parsing first (single bridge call for entire batch).
        // Falls back to JS-side parallel parsing if native method unavailable.
        const nativeBatch = getNativeBatchParser();
        let chunkJson: string | undefined;

        const batchStart = Date.now();

        if (nativeBatch !== undefined) {
          // Native path: Kotlin reads all files in parallel, parses headers,
          // applies skinny logic, and returns a serialized JSON array string.
          // This eliminates per-file bridge calls AND JS JSON.stringify overhead.
          const paths = batch.map(({ filePath }) => safeDecodePath(toPlainPath(filePath)));
          console.log(`${timestamp()} [FileSystemTiddlersReadStream] native batch: ${paths.length} files, index=${this.currentIndex}`);
          const jsonArrayString = await nativeBatch(paths, this.quickLoadMode);
          console.log(`${timestamp()} [FileSystemTiddlersReadStream] native batch done: ${jsonArrayString.length} chars in ${Date.now() - batchStart}ms`);
          const inner = jsonArrayString.length > 2 ? jsonArrayString.slice(1, -1) : '';
          if (inner.length > 0) {
            chunkJson = inner;
            let objectCount = 0;
            let depth = 0;
            for (let charIndex = 0; charIndex < inner.length; charIndex++) {
              const character = inner[charIndex];
              if (character === '{' && depth === 0) objectCount++;
              if (character === '{' || character === '[') depth++;
              if (character === '}' || character === ']') depth--;
            }
            this.tiddlerCount += objectCount;
          }
        } else {
          console.log(`${timestamp()} [FileSystemTiddlersReadStream] JS fallback batch: ${batch.length} files, index=${this.currentIndex}`);
          // JS fallback: read files in parallel batches via individual bridge calls.
          const chunk: Array<Record<string, string | string[]>> = [];
          const results = await Promise.all(
            batch.map(({ filePath, workspace }) => this.readTiddlerFromFile(filePath, workspace)),
          );
          for (const result of results) {
            if (result) {
              const tiddlers = Array.isArray(result) ? result : [result];
              for (const tiddler of tiddlers) {
                const tiddlerToSave = shouldSaveFullTiddler(tiddler) ? tiddler : makeSkinnyTiddler(tiddler);
                chunk.push(tiddlerToSave as Record<string, string | string[]>);
                this.tiddlerCount++;
              }
            }
          }
          if (chunk.length > 0) {
            chunkJson = chunk.map(t => JSON.stringify(t)).join(',');
          }
        }

        this.currentIndex = limitedEndIndex;

        // Emit progress event (M5)
        if (this.tiddlerFiles.length > 0) {
          this.emit('progress', this.currentIndex / this.tiddlerFiles.length);
        }

        // Convert chunk to JSON and push
        if (chunkJson !== undefined && chunkJson.length > 0) {
          this.push(chunkJson);

          // Add comma if not the last chunk
          if (this.currentIndex < this.tiddlerFiles.length) {
            this.push(',');
          }
        } else if (this.currentIndex < this.tiddlerFiles.length) {
          // Some batches legitimately parse to [] (for example plugin bundle
          // .json files that are loaded via their companion .meta file). If we
          // don't push anything here, Node's Readable stays waiting forever and
          // the whole WebView load stalls around the first empty batch.
          console.log(`${timestamp()} [FileSystemTiddlersReadStream] empty batch skipped at index=${this.currentIndex}, continuing`);
          setTimeout(() => {
            this._read();
          }, 0);
        }
      } catch (error) {
        console.error(`[FileSystemTiddlersReadStream] _read error at index ${this.currentIndex}: ${(error as Error).message}`, (error as Error).stack);
        this.emit('error', error);
      }
    })();
  }

  /**
   * Read and parse a single tiddler file.
   * Supports .tid (header+body), .json (tiddler JSON), and .meta (binary companion).
   * Uses ExternalStorage for external paths, expo-file-system File for internal paths.
   */
  private async readTiddlerFromFile(filePath: string, workspace: IWikiWorkspace): Promise<ITiddlerFields | ITiddlerFields[] | null> {
    try {
      const filename = safeDecodePath(filePath.split('/').pop() ?? '');
      const external = isExternalPath(filePath);

      const readText = async (path: string): Promise<string> => {
        if (external) {
          return ExternalStorage.readFileUtf8(toPlainPath(path));
        }
        const file = new File(toInternalFileUri(path));
        return file.text();
      };

      const fileExists = async (path: string): Promise<boolean> => {
        if (external) {
          return ExternalStorage.exists(toPlainPath(path));
        }
        const file = new File(toInternalFileUri(path));
        return file.exists;
      };

      if (filename.endsWith('.json')) {
        // JSON tiddler file (e.g., plugin.info, or tiddler-as-json)
        const content = await readText(filePath);
        const fallbackTitle = getTitleFromFilename(filename);
        try {
          const parsed = JSON.parse(content) as unknown;
          // JSON may be a single tiddler or an array of tiddlers
          if (Array.isArray(parsed)) {
            const results = parsed
              .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && 'title' in item)
              .map(item => item as unknown as ITiddlerFields);
            if (results.length > 0) {
              return results;
            }
            return {
              title: fallbackTitle,
              type: 'application/json',
              text: content,
            } as ITiddlerFields;
          }
          if (parsed !== null && typeof parsed === 'object' && 'title' in parsed && typeof parsed.title === 'string') {
            return parsed as unknown as ITiddlerFields;
          }
          if (parsed !== null && typeof parsed === 'object' && 'tiddlers' in parsed) {
            // Plugin bundle format is loaded via its .meta companion file.
            return null;
          }
          return {
            title: fallbackTitle,
            type: 'application/json',
            text: content,
          } as ITiddlerFields;
        } catch {
          return {
            title: fallbackTitle,
            type: 'application/json',
            text: content,
          } as ITiddlerFields;
        }
      } else if (filename.endsWith('.meta')) {
        // .meta file accompanies another file; load metadata from .meta
        const metaContent = await readText(filePath);
        const metaFields = parseMetadataFile(metaContent);
        const companionPath = filePath.replace(/\.meta$/, '');
        if (!metaFields.title) {
          metaFields.title = getTitleFromFilename(filename.replace(/\.meta$/, ''));
        }
        if (await fileExists(companionPath)) {
          if (companionPath.endsWith('.json')) {
            // .meta + .json pair: the .json IS the text content (e.g. plugin bundles).
            // Must include text so the tiddler is complete — otherwise it will
            // overwrite the preloaded HTML version with an empty shell, causing
            // "Cannot read properties of undefined (reading 'name')" in boot.js.
            const jsonContent = await readText(companionPath);
            metaFields.text = jsonContent;
          } else {
            // .meta + binary file pair: set canonical URI for lazy loading
            const workspaceBase = workspace.wikiFolderLocation;
            metaFields._canonical_uri = companionPath.replace(workspaceBase + '/', '');
          }
        }
        if (!metaFields.title) {
          throw new Error('.meta file must have a title');
        }
        return metaFields as unknown as ITiddlerFields;
      } else {
        // .tid file — parse headers first to check if full text is needed.
        // This avoids creating the (potentially large) text substring for skinny tiddlers.
        const content = await readText(filePath);
        const fallbackTitle = getTitleFromFilename(filename);
        const { fields: headerFields, bodyOffset, estimatedBodyLength } = parseTiddlerFileHeaderOnly(content, { title: fallbackTitle });

        const shouldIncludeFullText = this.quickLoadMode
          ? shouldPreserveFullTextInQuickLoad(headerFields)
          : shouldSaveFullTiddler(headerFields, estimatedBodyLength);

        if (shouldIncludeFullText) {
          // Need full text — parse the body
          if (bodyOffset >= 0 && estimatedBodyLength > 0) {
            (headerFields as Record<string, string>).text = content.substring(bodyOffset);
          }
          return headerFields;
        }
        // Skinny: return header-only with _is_skinny marker.
        // The text body is intentionally NOT loaded — it will be lazy-loaded by the syncadaptor.
        return makeSkinnyTiddler(headerFields) as unknown as ITiddlerFields;
      }
    } catch (error) {
      console.error(`Error reading tiddler file ${filePath}: ${(error as Error).message}`);
      return null;
    }
  }
}
