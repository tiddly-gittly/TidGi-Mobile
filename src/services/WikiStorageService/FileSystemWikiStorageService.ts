/**
 * FileSystem-based Wiki Storage Service
 * Replaces SQLite-based storage with git repository filesystem storage
 *
 * Purpose: Save/load tiddlers as .tid/.meta files in workspace git repository
 */

import { Observable } from 'rxjs';
import type { IChangedTiddlers, ITiddlerFields, ITiddlerFieldsParam } from 'tiddlywiki';
import { getWikiFilesPathByTitle, getWikiTiddlerFolderPath, getWikiTiddlerPathByTitle } from '../../constants/paths';
import { useConfigStore } from '../../store/config';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { gitDiffChangedFiles } from '../GitService';
import { deleteFileOrDirectory, ensureDirectory, fileExists, findFileRecursively, readTextFile, writeTextFile } from './fileOperations';
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
  readonly #tiddlerFilePathByTitle = new Map<string, string>();

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
   * Save tiddler to filesystem as .tid file
   * Returns e-tag for the saved tiddler
   */
  async saveTiddler(title: string, fields: ITiddlerFieldsParam, targetWorkspaceId?: string): Promise<string> {
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

      const targetWorkspace = await this.#resolveTargetWorkspace(title, processedFields as ITiddlerFields, targetWorkspaceId);

      // Ensure tiddlers folder exists
      const tiddlerFolderPath = getWikiTiddlerFolderPath(targetWorkspace);
      await ensureDirectory(tiddlerFolderPath);

      // Use routing service to determine file path
      const relativePath = await this.#routingService.getTiddlerFilePath(title, processedFields as ITiddlerFields, targetWorkspace);
      const fullPath = `${targetWorkspace.wikiFolderLocation}/${relativePath}`;

      // Ensure parent directory exists
      const parentDirectory = fullPath.substring(0, fullPath.lastIndexOf('/'));
      await ensureDirectory(parentDirectory);

      // All tiddlers (including attachments with _canonical_uri) saved as .tid in tiddlers/
      // For attachments, the _canonical_uri field in the .tid points to the binary file in files/
      const allFields = { ...fieldsToSave } as Record<string, unknown>;
      if (processedFields._canonical_uri) {
        allFields._canonical_uri = processedFields._canonical_uri;
      }
      await this.#saveTextTiddler(title, text ?? '', allFields, fullPath);
      this.#tiddlerFilePathByTitle.set(title, fullPath);

      return Etag;
    } catch (error) {
      console.error(`Failed to save tiddler ${title}: ${(error as Error).message}`);
      throw error;
    }
  }

  async #resolveTargetWorkspace(title: string, fields: ITiddlerFields, targetWorkspaceId?: string): Promise<IWikiWorkspace> {
    const mainWorkspace = this.#workspace;
    if (mainWorkspace.isSubWiki === true) {
      return mainWorkspace;
    }

    const relatedWorkspaces = this.#getRelatedWorkspaces();

    if (typeof targetWorkspaceId === 'string' && targetWorkspaceId !== '') {
      const requestedWorkspace = relatedWorkspaces.find(workspace => workspace.id === targetWorkspaceId);
      if (requestedWorkspace) {
        return requestedWorkspace;
      }
    }

    if (relatedWorkspaces.length <= 1) {
      return mainWorkspace;
    }

    const routeResult = await this.#routingService.routeTiddler(title, fields, mainWorkspace, relatedWorkspaces);
    const routedWorkspace = relatedWorkspaces.find(workspace => workspace.id === routeResult.workspaceId);
    if (routedWorkspace) {
      return routedWorkspace;
    }

    const mainConfig = await readTidgiConfig(mainWorkspace);
    const subWikis = Array.isArray(mainConfig.subWikis) ? mainConfig.subWikis : [];
    if (subWikis.length === 0) {
      return mainWorkspace;
    }

    const rawTags = (fields as Record<string, unknown>).tags;
    const tiddlerTags = Array.isArray(rawTags)
      ? rawTags.filter((tag): tag is string => typeof tag === 'string')
      : [];

    const matchedSubWiki = subWikis.find((subWiki) => {
      const hasTagRule = Array.isArray(subWiki.tagNames) && subWiki.tagNames.length > 0;
      if (!hasTagRule) return false;
      const isTagTiddler = subWiki.tagNames.includes(title);
      const hasMatchingTag = subWiki.tagNames.some(tag => tiddlerTags.includes(tag));
      return isTagTiddler || hasMatchingTag;
    });

    if (!matchedSubWiki) {
      return mainWorkspace;
    }

    const localSubWorkspace = relatedWorkspaces.find(workspace =>
      workspace.id !== mainWorkspace.id && (
        workspace.id === matchedSubWiki.id ||
        workspace.name === matchedSubWiki.name
      )
    );

    return localSubWorkspace ?? mainWorkspace;
  }

  #getRelatedWorkspaces(): IWikiWorkspace[] {
    const allWikiWorkspaces = useWorkspaceStore.getState().workspaces
      .filter((workspace): workspace is IWikiWorkspace => workspace.type === 'wiki');

    const mainWorkspaceID = this.#workspace.isSubWiki === true && typeof this.#workspace.mainWikiID === 'string'
      ? this.#workspace.mainWikiID
      : this.#workspace.id;

    return allWikiWorkspaces.filter(workspace => workspace.id === mainWorkspaceID || (workspace.isSubWiki === true && workspace.mainWikiID === mainWorkspaceID));
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

  /**
   * Delete tiddler from filesystem.
   * First tries the routed path, then falls back to default locations,
   * and finally does a recursive search in the tiddlers directory.
   */
  async deleteTiddler(title: string): Promise<boolean> {
    try {
      if (!title) {
        console.warn(`Failed to delete tiddler with no title`);
        return true;
      }

      const trackedFilePath = this.#tiddlerFilePathByTitle.get(title);
      if (trackedFilePath && await fileExists(trackedFilePath)) {
        await deleteFileOrDirectory(trackedFilePath);
        await deleteFileOrDirectory(`${trackedFilePath}.meta`);
        this.#tiddlerFilePathByTitle.delete(title);
        return true;
      }

      const routedRelativePath = this.#routingService.getTiddlerFilePathSync(title, {} as ITiddlerFields, this.#workspace);
      if (routedRelativePath) {
        const routedFull = `${this.#workspace.wikiFolderLocation}/${routedRelativePath}`;
        if (await fileExists(routedFull)) {
          await deleteFileOrDirectory(routedFull);
          await deleteFileOrDirectory(`${routedFull}.meta`);
          this.#tiddlerFilePathByTitle.delete(title);
          return true;
        }
      }

      const tidPath = `${getWikiTiddlerPathByTitle(this.#workspace, title)}.tid`;
      if (await fileExists(tidPath)) {
        await deleteFileOrDirectory(tidPath);
        await deleteFileOrDirectory(`${tidPath}.meta`);
        this.#tiddlerFilePathByTitle.delete(title);
        return true;
      }

      const filesPath = getWikiFilesPathByTitle(this.#workspace, title);
      if (await fileExists(filesPath)) {
        await deleteFileOrDirectory(filesPath);
        await deleteFileOrDirectory(`${filesPath}.meta`);
        this.#tiddlerFilePathByTitle.delete(title);
        return true;
      }

      const found = await this.#findTiddlerFileRecursively(title);
      if (found) {
        await deleteFileOrDirectory(found);
        await deleteFileOrDirectory(`${found}.meta`);
        this.#tiddlerFilePathByTitle.delete(title);
        return true;
      }

      console.warn(`Tiddler file not found for deletion: ${title}`);
      return true;
    } catch (error) {
      console.error(`Failed to delete tiddler ${title}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Search tiddlers directory recursively for a file matching the given title.
   */
  async #findTiddlerFileRecursively(title: string): Promise<string | undefined> {
    const tiddlerFolderPath = getWikiTiddlerFolderPath(this.#workspace);
    // Use unified sanitize regex (matches paths.ts INVALID_CHARACTERS_REGEX)
    const sanitizedTitle = title.replaceAll(/["#%&'*/:<=>?\\{}]/g, '_');

    return findFileRecursively(tiddlerFolderPath, (fileName: string) => {
      const name = fileName.replace(/\.(tid|meta)$/, '');
      return name === sanitizedTitle && fileName.endsWith('.tid');
    });
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
      if (await fileExists(tidPath)) {
        this.#tiddlerFilePathByTitle.set(title, tidPath);
        const content = await readTextFile(tidPath);
        // Extract text part (everything after first blank line)
        const blankLineMatch = /\r?\n\r?\n/.exec(content);
        if (blankLineMatch !== null) {
          return content.substring(blankLineMatch.index + blankLineMatch[0].length);
        }
      }

      // Try files folder
      const filesPath = getWikiFilesPathByTitle(this.#workspace, title);
      if (await fileExists(filesPath)) {
        this.#tiddlerFilePathByTitle.set(title, filesPath);
        return await readTextFile(filesPath);
      }
    } catch {
      // Try canonical_uri path — search recursively for matching .meta file
      try {
        const found = await this.#findTiddlerFileRecursively(title);
        if (found) {
          this.#tiddlerFilePathByTitle.set(title, found);
          const content = await readTextFile(found);
          // If it's a .tid file, extract text part
          if (found.endsWith('.tid')) {
            const blankLineMatch = /\r?\n\r?\n/.exec(content);
            if (blankLineMatch !== null) {
              return content.substring(blankLineMatch.index + blankLineMatch[0].length);
            }
          }
          // If it's a binary file with .meta, return the binary content
          return content;
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
   * Derive a tiddler title from a relative file path.
   * Reverses the sanitization applied during save.
   */
  #titleFromFilePath(relativePath: string): string | undefined {
    // Strip directory prefix (tiddlers/, files/, etc.)
    const filename = relativePath.split('/').pop();
    if (!filename) return undefined;
    // Strip .tid or .meta extension
    const title = filename.replace(/\.(tid|meta)$/, '');
    return title || undefined;
  }
}

// Export alias for compatibility
export { FileSystemWikiStorageService as WikiStorageService };
