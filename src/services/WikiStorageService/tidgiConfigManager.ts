/**
 * TidGi Config Manager for mobile
 * Handles reading/writing tidgi.config.json with unknown field preservation
 *
 * Purpose: Parse workspace configuration from git repo, preserving Desktop-specific fields
 */

import * as FileSystem from 'expo-file-system';
import { IWikiWorkspace } from '../../store/workspace';

/**
 * Known mobile-relevant fields from tidgi.config.json
 * These are the fields that TidGi-Mobile understands and can modify
 */
export interface ITidgiConfigKnownFields {
  /**
   * Custom filter expressions for routing tiddlers to subwikis
   */
  customFilters?: Array<{
    filter: string;
    path: string;
  }>;
  /**
   * Enable quick load feature
   */
  enableQuickLoad?: boolean;
  /**
   * File system path filters
   */
  fileSystemPathFilters?: string[];
  /**
   * Include tag tree recursively in routing
   */
  includeTagTree?: boolean;
  /**
   * Workspace display name
   */
  name?: string;
  /**
   * Selective sync filter for mobile sync
   */
  selectiveSyncFilter?: string;
  /**
   * Tag-based routing rules
   */
  tagNames?: string[];
  /**
   * Allow reading file attachments
   */
  allowReadFileAttachment?: boolean;
}

/**
 * Full config type (known fields + unknown fields preserved as-is)
 */
export type ITidgiConfig = ITidgiConfigKnownFields & Record<string, unknown>;

/**
 * Default known field values
 */
const DEFAULT_CONFIG: ITidgiConfigKnownFields = {
  enableQuickLoad: false,
  includeTagTree: false,
  allowReadFileAttachment: true,
};

/**
 * Get tidgi.config.json path for a workspace
 */
export function getTidgiConfigPath(workspace: IWikiWorkspace): string {
  return `${workspace.wikiFolderLocation}/tidgi.config.json`;
}

/**
 * Read and parse tidgi.config.json
 * Returns merged config with defaults for known fields, and preserves all unknown fields
 */
export async function readTidgiConfig(workspace: IWikiWorkspace): Promise<ITidgiConfig> {
  try {
    const configPath = getTidgiConfigPath(workspace);
    const fileInfo = await FileSystem.getInfoAsync(configPath);

    if (!fileInfo.exists) {
      // Return defaults if file doesn't exist
      return { ...DEFAULT_CONFIG };
    }

    const content = await FileSystem.readAsStringAsync(configPath);
    const parsedConfig = JSON.parse(content) as Record<string, unknown>;

    // Merge with defaults for known fields only
    const config: ITidgiConfig = {
      ...parsedConfig,
      // Apply defaults only if not present
      enableQuickLoad: parsedConfig.enableQuickLoad ?? DEFAULT_CONFIG.enableQuickLoad,
      includeTagTree: parsedConfig.includeTagTree ?? DEFAULT_CONFIG.includeTagTree,
      allowReadFileAttachment: parsedConfig.allowReadFileAttachment ?? DEFAULT_CONFIG.allowReadFileAttachment,
    };

    return config;
  } catch (error) {
    console.error(`Failed to read tidgi.config.json: ${(error as Error).message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write tidgi.config.json
 * Preserves unknown fields by merging with existing config
 */
export async function writeTidgiConfig(
  workspace: IWikiWorkspace,
  updates: Partial<ITidgiConfigKnownFields>,
): Promise<void> {
  try {
    const configPath = getTidgiConfigPath(workspace);

    // Read existing config to preserve unknown fields
    const existingConfig = await readTidgiConfig(workspace);

    // Merge updates with existing config
    const newConfig: ITidgiConfig = {
      ...existingConfig,
      ...updates,
    };

    // Write back to file
    const content = JSON.stringify(newConfig, null, 2);
    await FileSystem.writeAsStringAsync(configPath, content);
  } catch (error) {
    console.error(`Failed to write tidgi.config.json: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Update single field in tidgi.config.json
 */
export async function updateTidgiConfigField<K extends keyof ITidgiConfigKnownFields>(
  workspace: IWikiWorkspace,
  field: K,
  value: ITidgiConfigKnownFields[K],
): Promise<void> {
  await writeTidgiConfig(workspace, { [field]: value });
}

/**
 * Sync known fields from tidgi.config.json to workspace store
 * Should be called after git pull or workspace load
 */
export async function syncConfigToWorkspace(workspace: IWikiWorkspace): Promise<Partial<IWikiWorkspace>> {
  const config = await readTidgiConfig(workspace);

  return {
    name: config.name ?? workspace.name,
    enableQuickLoad: config.enableQuickLoad,
    selectiveSyncFilter: config.selectiveSyncFilter,
    allowReadFileAttachment: config.allowReadFileAttachment,
  };
}

/**
 * Sync known fields from workspace store to tidgi.config.json
 * Should be called when workspace settings are modified in mobile app
 */
export async function syncWorkspaceToConfig(workspace: IWikiWorkspace): Promise<void> {
  const updates: Partial<ITidgiConfigKnownFields> = {
    name: workspace.name,
    enableQuickLoad: workspace.enableQuickLoad,
    selectiveSyncFilter: workspace.selectiveSyncFilter,
    allowReadFileAttachment: workspace.allowReadFileAttachment,
  };

  await writeTidgiConfig(workspace, updates);
}

// Alias exports for compatibility with UI components
export { readTidgiConfig as getTidgiConfig };
export async function saveTidgiConfig(wikiFolderPath: string, config: ITidgiConfig): Promise<void> {
  // Create temporary workspace object for writeTidgiConfig
  const tempWorkspace = { wikiFolderLocation: wikiFolderPath } as IWikiWorkspace;
  await writeTidgiConfig(tempWorkspace, config);
}
