import i18n from 'i18next';
import { IWikiWorkspace } from '../../store/workspace';

export interface WindowMeta {
  language?: string;
  workspaceID: string;
}

export function getWindowMeta(workspace: IWikiWorkspace) {
  return `
    window.isInTidGi = true;

    window.meta = () => (${
    JSON.stringify({
      workspaceID: workspace.id,
      language: i18n.language,
    })
  });
  `;
}
