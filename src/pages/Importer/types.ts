export interface GitQRData {
  baseUrl: string;
  gitUrl?: string;
  token?: string;
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
  workspaceId: string;
  workspaceName?: string;
  subWorkspaces?: Array<{ id: string; mainWikiID?: string; name: string }>;
}
