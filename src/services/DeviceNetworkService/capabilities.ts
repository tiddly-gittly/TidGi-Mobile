import type { DeviceCapabilities } from 'memeloop/device-network';

export interface MobileWikiCapabilityInput {
  id: string;
  name: string;
  type?: string;
  wikiFolderLocation?: string;
}

/** Mobile cannot advertise agentLoop until an inbound RPC handler is wired. */
export function buildMobileCapabilities(workspaces: readonly MobileWikiCapabilityInput[]): DeviceCapabilities {
  const wikis = workspaces.flatMap(workspace =>
    workspace.type === 'wiki' && typeof workspace.wikiFolderLocation === 'string'
      ? [{ wikiId: workspace.id, title: workspace.name, pathHint: workspace.wikiFolderLocation }]
      : []
  );
  return {
    tools: [],
    mcpServers: [],
    hasWiki: wikis.length > 0,
    agentLoop: false,
    imChannels: [],
    wikis,
  };
}
