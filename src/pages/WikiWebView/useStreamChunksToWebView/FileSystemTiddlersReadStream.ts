/**
 * FileSystem-based tiddlers read stream
 * Replaces SQLiteTiddlersReadStream for git-based workspace storage
 *
 * Purpose: Read .tid/.meta files from filesystem and stream them as JSON chunks to WebView
 */

import * as FileSystem from 'expo-file-system';
import { Readable } from 'readable-stream';
import { getWikiFilesFolderPath, getWikiTiddlerFolderPath } from '../../../constants/paths';
import { getFileType, getTitleFromFilename, makeSkinnyTiddler, parseJSONSafe, parseMetadataFile, parseTiddlerFile, processFields, shouldSaveFullTiddler } from '../../../services/WikiStorageService/tiddlerFileParser';
import { IWikiWorkspace } from '../../../store/workspace';
import { ITiddlerFields } from 'tiddlywiki';

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
      
      // Check if tiddlers folder exists
      const folderInfo = await FileSystem.getInfoAsync(tiddlerFolderPath);
      if (!folderInfo.exists) {
        console.warn(`Tiddlers folder does not exist: ${tiddlerFolderPath}`);
        return;
      }

      // Read all files in tiddlers folder
      const files = await FileSystem.readDirectoryAsync(tiddlerFolderPath);
      
      // Filter for .tid files only (skip .meta as they're paired with binary files)
      this.tiddlerFiles = files
        .filter(filename => filename.endsWith('.tid'))
        .map(filename => `${tiddlerFolderPath}${filename}`);

      console.log(`Found ${this.tiddlerFiles.length} tiddler files in ${tiddlerFolderPath}`);
    } catch (error) {
      console.error(`FileSystemTiddlersReadStream init error: ${(error as Error).message}`);
      this.emit('error', error);
    }
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

      for (let i = this.currentIndex; i < limitedEndIndex; i++) {
        const filePath = this.tiddlerFiles[i];
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
        if (this.currentIndex < this.tiddlerFiles.length && 
            (this.quickLoadLimit <= 0 || this.tiddlerCount < this.quickLoadLimit)) {
          this.push(',');
        }
      }
    } catch (error) {
      console.error(`FileSystemTiddlersReadStream _read error: ${(error as Error).message}`);
      this.emit('error', error);
    }
  }

  /**
   * Read and parse a single tiddler from a .tid file
   */
  private async readTiddlerFromFile(filePath: string): Promise<ITiddlerFields | null> {
    try {
      const content = await FileSystem.readAsStringAsync(filePath);
      const filename = filePath.split('/').pop() ?? '';
      
      // Derive title from filename
      const title = getTitleFromFilename(filename);
      
      // Parse the .tid file
      const fields = parseTiddlerFile(content, { title });
      
      // Check if there's a corresponding binary file with .meta
      // For binary files, the pattern is: file.ext + file.ext.meta
      const metaPath = filePath.replace(/\.tid$/, '.meta');
      const binaryPath = filePath.replace(/\.tid$/, '');
      
      const metaInfo = await FileSystem.getInfoAsync(metaPath);
      if (metaInfo.exists) {
        // This is metadata for a binary file
        const metaContent = await FileSystem.readAsStringAsync(metaPath);
        const metaFields = parseMetadataFile(metaContent);
        
        // Merge fields
        Object.assign(fields, metaFields);
        
        // Check if binary file exists
        const binaryInfo = await FileSystem.getInfoAsync(binaryPath);
        if (binaryInfo.exists) {
          // Set canonical_uri to point to files/ folder
          const relativeUri = `files/${filename.replace(/\.tid$/, '')}`;
          fields._canonical_uri = relativeUri;
        }
      }
      
      // Process and return fields
      return processFields(fields);
    } catch (error) {
      console.error(`Error reading tiddler file ${filePath}: ${(error as Error).message}`);
      return null;
    }
  }
}
