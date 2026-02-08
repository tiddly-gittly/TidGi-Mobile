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
  #webViewRef?: any; // Reference to WebView for message passing

  /**
   * Set WebView reference for communication
   */
  public setWebViewRef(webViewReference: any) {
    this.#webViewRef = webViewReference;
  }

  /**
   * Route a tiddler to appropriate workspace using tidgi.config.json rules
   * For complete routing, delegates to WebView's TiddlyWiki filter engine
   */
  public async routeTiddler(
    title: string,
    fields: ITiddlerFields,
    workspace: IWikiWorkspace,
    workspaces: IWikiWorkspace[],
  ): Promise<IRoutingResult> {
    // Try WebView routing first (for full filter support)
    if (this.#webViewRef) {
      try {
        const result = await this.#routeViaWebView(title, fields, workspace, workspaces);
        if (result) {
          return result;
        }
      } catch (error) {
        console.warn('WebView routing failed, falling back to native:', error);
      }
    }

    // Fallback: Native routing with limited filter support
    const config = await readTidgiConfig(workspace);

    // Check if tiddler matches workspace rules
    if (this.#shouldRouteToWorkspace(title, fields, config)) {
      return {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      };
    }

    // Default: route to main workspace
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    };
  }

  /**
   * Route tiddler via WebView (full TiddlyWiki filter support)
   */
  async #routeViaWebView(
    title: string,
    fields: ITiddlerFields,
    workspace: IWikiWorkspace,
    workspaces: IWikiWorkspace[],
  ): Promise<IRoutingResult | null> {
    return new Promise((resolve, reject) => {
      const messageId = `route-${Date.now()}`;

      // Listen for response
      const handleMessage = (event: any) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.messageId === messageId) {
            window.removeEventListener('message', handleMessage);

            if (data.error) {
              reject(new Error(data.error));
            } else {
              resolve(data.result || null);
            }
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      window.addEventListener('message', handleMessage);

      // Prepare workspace configs for WebView
      const workspaceConfigs = workspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        // Config will be loaded from tidgi.config.json in WebView
      }));

      // Send message to WebView
      this.#webViewRef.postMessage(JSON.stringify({
        type: 'routeTiddler',
        messageId,
        payload: {
          title,
          fields,
          workspaceId: workspace.id,
          workspaces: workspaceConfigs,
        },
      }));

      // Timeout after 5 seconds
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('Routing timeout'));
      }, 5000);
    });
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
      const tiddlerTags = (fields.tags) || [];

      // Check direct tag match
      const hasMatchingTag = config.tagNames.some(tag => tiddlerTags.includes(tag));
      if (hasMatchingTag) return true;

      // Check if tiddler title is a tag name (it's a "tag tiddler")
      if (config.tagNames.includes(title)) return true;

      // Note: includeTagTree requires WebView filter evaluation
      // Will be fully implemented when sub-wiki UI is added
    }

    // Note: customFilters requires WebView filter evaluation
    // Will be fully implemented when sub-wiki UI is added

    return false;
  }

  /**
   * Get file path for a tiddler
   * Returns relative path within workspace
   */
  public async getTiddlerFilePath(
    title: string,
    fields: ITiddlerFields,
    workspace: IWikiWorkspace,
  ): Promise<string> {
    // Load config to check for fileSystemPathFilters
    const config = await readTidgiConfig(workspace);

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
