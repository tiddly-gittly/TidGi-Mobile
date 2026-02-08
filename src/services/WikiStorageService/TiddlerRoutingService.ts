/**
 * Tiddler Routing Service for native layer
 * Communicates with WebView to determine tiddler routing and file paths
 */

import type { ITiddlerFields } from 'tw5-typed';
import { IWikiWorkspace } from '../../store/workspace';
import { parseStringArray } from './tiddlerFileParser';
import { readTidgiConfig } from './tidgiConfigManager';

/**
 * Workspace routing configuration (subset of fields needed for routing)\n * Uses Desktop-compatible field names.\n */
export interface IWorkspaceRoutingConfig {
  fileSystemPathFilter?: string | null;
  fileSystemPathFilterEnable?: boolean;
  id: string;
  includeTagTree?: boolean;
  name: string;
  tagNames?: string[];
}

/**
 * Routing result from WebView
 */
export interface IRoutingResult {
  relativePath?: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Service for routing tiddlers to appropriate workspaces
 * Matches Desktop's routingUtilities.ts logic: iterate workspaces in order,\n * first match wins.
 */
export class TiddlerRoutingService {
  /**
   * Route a tiddler to appropriate workspace using tidgi.config.json rules.\n   * Iterates through all workspaces sorted by order; first match wins.\n   * Falls back to the main workspace if no match is found.
   */
  public async routeTiddler(
    title: string,
    fields: ITiddlerFields,
    mainWorkspace: IWikiWorkspace,
    allWorkspaces: IWikiWorkspace[],
  ): Promise<IRoutingResult> {
    // Sort workspaces by order (matching Desktop's workspaceSorter behavior)
    const sorted = [...allWorkspaces].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const workspace of sorted) {
      if (workspace.type !== 'wiki') continue;
      const config = await readTidgiConfig(workspace);
      if (this.#hasRoutingConfig(config) && this.#shouldRouteToWorkspace(title, fields, config)) {
        return {
          workspaceId: workspace.id,
          workspaceName: config.name ?? workspace.name,
        };
      }
    }

    // No match: return main workspace
    return {
      workspaceId: mainWorkspace.id,
      workspaceName: mainWorkspace.name,
    };
  }

