/**
 * FileSystem-based tiddlers read stream
 * Replaces SQLiteTiddlersReadStream for git-based workspace storage
 *
 * Purpose: Read .tid/.meta files from filesystem and stream them as JSON chunks to WebView
 */

import { Directory, File } from 'expo-file-system';
import { Readable } from 'readable-stream';
import type { ITiddlerFields } from 'tiddlywiki';
import { getWikiTiddlerFolderPath } from '../../../constants/paths';
import {
  getTitleFromFilename,
  makeSkinnyTiddler,
  parseMetadataFile,
  parseTiddlerFile,
  processFields,
  shouldSaveFullTiddler,
} from '../../../services/WikiStorageService/tiddlerFileParser';
import { IWikiWorkspace } from '../../../store/workspace';

export interface IFileSystemTiddlersReadStreamOptions {
  additionalContent?: string[];
  chunkSize?: number;
  quickLoad?: boolean;
}

/**
 * If quickLoad, only load small amount of recent tiddlers, speed up loading time for huge wiki.
 */
const QUICK_LOAD_LIMIT = 300;

/**
 * Read tiddlers from filesystem and stream them as JSON array chunks
 * Supports both skinny loading (without text) and full loading
 */
export class FileSystemTiddlersReadStream extends Readable {
  private readonly workspace: IWikiWorkspace;
  private readonly chunkSize: number;
  private readonly additionalContent?: string[];
  private readonly quickLoadLimit: number;

  private tiddlerFiles: string[] = [];
  private currentIndex = 0;
  private hasStarted = false;
  private tiddlerCount = 0;

  constructor(workspace: IWikiWorkspace, options?: IFileSystemTiddlersReadStreamOptions) {
    super({ encoding: 'utf8' });
    this.workspace = workspace;
    this.chunkSize = options?.chunkSize ?? 100;
    this.additionalContent = options?.additionalContent;
    this.quickLoadLimit = options?.quickLoad === true ? QUICK_LOAD_LIMIT : -1;
  }

  init(): void {
    try {
      const tiddlerFolderPath = getWikiTiddlerFolderPath(this.workspace);

      const folder = new Directory(tiddlerFolderPath);
      if (!folder.exists) {
        console.warn(`Tiddlers folder does not exist: ${tiddlerFolderPath}`);
        return;
      }

      // Recursively collect all tiddler files (.tid, .json, .meta) from tiddlers/ and subdirectories
      this.tiddlerFiles = this.collectTiddlerFiles(folder);

      console.log(`Found ${this.tiddlerFiles.length} tiddler files in ${tiddlerFolderPath}`);
    } catch (error) {
      console.error(`FileSystemTiddlersReadStream init error: ${(error as Error).message}`);
      this.emit('error', error);
    }
  }

