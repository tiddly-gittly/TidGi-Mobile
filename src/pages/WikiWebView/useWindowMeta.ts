import { IWikiWorkspace } from '../../store/workspace';

export interface WindowMeta {
  workspaceID: string;
}

export function useWindowMeta(workspace: IWikiWorkspace) {
  return `
    window.isInTidGi = true;

    window.meta = () => (${
    JSON.stringify({
      workspaceID: workspace.id,
    })
  });
  `;
}
