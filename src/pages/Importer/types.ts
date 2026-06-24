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

export interface HtmlQRData {
  baseUrl: string;
  htmlUrl: string;
  readOnly?: boolean;
  revision?: string;
  syncType: 'html';
  tokenAuthHeaderName?: string;
  tokenAuthHeaderValue?: string;
  workspaceId: string;
  workspaceName?: string;
}

export type ImportQRData = GitQRData | HtmlQRData;
