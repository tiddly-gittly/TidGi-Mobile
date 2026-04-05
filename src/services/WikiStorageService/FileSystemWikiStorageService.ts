/**
 * FileSystem-based Wiki Storage Service
 *
 * Architecture mirrors desktop's FileSystemAdaptor + boot.files pattern:
 *
 *   Desktop `boot.files[title]` → Mobile `#tiddlerFilePathByTitle`
 *
 * This registry is the SINGLE source of truth for file locations.
 * - Populated at init by `buildFileIndex()` (≈ desktop boot loading)
 * - Updated by `saveTiddler()` after each write
 * - Consulted by `deleteTiddler()` and `loadTiddlerText()` for direct lookup
 *
 * `deleteTiddler` follows desktop semantics exactly:
 *   - Registry has path → delete that file
 *   - Registry empty → tiddler was never on disk → succeed silently
 */

import { toPlainPath } from 'expo-tiddlywiki-filesystem-android-external-storage';
import { Observable } from 'rxjs';
import type { IChangedTiddlers, ITiddlerFields, ITiddlerFieldsParameter } from 'tiddlywiki';
import { getWikiTiddlerFolderPath } from '../../constants/paths';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { gitDiffChangedFiles } from '../GitService';
import { type IScopedLogger, logFor } from '../LoggerService';
import { deleteFileWithEmptyParentsCleanup, ensureDirectory, fileExists, listTidFilesRecursively, readTextFile, writeTextFile } from './fileOperations';
import { processFields } from './tiddlerFileParser';
import { TiddlerRoutingService } from './TiddlerRoutingService';
import { readTidgiConfig } from './tidgiConfigManager';
import { IWikiServerStatusObject } from './types';

/**
 * Service for reading/writing tiddlers to filesystem as .tid/.meta files
 * Used by expo-file-system-syncadaptor in WebView
 */
export class FileSystemWikiStorageService {
  readonly #workspace: IWikiWorkspace;
  readonly #configStore = useConfigStore;
  readonly #routingService: TiddlerRoutingService;
  readonly #logger: IScopedLogger;
  /**
   * Central file path registry — equivalent to desktop's `boot.files`.
   * Maps tiddler title → absolute file path on disk.
   * Populated once by `buildFileIndex()`, then kept in sync by save/delete.
   */
  readonly #tiddlerFilePathByTitle = new Map<string, string>();
  /**
   * Reverse lookup: absolute file path → tiddler title.
   * Built alongside `#tiddlerFilePathByTitle` and kept in sync.
   * Used by `getWikiChangeObserver$` to map git-changed file paths back
   * to tiddler titles without re-parsing file headers.
   */
  readonly #titleByFilePath = new Map<string, string>();

  /**
   * Promise that resolves when `buildFileIndex()` has completed.
   * Any save/delete operations will await this before accessing the registry,
   * ensuring the index is fully populated.
   */
  indexReady: Promise<void> = Promise.resolve();

  constructor(workspace: IWikiWorkspace) {
    this.#workspace = workspace;
    this.#routingService = new TiddlerRoutingService();
    this.#logger = logFor(workspace.id);
  }

  // ─── File Index (≈ desktop boot.files population) ──────────────────────

  /**
   * Scan ALL workspace folders (main + sub-wikis) and build the title→path
   * registry.  Equivalent to desktop's boot loading that populates
   * `boot.files` via `$tw.loadTiddlersFromPath`.
   *
   * Must be called once after construction, before any save/delete.
   */
  async buildFileIndex(): Promise<void> {
    const workspaces = this.#getRelatedWorkspaces();
    this.#logger.log(`buildFileIndex: scanning ${workspaces.length} workspace(s) for .tid files`);
    for (const workspace of workspaces) {
      const folderPath = getWikiTiddlerFolderPath(workspace);
      this.#logger.log(`buildFileIndex: scanning ${toPlainPath(folderPath)}`);
      await this.#indexDirectory(folderPath);
    }
    this.#logger.log(`buildFileIndex: completed. Indexed ${this.#tiddlerFilePathByTitle.size} tiddler(s)`);
    // Log a few sample entries for debugging
    let sampleCount = 0;
    for (const [title, path] of this.#tiddlerFilePathByTitle) {
      if (sampleCount >= 5) break;
      this.#logger.log(`  sample: "${title}" → ${toPlainPath(path)}`);
      sampleCount++;
    }
  }

