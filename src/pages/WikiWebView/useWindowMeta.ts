import { IWikiWorkspace } from "../../store/wiki";

export interface WindowMeta {
  workspaceID: string;
}

export function useWindowMeta(workspace: IWikiWorkspace ) {
  return `
    window.meta = 
  `
}