/**
 * FileSystem-based tiddlers read stream
 * Replaces SQLiteTiddlersReadStream for git-based workspace storage
 *
 * Purpose: Read .tid/.meta files from filesystem and stream them as JSON chunks to WebView
 */

import { Directory, File } from 'expo-file-system';
import { ExternalStorage, toPlainPath } from 'expo-filesystem-android-external-storage';
import { Readable } from 'readable-stream';
import type { ITiddlerFields } from 'tiddlywiki';
import { getWikiTiddlerFolderPath } from '../../../constants/paths';
import {
  getTitleFromFilename,
  makeSkinnyTiddler,
  parseMetadataFile,
  parseTiddlerFileHeaderOnly,
  shouldSaveFullTiddler,
} from '../../../services/WikiStorageService/tiddlerFileParser';
import { IWikiWorkspace } from '../../../store/workspace';

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

  constructor(workspace: IWikiWorkspace | IWikiWorkspace[], options?: IFileSystemTiddlersReadStreamOptions) {
    super({ encoding: 'utf8' });
    this.workspaces = Array.isArray(workspace) ? workspace : [workspace];
    this.chunkSize = options?.chunkSize ?? 100;
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
      this.tiddlerFiles = [];
      for (const workspace of this.workspaces) {
        const tiddlerFolderPath = getWikiTiddlerFolderPath(workspace);
        console.log(`[FileSystemTiddlersReadStream] init workspace ${workspace.id}: tiddlerFolderPath=${tiddlerFolderPath}`);

        if (isExternalPath(tiddlerFolderPath)) {
          const plainPath = toPlainPath(tiddlerFolderPath);
          const info = await ExternalStorage.getInfo(plainPath);
          console.log(`[FileSystemTiddlersReadStream] (external) folder exists=${String(info.exists)}, isDirectory=${String(info.isDirectory)}, path=${plainPath}`);
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
          console.log(`[FileSystemTiddlersReadStream] (internal) folder.exists=${String(folder.exists)}, folder.uri=${folder.uri}`);
          if (folder.exists) {
            this.tiddlerFiles.push(...this.collectTiddlerFiles(folder, workspace));
          }
        }
      }

      console.log(`[FileSystemTiddlersReadStream] Found ${this.tiddlerFiles.length} tiddler files`);
      if (this.tiddlerFiles.length > 0) {
        console.log(`[FileSystemTiddlersReadStream] First few files: ${this.tiddlerFiles.slice(0, 5).map(file => file.filePath).join(', ')}`);
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
          console.log(`[FileSystemTiddlersReadStream] _read: starting stream, totalFiles=${this.tiddlerFiles.length}`);
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
          console.log(`[FileSystemTiddlersReadStream] _read: end of files (index=${this.currentIndex}, total=${this.tiddlerFiles.length})`);
          this.push(']'); // Close the JSON array
          this.push(null); // Signal end of stream
          return;
        }

        // Read and process a chunk of tiddlers
        const chunk: Array<Record<string, string | string[]>> = [];
        const endIndex = Math.min(this.currentIndex + this.chunkSize, this.tiddlerFiles.length);
        const limitedEndIndex = endIndex;

        // Read files in parallel batches for much faster throughput.
        // Each readTiddlerFromFile is I/O-bound (native bridge call), so running
        // them concurrently saturates the native thread pool instead of waiting
        // for each one sequentially.
        const batch = this.tiddlerFiles.slice(this.currentIndex, limitedEndIndex);
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

        this.currentIndex = limitedEndIndex;

        // Emit progress event (M5)
        if (this.tiddlerFiles.length > 0) {
          this.emit('progress', this.currentIndex / this.tiddlerFiles.length);
        }

        // Convert chunk to JSON and push
        if (chunk.length > 0) {
          const chunkJson = chunk.map(t => JSON.stringify(t)).join(',');
          this.push(chunkJson);

          // Add comma if not the last chunk
          if (this.currentIndex < this.tiddlerFiles.length) {
            this.push(',');
          }
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
      const filename = filePath.split('/').pop() ?? '';
      const external = isExternalPath(filePath);

      const readText = async (path: string): Promise<string> => {
        if (external) {
          return ExternalStorage.readFileUtf8(toPlainPath(path));
        }
        const file = new File(path);
        return file.text();
      };

      const fileExists = async (path: string): Promise<boolean> => {
        if (external) {
          return ExternalStorage.exists(toPlainPath(path));
        }
        const file = new File(path);
        return file.exists;
      };

      if (filename.endsWith('.json')) {
        // JSON tiddler file (e.g., plugin.info, or tiddler-as-json)
        const content = await readText(filePath);
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          // JSON may be a single tiddler or an array of tiddlers
          if (Array.isArray(parsed)) {
            const results = parsed
              .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && 'title' in item)
              .map(item => item as unknown as ITiddlerFields);
            return results.length > 0 ? results : null;
          }
          if (parsed.title) {
            return parsed as unknown as ITiddlerFields;
          }
          return null;
        } catch {
          return null;
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

        if (!this.quickLoadMode && shouldSaveFullTiddler(headerFields, estimatedBodyLength)) {
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