  /**
   * Recursively scan a directory for .tid files and register their titles.
   * Reads only the header of each file to extract the `title:` field.
   */
  async #indexDirectory(directoryPath: string): Promise<void> {
    try {
      const tidFilePaths = await listTidFilesRecursively(directoryPath);
      for (const filePath of tidFilePaths) {
        await this.#indexTidFile(filePath);
      }
    } catch (error) {
      console.warn(`buildFileIndex: failed to scan ${directoryPath}: ${(error as Error).message}`);
    }
  }

  /**
   * Read the `title:` header from a .tid file and register it.
   */
  async #indexTidFile(filePath: string): Promise<void> {
    try {
      const content = await readTextFile(filePath);
      const title = this.#extractTitleFromHeader(content);
      if (title) {
        this.#tiddlerFilePathByTitle.set(title, filePath);
        this.#titleByFilePath.set(toPlainPath(filePath), title);
      }
    } catch { /* skip unreadable files */ }
  }

  /**
   * Extract the `title:` field value from a .tid file header.
   * Only reads up to the first blank line (header section).
   */
  #extractTitleFromHeader(content: string): string | undefined {
    const blankLineIndex = content.indexOf('\n\n');
    const header = blankLineIndex >= 0 ? content.substring(0, blankLineIndex) : content;
    const match = /^title:\s*(.+)$/m.exec(header);
    return match?.[1]?.trim();
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

  getTrackedTiddlerFilePath(title: string): string | undefined {
    return this.#tiddlerFilePathByTitle.get(title);
  }

  async getRelatedWorkspacesRoutingConfig(): Promise<
    Array<{
      fileSystemPathFilter: string | null;
      fileSystemPathFilterEnable: boolean;
      id: string;
      includeTagTree: boolean;
      isSubWiki: boolean;
      mainWikiID: string | null;
      name: string;
      order: number;
      tagNames: string[];
    }>
  > {
    const relatedWorkspaces = this.#getRelatedWorkspaces();
    const result = await Promise.all(relatedWorkspaces.map(async (workspace) => {
      const config = await readTidgiConfig(workspace);
      return {
        id: workspace.id,
        name: config.name ?? workspace.name,
        order: workspace.order ?? 0,
        isSubWiki: workspace.isSubWiki === true,
        mainWikiID: workspace.mainWikiID ?? null,
        tagNames: Array.isArray(config.tagNames) ? config.tagNames : [],
        includeTagTree: config.includeTagTree === true,
        fileSystemPathFilterEnable: config.fileSystemPathFilterEnable === true,
        fileSystemPathFilter: typeof config.fileSystemPathFilter === 'string' ? config.fileSystemPathFilter : null,
      };
    }));
    return result.sort((workspaceA, workspaceB) => workspaceA.order - workspaceB.order);
  }

  /**
   * Save tiddler to filesystem as .tid file.
   * Returns e-tag for the saved tiddler.
   *
   * Mirrors desktop's saveTiddler flow:
   *   1. getTiddlerFileInfo → determine target path
   *      - if existing file is already in the correct target directory → reuse path (overwrite)
   *      - if directory changed → generate new path
   *   2. saveTiddlerToFile → write to target path
   *   3. cleanupTiddlerFiles → if old path ≠ new path, delete old file (MOVE semantic)
   *   4. boot.files[title] = savedFileInfo → update registry
   */
  async saveTiddler(title: string, fields: ITiddlerFieldsParameter, targetWorkspaceId?: string): Promise<string> {
    await this.indexReady;
    try {
      const { text, title: _, ...fieldsToSave } = fields as (ITiddlerFieldsParameter & { text?: string; title: string });

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

      const targetWorkspace = this.#resolveTargetWorkspace(targetWorkspaceId);
      const targetDirectory = targetWorkspace.wikiFolderLocation;
      this.#logger.log(`saveTiddler "${title}" target workspace=${targetWorkspace.id}`);

      // ─── Desktop getTiddlerFileInfo equivalent ───────────────────────
      // Check if the existing file is already in the correct target directory.
      // If yes → overwrite in place (reuse existing path). This prevents
      // unnecessary file moves and echo loops, matching desktop behavior.
      const oldPath = this.#tiddlerFilePathByTitle.get(title);
      let fullPath: string;

      if (oldPath && this.#isPathWithinDirectory(oldPath, targetDirectory)) {
        // File is already in the correct workspace directory — overwrite in place
        fullPath = oldPath;
      } else {
        // Directory changed (or no existing file) — generate new path
        const tiddlerFolderPath = getWikiTiddlerFolderPath(targetWorkspace);
        await ensureDirectory(tiddlerFolderPath);

        const relativePath = await this.#routingService.getTiddlerFilePath(title, processedFields as ITiddlerFields, targetWorkspace);
        fullPath = `${targetWorkspace.wikiFolderLocation}/${relativePath}`;
      }

      // Ensure parent directory exists
      const parentDirectory = fullPath.substring(0, fullPath.lastIndexOf('/'));
      await ensureDirectory(parentDirectory);

      // Write the tiddler file
      const allFields = { ...fieldsToSave } as Record<string, unknown>;
      if (processedFields._canonical_uri) {
        allFields._canonical_uri = processedFields._canonical_uri;
      }
      await this.#saveTextTiddler(title, text ?? '', allFields, fullPath);
      const plainSavePath = toPlainPath(fullPath);
      this.#logger.log(`saveTiddler "${title}" → ${plainSavePath}`);
      console.log(`${new Date().toISOString()} [WikiStorageService] saveTiddler "${title}" written to ${plainSavePath}`);

      // ─── Desktop cleanupTiddlerFiles equivalent ──────────────────────
      // If the file moved to a different location (routing changed),
      // delete the old file. This implements the MOVE semantic.
      if (oldPath && oldPath !== fullPath) {
        // Remove old reverse index entry
        this.#titleByFilePath.delete(toPlainPath(oldPath));
        try {
          if (await fileExists(oldPath)) {
            await deleteFileWithEmptyParentsCleanup(oldPath, this.#getCleanupStopDirectory(oldPath));
          }
          // Best-effort .meta companion cleanup
          const oldMetaPath = `${oldPath}.meta`;
          if (await fileExists(oldMetaPath)) {
            await deleteFileWithEmptyParentsCleanup(oldMetaPath, this.#getCleanupStopDirectory(oldMetaPath));
          }
        } catch (error) {
          console.warn(`saveTiddler cleanup: failed to remove old file ${oldPath}: ${(error as Error).message}`);
        }
      }

      // Update registries (≈ desktop boot.files[title] = savedFileInfo)
      this.#tiddlerFilePathByTitle.set(title, fullPath);
      this.#titleByFilePath.set(toPlainPath(fullPath), title);

      return Etag;
    } catch (error) {
      this.#logger.error(`Failed to save tiddler "${title}":`, error);
      throw error;
    }
  }

  /**
   * Check if a file path is within a directory tree.
   * Handles both plain paths and file:// URIs by normalizing before comparison.
   * Mirrors desktop's: normalizedExisting.startsWith(normalizedTarget)
   */
  #isPathWithinDirectory(filePath: string, directoryPath: string): boolean {
    const normalizedFile = toPlainPath(filePath);
    const normalizedDirectory = toPlainPath(directoryPath);
    // Ensure directory ends with / for proper prefix matching
    const directoryWithSlash = normalizedDirectory.endsWith('/') ? normalizedDirectory : `${normalizedDirectory}/`;
    return normalizedFile.startsWith(directoryWithSlash);
  }

  /**
   * Resolve which workspace to save the tiddler into.
   *
   * Routing logic lives in the syncadaptor (WebView side) which has full
   * $tw.wiki access for tag-tree / filter matching.  The syncadaptor passes
   * the resolved `targetWorkspaceId` to us — we just look it up.
   *
   * This mirrors desktop's pattern where getTiddlerFileInfo (which has
   * access to the wiki) determines the target directory, and the storage
   * layer just writes to it.
   */
  #resolveTargetWorkspace(targetWorkspaceId?: string): IWikiWorkspace {
    if (this.#workspace.isSubWiki === true) {
      return this.#workspace;
    }

    if (typeof targetWorkspaceId === 'string' && targetWorkspaceId !== '') {
      const relatedWorkspaces = this.#getRelatedWorkspaces();
      const found = relatedWorkspaces.find(workspace => workspace.id === targetWorkspaceId);
      if (found) return found;
    }

    return this.#workspace;
  }

  #getRelatedWorkspaces(): IWikiWorkspace[] {
    const allWikiWorkspaces = useWorkspaceStore.getState().workspaces
      .filter((workspace): workspace is IWikiWorkspace => workspace.type === 'wiki');

    const mainWorkspaceID = this.#workspace.isSubWiki === true && typeof this.#workspace.mainWikiID === 'string'
      ? this.#workspace.mainWikiID
      : this.#workspace.id;

    return allWikiWorkspaces.filter(workspace => workspace.id === mainWorkspaceID || (workspace.isSubWiki === true && workspace.mainWikiID === mainWorkspaceID));
  }

  #getCleanupStopDirectory(filePath: string): string | undefined {
    const plainPath = toPlainPath(filePath);
    const relatedWorkspaces = this.#getRelatedWorkspaces();
    for (const workspace of relatedWorkspaces) {
      const stopDirectory = getWikiTiddlerFolderPath(workspace);
      const plainStopDirectory = toPlainPath(stopDirectory).replace(/\/$/, '');
      if (plainPath.startsWith(`${plainStopDirectory}/`) || plainPath === plainStopDirectory) {
        return stopDirectory;
      }
    }
    return undefined;
  }

  /**
   * Save text tiddler as .tid file
   */
  async #saveTextTiddler(title: string, text: string, fields: Record<string, unknown>, filePath: string): Promise<void> {
    // Build header lines (exclude text, title, and bag fields)
    const headerLines: string[] = [];
    for (const key of Object.keys(fields)) {
      if (key !== 'text' && key !== 'title' && key !== 'bag') {
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

    // Combine header and text with blank line separator
    // Note: Consider atomic write (write-to-temp-then-rename) for crash safety
    const content = text ? headerLines.join('\n') + '\n\n' + text : headerLines.join('\n');
    await writeTextFile(filePath, content);
  }

  // ─── Delete (≈ desktop FileSystemAdaptor.deleteTiddler) ─────────────

  /**
   * Delete a tiddler's file from disk.
   *
   * Mirrors desktop logic exactly:
   *   const fileInfo = boot.files[title];
   *   if (!fileInfo) { callback(null, null); return; }
   *   deleteTiddlerFile(fileInfo);
   *
   * The file path registry (`#tiddlerFilePathByTitle`) is our `boot.files`.
   * If the registry has no entry, the tiddler was never persisted — succeed
   * silently, exactly like desktop.
   */
  async deleteTiddler(title: string, exactFilePath?: string): Promise<boolean> {
    await this.indexReady;
    // Resolve the file path: prefer caller-supplied path, then registry
    const registryPath = this.#tiddlerFilePathByTitle.get(title);
    const filePath = (typeof exactFilePath === 'string' && exactFilePath.length > 0)
      ? exactFilePath
      : registryPath;

    if (!filePath) {
      // Not in registry — tiddler was never on disk (e.g. in-memory draft).
      // Desktop: callback(null, null);  Mobile: return true.
      this.#logger.log(`deleteTiddler "${title}": not in registry, nothing to delete`);
      return true;
    }

    this.#logger.log(`deleteTiddler "${title}" → ${toPlainPath(filePath)}`);
    this.#logger.log('deleteTiddler input details', {
      exactFilePath,
      registryPath,
      resolvedPath: filePath,
      title,
    });

    try {
      const exists = await fileExists(filePath);
      this.#logger.log(`deleteTiddler exists(${toPlainPath(filePath)}) => ${String(exists)}`);
      if (exists) {
        await deleteFileWithEmptyParentsCleanup(filePath, this.#getCleanupStopDirectory(filePath));
        // Verify deletion succeeded
        const stillExists = await fileExists(filePath);
        this.#logger.log(`deleteTiddler verify exists(${toPlainPath(filePath)}) => ${String(stillExists)}`);
        if (stillExists) {
          this.#logger.error(`deleteTiddler "${title}": file still exists after delete! path=${toPlainPath(filePath)}`);
        }
      } else {
        // The file was not found at the registered path. This can happen when
        // the path format (URI vs plain) drifted between save and delete.
        // Try with the normalized plain path as a fallback.
        const plainPath = toPlainPath(filePath);
        const existsPlain = await fileExists(plainPath);
        this.#logger.log(`deleteTiddler fallback exists(${plainPath}) => ${String(existsPlain)}`);
        if (existsPlain) {
          this.#logger.warn(`deleteTiddler "${title}": file not found at registered path, but found via plain path. Deleting ${plainPath}`);
          await deleteFileWithEmptyParentsCleanup(plainPath, this.#getCleanupStopDirectory(filePath));
        } else {
          this.#logger.warn(`deleteTiddler "${title}": file not found at ${toPlainPath(filePath)} (may have been externally removed)`);
        }
      }
      // Best-effort .meta companion cleanup
      const metaPath = `${filePath}.meta`;
      if (await fileExists(metaPath)) {
        await deleteFileWithEmptyParentsCleanup(metaPath, this.#getCleanupStopDirectory(metaPath));
      }
    } catch (error) {
      this.#logger.error(`deleteTiddler "${title}": failed to remove ${toPlainPath(filePath)}:`, error);
    }

    this.#tiddlerFilePathByTitle.delete(title);
    this.#titleByFilePath.delete(toPlainPath(filePath));
    if (typeof registryPath === 'string' && registryPath !== filePath) {
      this.#titleByFilePath.delete(toPlainPath(registryPath));
    }
    return true;
  }

  // ─── Load ──────────────────────────────────────────────────────────────

  /**
   * Load the text body of a tiddler from its .tid file.
   * Uses the registry for direct path lookup — no searching needed.
   */
  async loadTiddlerText(title: string): Promise<string | undefined> {
    const filePath = this.#tiddlerFilePathByTitle.get(title);
    if (!filePath) {
      return undefined;
    }
    try {
      const content = await readTextFile(filePath);
      // .tid format: header fields separated by blank line from body
      const blankLineMatch = /\r?\n\r?\n/.exec(content);
      if (blankLineMatch !== null) {
        return content.substring(blankLineMatch.index + blankLineMatch[0].length);
      }
      // No blank line — file has only headers, no body text
      return '';
    } catch (error) {
      console.warn(`loadTiddlerText "${title}": failed to read ${filePath}: ${(error as Error).message}`);
      return undefined;
    }
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
          const changedFiles = await gitDiffChangedFiles(this.#workspace);
          if (changedFiles.length > 0) {
            // Convert changed file paths to tiddler titles
            const changes: IChangedTiddlers = {};
            for (const changedFile of changedFiles) {
              // Derive tiddler title from file path
              const title = this.#titleFromFilePath(changedFile.path);
              if (title) {
                if (changedFile.type === 'delete') {
                  changes[title] = { deleted: true };
                } else {
                  changes[title] = { modified: true };
                }
              }
            }
            if (Object.keys(changes).length > 0) {
              observer.next(changes);
            }
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

  /**
   * Derive a tiddler title from a file path, using either the reverse index
   * or the full workspace-relative path. The `relativePath` comes from
   * isomorphic-git's statusMatrix (relative to workspace root).
   */
  #titleFromFilePath(relativePath: string): string | undefined {
    // Try reverse lookup first: build absolute path and check
    const absolutePath = `${toPlainPath(this.#workspace.wikiFolderLocation)}/${relativePath}`;
    const titleFromIndex = this.#titleByFilePath.get(absolutePath);
    if (titleFromIndex) return titleFromIndex;

    // Also try checking all related workspace roots
    for (const [title, filePath] of this.#tiddlerFilePathByTitle) {
      const plainFilePath = toPlainPath(filePath);
      if (plainFilePath.endsWith(`/${relativePath}`) || plainFilePath === absolutePath) {
        return title;
      }
    }

    return undefined;
  }
}

// Export alias for compatibility
export { FileSystemWikiStorageService as WikiStorageService };
