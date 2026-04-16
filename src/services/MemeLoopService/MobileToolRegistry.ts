/**
 * Mobile-safe tool registry - excludes file system and terminal tools.
 *
 * Includes only:
 * - spawnAgent (create sub-agents)
 * - remoteAgent (delegate to remote nodes)
 * - mcpClient (if applicable)
 * - Wiki-specific tools (search, create tiddler)
 * - Utility tools (time, etc.)
 */
import type { IToolRegistry } from './protocol-types';

export interface MobileToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (parameters: Record<string, unknown>) => Promise<unknown>;
}

export class MobileToolRegistry implements IToolRegistry {
  private tools = new Map<string, MobileToolDefinition>();

  registerTool(id: string, impl: unknown): void {
    if (typeof impl === 'object' && impl !== null) {
      this.tools.set(id, impl as MobileToolDefinition);
    }
  }

  getTool(id: string): unknown {
    return this.tools.get(id);
  }

  listTools(): string[] {
    return Array.from(this.tools.keys()).sort();
  }

  /**
   * Register default mobile-safe tools.
   */
  registerDefaults(): void {
    // Time utility
    this.registerTool('get_current_time', {
      id: 'get_current_time',
      name: 'get_current_time',
      description: 'Get the current date and time in ISO format',
      parameters: { type: 'object', properties: {} },
      execute() {
        return Promise.resolve({ time: new Date().toISOString() });
      },
    });

    // Wiki search (stub - will be connected to WikiHookService)
    this.registerTool('search_wiki', {
      id: 'search_wiki',
      name: 'search_wiki',
      description: 'Search tiddlers in the local TiddlyWiki by text query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
      execute(parameters: Record<string, unknown>) {
        const queryText = typeof parameters.query === 'string' ? parameters.query : '';
        // TODO: Connect to WikiHookService
        return Promise.resolve({
          results: [],
          message: `Search for "${queryText}" - wiki search not yet connected`,
        });
      },
    });

    // Create tiddler (stub - will be connected to WikiHookService)
    this.registerTool('create_tiddler', {
      id: 'create_tiddler',
      name: 'create_tiddler',
      description: 'Create a new tiddler in TiddlyWiki',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Tiddler title' },
          text: { type: 'string', description: 'Tiddler content' },
          tags: { type: 'string', description: 'Space-separated tags' },
        },
        required: ['title', 'text'],
      },
      execute(parameters: Record<string, unknown>) {
        const titleText = typeof parameters.title === 'string' ? parameters.title : '';
        // TODO: Connect to WikiHookService
        return Promise.resolve({
          created: true,
          title: titleText,
          message: 'Tiddler creation stub - will connect to WikiHookService',
        });
      },
    });

    // Spawn agent (delegate to sub-agent)
    this.registerTool('spawn_agent', {
      id: 'spawn_agent',
      name: 'spawn_agent',
      description: 'Create a sub-agent to handle a specific task',
      parameters: {
        type: 'object',
        properties: {
          definitionId: { type: 'string', description: 'Agent definition ID' },
          message: {
            type: 'string',
            description: 'Initial message to the agent',
          },
        },
        required: ['definitionId', 'message'],
      },
      execute(_parameters: Record<string, unknown>) {
        // TODO: Implement sub-agent spawning
        return Promise.resolve({
          conversationId: `spawn:${Date.now()}`,
          message: 'Sub-agent spawning not yet implemented',
        });
      },
    });

    // Remote agent (delegate to remote node)
    this.registerTool('remote_agent', {
      id: 'remote_agent',
      name: 'remote_agent',
      description: 'Delegate a task to a remote node via RPC',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: 'Target node ID' },
          method: { type: 'string', description: 'RPC method name' },
          parameters: { type: 'object', description: 'RPC parameters' },
        },
        required: ['nodeId', 'method'],
      },
      execute(_parameters: Record<string, unknown>) {
        // TODO: Connect to MemeLoopService RPC
        return Promise.resolve({
          success: false,
          message: 'Remote agent RPC not yet implemented',
        });
      },
    });
  }

  /**
   * Check if a tool is safe for mobile (no FS/terminal access).
   */
  isSafeTool(toolId: string): boolean {
    const unsafePatterns = [
      'file.',
      'fs.',
      'terminal.',
      'shell.',
      'exec.',
      'process.',
      'system.',
    ];
    return !unsafePatterns.some((pattern) => toolId.startsWith(pattern));
  }

  /**
   * Register a tool only if it's safe for mobile.
   */
  registerSafeTool(id: string, impl: unknown): boolean {
    if (!this.isSafeTool(id)) {
      console.warn(`[MobileToolRegistry] Rejected unsafe tool: ${id}`);
      return false;
    }
    this.registerTool(id, impl);
    return true;
  }
}
