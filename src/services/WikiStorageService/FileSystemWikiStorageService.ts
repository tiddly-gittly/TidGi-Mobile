/**
 * FileSystem-based Wiki Storage Service
 * Replaces SQLite-based storage with git repository filesystem storage
 *
 * Purpose: Save/load tiddlers as .tid/.meta files in workspace git repository
 */

import { Directory, File } from 'expo-file-system';
import { Observable } from 'rxjs';
import type { IChangedTiddlers, ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiFilesPathByTitle, getWikiTiddlerFolderPath, getWikiTiddlerPathByTitle } from '../../constants/paths';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace } from '../../store/workspace';
import { gitHasChanges } from '../GitService';
import { processFields } from './tiddlerFileParser';
import { TiddlerRoutingService } from './TiddlerRoutingService';
import { IWikiServerStatusObject } from './types';

/**
 * Service for reading/writing tiddlers to filesystem as .tid/.meta files
 * Used by expo-file-system-syncadaptor in WebView
 */
export class FileSystemWikiStorageService {
  readonly #workspace: IWikiWorkspace;
  readonly #configStore = useConfigStore;
  readonly #routingService: TiddlerRoutingService;

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
    this.#routingService = new TiddlerRoutingService();
  }

  getStatus(): Promise<IWikiServerStatusObject> {
    return Promise.resolve({
      anonymous: false,
      read_only: false,
      space: {
        recipe: 'default',
      },
      username: this.#configStore.getState().userName,
    });
  }

  /**
   * Save tiddler to filesystem as .tid file
   * Returns e-tag for the saved tiddler
   */
  async saveTiddler(title: string, fields: ITiddlerFieldsParam): Promise<string> {
    try {
      const { text, title: _, ...fieldsToSave } = fields as (ITiddlerFieldsParam & { text?: string; title: string });

      // Remove null/undefined fields (create new object to avoid readonly issues)
      const mutableFields: Record<string, unknown> = {};
      Object.keys(fieldsToSave).forEach(key => {
        const value = fieldsToSave[key];
        if (value !== null && value !== undefined) {
          mutableFields[key] = value;
        }
      });

      const processedFields = processFields({ title, ...mutableFields });
      const changeCount = '0';
      const Etag = `"default/${encodeURIComponent(title)}/${changeCount}:"`;

      // Ensure tiddlers folder exists
      const tiddlerFolderPath = getWikiTiddlerFolderPath(this.#workspace);
      const folder = new Directory(tiddlerFolderPath);
      if (!folder.exists) {
        folder.create();
      }

      // Use routing service to determine file path
      const relativePath = await this.#routingService.getTiddlerFilePath(title, processedFields as ITiddlerFields, this.#workspace);
      const fullPath = `${this.#workspace.wikiFolderLocation}/${relativePath}`;

      // Ensure parent directory exists
      const parentDirectory = fullPath.substring(0, fullPath.lastIndexOf('/'));
      const directory = new Directory(parentDirectory);
      if (!directory.exists) {
        directory.create();
      }

      // For binary tiddlers with canonical_uri, save metadata separately
      if (processedFields._canonical_uri) {
        this.#saveBinaryTiddlerMetadata(title, processedFields, fullPath);
      } else {
        // Save as .tid file
        this.#saveTextTiddler(title, text ?? '', fieldsToSave as Record<string, unknown>, fullPath);
      }

      return Etag;
    } catch (error) {
      console.error(`Failed to save tiddler ${title}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Save text tiddler as .tid file
   */
  #saveTextTiddler(title: string, text: string, fields: Record<string, unknown>, filePath: string): void {
    // Build header lines
    const headerLines: string[] = [];
    for (const key of Object.keys(fields)) {
      if (key !== 'text' && key !== 'title') {
        const value = fields[key];
        // Convert arrays to TW format
        if (Array.isArray(value)) {
          const formatted = (value as string[]).map(v => v.includes(' ') ? `[[${v}]]` : v).join(' ');
          headerLines.push(`${key}: ${formatted}`);
        } else if (typeof value === 'string') {
          headerLines.push(`${key}: ${value}`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          headerLines.push(`${key}: ${String(value)}`);
        } else if (value !== undefined && value !== null) {
          headerLines.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
    }

    // Add title field
    headerLines.unshift(`title: ${title}`);

    // Combine header and text
    const content = headerLines.join('\n') + '\n\n' + text;

    new File(filePath).write(content);
  }

  /**
   * Save binary tiddler metadata as .meta file
   */
  #saveBinaryTiddlerMetadata(title: string, fields: Record<string, unknown>, binaryPath: string): void {
    const metaPath = `${binaryPath}.meta`;

    // Build meta content
    const metaLines: string[] = [`title: ${title}`];
    for (const key of Object.keys(fields)) {
      if (key !== 'text' && key !== 'title' && key !== '_canonical_uri') {
        const value = fields[key];
        if (Array.isArray(value)) {
          const formatted = (value as string[]).map(v => v.includes(' ') ? `[[${v}]]` : v).join(' ');
          metaLines.push(`${key}: ${formatted}`);
        } else if (typeof value === 'string') {
          metaLines.push(`${key}: ${value}`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          metaLines.push(`${key}: ${String(value)}`);
        } else if (value !== undefined && value !== null) {
          metaLines.push(`${key}: ${JSON.stringify(value)}`);
        }
      }
    }

    new File(metaPath).write(metaLines.join('\n'));
  }

  /**
   * Delete tiddler from filesystem.
   * First tries the routed path, then falls back to default locations,
   * and finally does a recursive search in the tiddlers directory.
   */
  deleteTiddler(title: string): boolean {
    try {
      if (!title) {
        console.warn(`Failed to delete tiddler with no title`);
        return false;
      }

      // 1. Try the path from routing service (most likely location for saves we did)
      const routedRelativePath = this.#routingService.getTiddlerFilePathSync(title, {} as ITiddlerFields, this.#workspace);
      if (routedRelativePath) {
        const routedFull = `${this.#workspace.wikiFolderLocation}/${routedRelativePath}`;
        const routedFile = new File(routedFull);
        if (routedFile.exists) {
          routedFile.delete();
          return true;
        }
      }

      // 2. Default .tid path
      const tidPath = `${getWikiTiddlerPathByTitle(this.#workspace, title)}.tid`;
      const tidFile = new File(tidPath);
      if (tidFile.exists) {
        tidFile.delete();
        return true;
      }

      // 3. Default files path + .meta
      const filesPath = getWikiFilesPathByTitle(this.#workspace, title);
      const filesFile = new File(filesPath);
      if (filesFile.exists) {
        filesFile.delete();
        const metaFile = new File(`${filesPath}.meta`);
        if (metaFile.exists) metaFile.delete();
        return true;
      }

      // 4. Recursive search in tiddlers/ as last resort
      const found = this.#findTiddlerFileRecursively(title);
      if (found) {
        new File(found).delete();
        // Also delete .meta if paired
        const metaFile = new File(`${found}.meta`);
        if (metaFile.exists) metaFile.delete();
        return true;
      }

      console.warn(`Tiddler file not found for deletion: ${title}`);
      return false;
    } catch (error) {
      console.error(`Failed to delete tiddler ${title}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Search tiddlers directory recursively for a file matching the given title.
   */
  #findTiddlerFileRecursively(title: string): string | undefined {
    const tiddlerFolderPath = getWikiTiddlerFolderPath(this.#workspace);
    const sanitizedTitle = title.replaceAll(/[/\\:*?"<>|]/g, '_');

    const search = (directory: Directory): string | undefined => {
      try {
        for (const entry of directory.list()) {
          if (entry instanceof Directory) {
            const found = search(entry);
            if (found) return found;
          } else if (entry instanceof File) {
            // Match by sanitized title in filename
            const name = entry.name.replace(/\.(tid|meta)$/, '');
            if (name === sanitizedTitle && entry.name.endsWith('.tid')) {
              return entry.uri;
            }
          }
        }
      } catch { /* ignore unreadable dirs */ }
      return undefined;
    };

    return search(new Directory(tiddlerFolderPath));
  }

  /**
   * Load tiddler text from filesystem
   */
  async loadTiddlerText(title: string): Promise<string | undefined> {
    const tiddlerText = (await this.#loadFromFS(title)) ?? this.#loadFromServerAndSaveToFS(title);
    return tiddlerText;
  }

  /**
   * Load tiddler from filesystem
   */
  async #loadFromFS(title: string): Promise<string | undefined> {
    try {
      // Try .tid file first
      const tidPath = `${getWikiTiddlerPathByTitle(this.#workspace, title)}.tid`;
      const tidFile = new File(tidPath);
      if (tidFile.exists) {
        const content = await tidFile.text();
        // Extract text part (everything after first blank line)
        const blankLineMatch = /\r?\n\r?\n/.exec(content);
        if (blankLineMatch !== null) {
          return content.substring(blankLineMatch.index + blankLineMatch[0].length);
        }
      }

      // Try files folder
      return await new File(getWikiFilesPathByTitle(this.#workspace, title)).text();
    } catch {
      // Try canonical_uri path
      try {
        const tiddlerFolderPath = getWikiTiddlerFolderPath(this.#workspace);
        const directory = new Directory(tiddlerFolderPath);
        const files = directory.list();

        // Find corresponding .meta file
        for (const entry of files) {
          if (entry.name.endsWith('.meta')) {
            const metaFile = new File(entry.uri);
            const metaContent = await metaFile.text();

            // Check if this meta file is for our title
            if (metaContent.includes(`title: ${title}`)) {
              // Load the actual binary file
              const binaryPath = entry.uri.replace('.meta', '');
              return await new File(binaryPath).text();
            }
          }
        }
      } catch {
        // Ignore
      }

      return undefined;
    }
  }

  /**
   * Load from server and save to FS
   * Git sync model: updates come via git pull, not individual tiddler fetches
   */
  #loadFromServerAndSaveToFS(title: string): string | undefined {
    // In Git-based sync, we don't fetch individual tiddlers
    console.log(`Individual tiddler fetch not supported in Git mode: ${title}`);
    console.log('Use git pull to sync all changes from server');
    return undefined;
  }

  /**
   * Get wiki change observer
   * Watches filesystem for changes and emits change events
   */
  getWikiChangeObserver$() {
    return new Observable<IChangedTiddlers>((observer) => {
      let isWatching = true;
      const checkInterval = 3000;
      let timerId: ReturnType<typeof setTimeout> | undefined;

      const scheduleNextCheck = () => {
        timerId = setTimeout(() => void checkForChanges(), checkInterval);
      };

      const checkForChanges = async () => {
        if (!isWatching) return;

        try {
          const hasChanges = await gitHasChanges(this.#workspace);

          if (hasChanges) {
            observer.next({} as IChangedTiddlers);
          }
        } catch (error) {
          console.error('Error checking for changes:', error);
        }

        scheduleNextCheck();
      };

      void checkForChanges();

      return () => {
        isWatching = false;
        if (timerId !== undefined) {
          clearTimeout(timerId);
        }
      };
    });
  }
}

// Export alias for compatibility
export { FileSystemWikiStorageService as WikiStorageService };
