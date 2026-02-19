export interface GitQRData {
  baseUrl: string;
  token?: string;
  workspaceId: string;
  workspaceName?: string;
  subWorkspaces?: Array<{ id: string; mainWikiID?: string; name: string }>;
}