  /**
   * Check if a workspace config has any routing rules configured
   */
  #hasRoutingConfig(config: Awaited<ReturnType<typeof readTidgiConfig>>): boolean {
    const hasTagNames = Array.isArray(config.tagNames) && config.tagNames.length > 0;
    const hasFilter = config.fileSystemPathFilterEnable === true && typeof config.fileSystemPathFilter === 'string' && config.fileSystemPathFilter.length > 0;
    return hasTagNames || hasFilter;
  }

  /**
   * Check if tiddler should be routed to workspace based on config
   * For draft tiddlers, merge tags from the original tiddler to ensure drafts
   * are saved to the same location as their target
   */
  #shouldRouteToWorkspace(
    title: string,
    fields: ITiddlerFields,
    config: Awaited<ReturnType<typeof readTidgiConfig>>,
  ): boolean {
    // Check tag-based routing
    if (config.tagNames && config.tagNames.length > 0) {
      // Extract tags from fields, supporting both array and TiddlyWiki string format
      const rawTags = (fields as Record<string, unknown>).tags;
      const tiddlerTags: string[] = Array.isArray(rawTags)
        ? rawTags as string[]
        : (typeof rawTags === 'string' ? parseStringArray(rawTags) : []);

      // For draft tiddlers, also consider the original tiddler's tags
      // This ensures drafts are saved to the same sub-wiki as their target
      const draftOf = (fields as Record<string, unknown>)['draft.of'];
      if (draftOf && typeof draftOf === 'string') {
        // Note: In mobile context, we don't have access to $tw.wiki to fetch original tiddler
        // The caller should pass merged tags if available, or we rely on draft's own tags
        // Desktop version fetches original tiddler from wiki, but mobile needs different approach
      }

      // Check direct tag match
      const hasMatchingTag = config.tagNames.some(tag => tiddlerTags.includes(tag));
      if (hasMatchingTag) return true;

      // Check if tiddler title is a tag name (it's a "tag tiddler")
      if (config.tagNames.includes(title)) return true;

      // Note: includeTagTree requires WebView filter evaluation
    }

    return false;
  }

  /**
   * Get file path for a tiddler (async — uses config from disk)
   * Returns relative path within workspace
   */
  public async getTiddlerFilePath(
    title: string,
    fields: ITiddlerFields,
    workspace: IWikiWorkspace,
  ): Promise<string> {
    // Load config to check for fileSystemPathFilters
    const config = await readTidgiConfig(workspace);
    return this.computeFilePath(title, fields, config);
  }

  /**
   * Synchronous version — computes the default path without reading config.
   * Useful for deletion fallback when we need a best-guess path.
   */
  public getTiddlerFilePathSync(
    title: string,
    _fields: ITiddlerFields,
    _workspace: IWikiWorkspace,
  ): string {
    // Sanitize and truncate filename
    let sanitized = title.replaceAll(/["#%&'*/:<=>?\\{}]/g, '_');
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }
    return `tiddlers/${sanitized}.tid`;
  }

  /**
   * Compute file path from title, fields, and loaded config
   */
  private computeFilePath(
    title: string,
    fields: ITiddlerFields,
    config: Awaited<ReturnType<typeof readTidgiConfig>>,
  ): string {
    // Sanitize title for filesystem using unified regex
    let sanitized = title.replaceAll(/["#%&'*/:<=>?\\{}]/g, '_');

    // Truncate filename to 200 characters to prevent filesystem path length issues
    // This matches TiddlyWiki5 desktop behavior
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }

    // Check if it's a binary tiddler with canonical_uri
    if (fields._canonical_uri) {
      // Already has a path, use it
      return fields._canonical_uri as string;
    }

    // Check tiddler type
    const type = fields.type as string | undefined;

    // Binary tiddlers go to files/
    if (type && this.isBinaryType(type)) {
      return `files/${sanitized}`;
    }

    // Apply fileSystemPathFilter if configured and enabled (Desktop-compatible field names)
    if (config.fileSystemPathFilterEnable && typeof config.fileSystemPathFilter === 'string' && config.fileSystemPathFilter.length > 0) {
      // Parse filter expression (simplified - full implementation needs WebView)
      // For now, just use the prefix if it's a simple addprefix filter
      const addprefixMatch = config.fileSystemPathFilter.match(/\[addprefix\[([^\]]+)\]\]/);
      if (addprefixMatch) {
        const prefix = addprefixMatch[1];
        return `${prefix}/${sanitized}.tid`;
      }
    }

    // Default: text tiddlers go to tiddlers/
    return `tiddlers/${sanitized}.tid`;
  }

  /**
   * Check if a type is binary (images, audio, video, documents, etc)
   */
  private isBinaryType(type: string): boolean {
    const binaryTypes = [
      'image/',
      'audio/',
      'video/',
      'application/pdf',
      'application/zip',
      'application/x-7z-compressed',
      'application/x-rar-compressed',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats',
    ];

    return binaryTypes.some(prefix => type.startsWith(prefix));
  }

  /**
   * Extract routing config from workspace (Desktop-compatible field names)
   */
  public async getRoutingConfig(workspace: IWikiWorkspace): Promise<IWorkspaceRoutingConfig> {
    const config = await readTidgiConfig(workspace);

    return {
      id: workspace.id,
      name: workspace.name || config.name || 'Untitled',
      tagNames: config.tagNames || [],
      includeTagTree: config.includeTagTree || false,
      fileSystemPathFilterEnable: config.fileSystemPathFilterEnable || false,
      fileSystemPathFilter: config.fileSystemPathFilter ?? null,
    };
  }
}

export const tiddlerRoutingService = new TiddlerRoutingService();
