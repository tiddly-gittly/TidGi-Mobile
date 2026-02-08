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
import { getTitleFromFilename, makeSkinnyTiddler, parseTiddlerFile, processFields, shouldSaveFullTiddler } from '../../../services/WikiStorageService/tiddlerFileParser';
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

  async init(): Promise<void> {
    try {
      const tiddlerFolderPath = getWikiTiddlerFolderPath(this.workspace);

      const folder = new Directory(tiddlerFolderPath);
      if (!folder.exists) {
        console.warn(`Tiddlers folder does not exist: ${tiddlerFolderPath}`);
        return;
      }

      // Recursively collect all .tid files from tiddlers/ and subdirectories
      this.tiddlerFiles = this.collectTidFiles(folder);

      console.log(`Found ${this.tiddlerFiles.length} tiddler files in ${tiddlerFolderPath}`);
    } catch (error) {
      console.error(`FileSystemTiddlersReadStream init error: ${(error as Error).message}`);
      this.emit('error', error);
    }
  }

  /**
   * Recursively collect all .tid file URIs from a directory tree
   */
  private collectTidFiles(directory: Directory): string[] {
    const result: string[] = [];
    try {
      const entries = directory.list();
      for (const entry of entries) {
        if (entry instanceof Directory) {
          // Recurse into subdirectories
          result.push(...this.collectTidFiles(entry));
        } else if (entry instanceof File && entry.name.endsWith('.tid')) {
          result.push(entry.uri);
        }
      }
    } catch (error) {
      console.warn(`Failed to list directory ${directory.uri}: ${(error as Error).message}`);
    }
    return result;
  }

  async _read(): Promise<void> {
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
      const chunk: any[] = [];
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
          chunk.push(tiddlerToSave);
          this.tiddlerCount++;
        }
      }

      this.currentIndex = limitedEndIndex;

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
  }

  /**
   * Read and parse a single tiddler from a .tid file.
   * Title comes from the parsed header fields; filename is only a fallback.
   */
  private async readTiddlerFromFile(filePath: string): Promise<ITiddlerFields | null> {
    try {
      const file = new File(filePath);
      const content = await file.text();
      const filename = filePath.split('/').pop() ?? '';

      // Fallback title from filename (only used if file header has no title)
      const fallbackTitle = getTitleFromFilename(filename);

      // Parse the .tid file (header fields + text body)
      const fields = parseTiddlerFile(content, { title: fallbackTitle });

      // Process and return fields — header title wins over filename-derived title
      return processFields(fields) as ITiddlerFields;
    } catch (error) {
      console.error(`Error reading tiddler file ${filePath}: ${(error as Error).message}`);
      return null;
    }
  }
}
