/**
 * Tiddler Routing Service for native layer
 * Communicates with WebView to determine tiddler routing and file paths
 */

import { ITiddlerFields } from 'tiddlywiki';
import { IWikiWorkspace } from '../../store/workspace';
import { readTidgiConfig } from './tidgiConfigManager';

/**
 * Workspace routing configuration (subset of fields needed for routing)
 */
export interface IWorkspaceRoutingConfig {
  customFilters?: string;
  fileSystemPathFilters?: string;
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
 * Delegates to WebView for complex filter evaluation
 */
export class TiddlerRoutingService {
  /**
   * Route a tiddler to appropriate workspace using tidgi.config.json rules
   * Currently only supports native-side tag matching (without WebView filter engine)
   */
  public async routeTiddler(
    title: string,
    fields: ITiddlerFields,
    workspace: IWikiWorkspace,
    _workspaces: IWikiWorkspace[],
  ): Promise<IRoutingResult> {
    // Native routing with tag-based matching
    const config = await readTidgiConfig(workspace);

    // Check if tiddler matches workspace rules
    if (this.#shouldRouteToWorkspace(title, fields, config)) {
      return {
        workspaceId: workspace.id,
        workspaceName: config.name ?? workspace.name,
      };
    }

    // No match: return main workspace (caller decides default)
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    };
  }

  /**
   * Check if tiddler should be routed to workspace based on config
   */
  #shouldRouteToWorkspace(
    title: string,
    fields: ITiddlerFields,
    config: Awaited<ReturnType<typeof readTidgiConfig>>,
  ): boolean {
    // Check tag-based routing
    if (config.tagNames && config.tagNames.length > 0) {
      // tags may be a string[] or a space-separated string from .tid files
      const rawTags = (fields as Record<string, unknown>).tags;
      const tiddlerTags: string[] = Array.isArray(rawTags)
        ? rawTags as string[]
        : (typeof rawTags === 'string' ? rawTags.split(' ').filter(Boolean) : []);

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
    const sanitized = title.replaceAll(/["#%&'*/:<=>?\\{}]/g, '_');
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
    // Sanitize title for filesystem
    const sanitized = title.replace(/["#%&'*/:<=>?\\{}]/g, '_');

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

    // Apply fileSystemPathFilters if configured
    if (config.fileSystemPathFilters && config.fileSystemPathFilters.length > 0) {
      // Parse filter expression (simplified - full implementation needs WebView)
      // For now, just use the prefix if it's a simple addprefix filter
      const filterString = config.fileSystemPathFilters.join('\n');
      const addprefixMatch = filterString.match(/\[addprefix\[([^\]]+)\]\]/);
      if (addprefixMatch) {
        const prefix = addprefixMatch[1];
        return `${prefix}/${sanitized}.tid`;
      }
    }

    // Default: text tiddlers go to tiddlers/
    return `tiddlers/${sanitized}.tid`;
  }

  /**
   * Check if a type is binary
   */
  private isBinaryType(type: string): boolean {
    const binaryTypes = [
      'image/',
      'audio/',
      'video/',
      'application/pdf',
      'application/zip',
    ];

    return binaryTypes.some(prefix => type.startsWith(prefix));
  }

  /**
   * Extract routing config from workspace
   */
  public async getRoutingConfig(workspace: IWikiWorkspace): Promise<IWorkspaceRoutingConfig> {
    const config = await readTidgiConfig(workspace);

    return {
      id: workspace.id,
      name: workspace.name || config.name || 'Untitled',
      tagNames: config.tagNames || [],
      includeTagTree: config.includeTagTree || false,
      customFilters: config.customFilters?.map(f => f.filter).join('\n'),
      fileSystemPathFilters: config.fileSystemPathFilters?.join('\n'),
    };
  }
}

export const tiddlerRoutingService = new TiddlerRoutingService();
