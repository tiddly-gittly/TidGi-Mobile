/**
 * Tiddler file path computation for native layer.
 *
 * NOTE: Workspace ROUTING (which workspace a tiddler belongs to) is handled by
 * the syncadaptor in the WebView, which has access to $tw.wiki for tag-tree
 * and filter matching. This service only handles FILE PATH generation —
 * given a workspace, compute the relative path for a .tid file.
 */

import type { ITiddlerFields } from 'tiddlywiki';
import { IWikiWorkspace } from '../../store/workspace';
import { readTidgiConfig } from './tidgiConfigManager';

/**
 * Service for computing tiddler file paths within a workspace.
 */
export class TiddlerRoutingService {
  /**
   * Get file path for a tiddler (async — uses config from disk)
   * Returns relative path within workspace
   */
  public async getTiddlerFilePath(
    title: string,
    fields: ITiddlerFields,
    workspace: IWikiWorkspace,
  ): Promise<string> {
    const config = await readTidgiConfig(workspace);
    return this.computeFilePath(title, fields, workspace, config);
  }

  /**
   * Synchronous version — computes the default path without reading config.
   * Useful for deletion fallback when we need a best-guess path.
   */
  public getTiddlerFilePathSync(
    title: string,
    _fields: ITiddlerFields,
    workspace: IWikiWorkspace,
  ): string {
    let sanitized = title.replaceAll(/["#%&'*/:<=>?\\{}]/g, '_');
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }
    if (workspace.isSubWiki === true) {
      return `${sanitized}.tid`;
    }
    return `tiddlers/${sanitized}.tid`;
  }

  /**
   * Compute file path from title, fields, and loaded config
   */
  private computeFilePath(
    title: string,
    _fields: ITiddlerFields,
    workspace: IWikiWorkspace,
    config: Awaited<ReturnType<typeof readTidgiConfig>>,
  ): string {
    // Sanitize title for filesystem using unified regex
    let sanitized = title.replaceAll(/["#%&'*/:<=>?\\{}]/g, '_');

    // Truncate filename to 200 characters to prevent filesystem path length issues
    // This matches TiddlyWiki5 desktop behavior
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }

    // Apply fileSystemPathFilter if configured and enabled
    if (config.fileSystemPathFilterEnable && typeof config.fileSystemPathFilter === 'string' && config.fileSystemPathFilter.length > 0) {
      // Parse filter expression (simplified — full filter evaluation requires WebView)
      // For now, just use the prefix if it's a simple addprefix filter
      const addprefixMatch = config.fileSystemPathFilter.match(/\[addprefix\[([^\]]+)\]\]/);
      if (addprefixMatch) {
        const prefix = addprefixMatch[1];
        return `${prefix}/${sanitized}.tid`;
      }
    }

    if (workspace.isSubWiki === true) {
      return `${sanitized}.tid`;
    }

    return `tiddlers/${sanitized}.tid`;
  }
}