  /**
   * Recursively collect tiddler file URIs from a directory tree.
   * Collects .tid files, .json tiddler files, and .meta companion files.
   * Skips .git, node_modules, and other non-tiddler directories.
   */
  private collectTiddlerFiles(directory: Directory): string[] {
    const result: string[] = [];
    try {
      const entries = directory.list();
      for (const entry of entries) {
        if (entry instanceof Directory) {
          const directoryName = entry.name.replace(/\/$/, '');
          if (directoryName === '.git' || directoryName === 'node_modules' || directoryName === '.DS_Store' || directoryName === 'output') {
            continue;
          }
          result.push(...this.collectTiddlerFiles(entry));
        } else if (entry instanceof File) {
          // Collect .tid and .json tiddler files
          if (entry.name.endsWith('.tid') || entry.name.endsWith('.json')) {
            result.push(entry.uri);
          } // Collect .meta files (they accompany binary files like images)
          // We'll parse the .meta to load binary tiddler metadata
          else if (entry.name.endsWith('.meta')) {
            result.push(entry.uri);
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
        // First chunk: output array opening bracket
        if (!this.hasStarted) {
          this.hasStarted = true;
          this.push('[');

          // Add additional content if provided
          if (this.additionalContent && this.additionalContent.length > 0) {
            const additionalJson = this.additionalContent.join(',');
            if (additionalJson) {
              this.push(additionalJson);
              if (this.tiddlerFiles.length > 0) {
                this.push(',');
              }
            }
          }
          return;
        }

        // Check if we've reached the end
        if (this.currentIndex >= this.tiddlerFiles.length) {
          this.push(']'); // Close the JSON array
          this.push(null); // Signal end of stream
          return;
        }

        // Check quick load limit
        if (this.quickLoadLimit > 0 && this.tiddlerCount >= this.quickLoadLimit) {
          this.push(']');
          this.push(null);
          return;
        }

        // Read and process a chunk of tiddlers
        const chunk: Array<Record<string, string | string[]>> = [];
        const endIndex = Math.min(this.currentIndex + this.chunkSize, this.tiddlerFiles.length);
        const limitedEndIndex = this.quickLoadLimit > 0
          ? Math.min(endIndex, this.currentIndex + (this.quickLoadLimit - this.tiddlerCount))
          : endIndex;

        for (let index = this.currentIndex; index < limitedEndIndex; index++) {
          const filePath = this.tiddlerFiles[index];
          const tiddler = await this.readTiddlerFromFile(filePath);
          if (tiddler) {
            // Create skinny tiddler unless it should save full
            const tiddlerToSave = shouldSaveFullTiddler(tiddler) ? tiddler : makeSkinnyTiddler(tiddler);
            chunk.push(tiddlerToSave as Record<string, string | string[]>);
            this.tiddlerCount++;
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
          if (
            this.currentIndex < this.tiddlerFiles.length &&
            (this.quickLoadLimit <= 0 || this.tiddlerCount < this.quickLoadLimit)
          ) {
            this.push(',');
          }
        }
      } catch (error) {
        console.error(`FileSystemTiddlersReadStream _read error: ${(error as Error).message}`);
        this.emit('error', error);
      }
    })();
  }

  /**
   * Read and parse a single tiddler file.
   * Supports .tid (header+body), .json (tiddler JSON), and .meta (binary companion).
   */
  private async readTiddlerFromFile(filePath: string): Promise<ITiddlerFields | null> {
    try {
      const file = new File(filePath);
      const filename = filePath.split('/').pop() ?? '';

      if (filename.endsWith('.json')) {
        // JSON tiddler file (e.g., plugin.info, or tiddler-as-json)
        const content = await file.text();
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          // JSON may be a single tiddler or an array of tiddlers
          if (Array.isArray(parsed)) {
            // Array of tiddlers — only return first, stream handles one-at-a-time
            return parsed.length > 0 ? processFields(parsed[0] as Partial<ITiddlerFields>) as ITiddlerFields : null;
          }
          if (parsed.title) {
            return processFields(parsed as Partial<ITiddlerFields>) as ITiddlerFields;
          }
          return null;
        } catch {
          return null;
        }
      } else if (filename.endsWith('.meta')) {
        // .meta file accompanies a binary file; load metadata and set _canonical_uri
        const metaContent = await file.text();
        const metaFields = parseMetadataFile(metaContent);
        const binaryPath = filePath.replace(/\.meta$/, '');
        const binaryFile = new File(binaryPath);
        if (!metaFields.title) {
          metaFields.title = getTitleFromFilename(filename.replace(/\.meta$/, ''));
        }
        if (binaryFile.exists) {
          // Set canonical URI so WebView knows where to find the binary
          const workspaceBase = this.workspace.wikiFolderLocation;
          metaFields._canonical_uri = binaryPath.replace(workspaceBase + '/', '');
        }
        return processFields(metaFields as Partial<ITiddlerFields>) as ITiddlerFields;
      } else {
        // .tid file (header fields + text body)
        const content = await file.text();
        const fallbackTitle = getTitleFromFilename(filename);
        const fields = parseTiddlerFile(content, { title: fallbackTitle });
        return processFields(fields) as ITiddlerFields;
      }
    } catch (error) {
      console.error(`Error reading tiddler file ${filePath}: ${(error as Error).message}`);
      return null;
    }
  }
}
