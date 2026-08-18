import type { IWikiWorkspace, IWorkspace } from '../store/workspace';

export function findMainWikiWorkspace(
  workspace: IWikiWorkspace,
  workspaces: readonly IWorkspace[],
): IWikiWorkspace {
  if (workspace.isSubWiki !== true || typeof workspace.mainWikiID !== 'string') return workspace;
  return workspaces.find((candidate): candidate is IWikiWorkspace =>
    (candidate.type === undefined || candidate.type === 'wiki') &&
    candidate.id === workspace.mainWikiID &&
    candidate.isSubWiki !== true
  ) ?? workspace;
}

export function getRelatedWikiWorkspaces(
  workspace: IWikiWorkspace,
  workspaces: readonly IWorkspace[],
): IWikiWorkspace[] {
  const mainWorkspace = findMainWikiWorkspace(workspace, workspaces);
  if (mainWorkspace.id === workspace.id && workspace.isSubWiki === true) return [workspace];
  return [
    mainWorkspace,
    ...workspaces.filter((candidate): candidate is IWikiWorkspace =>
      (candidate.type === undefined || candidate.type === 'wiki') &&
      candidate.isSubWiki === true &&
      candidate.mainWikiID === mainWorkspace.id
    ),
  ];
}

export function getSyncConfigurationWorkspace(
  workspace: IWikiWorkspace,
  workspaces: readonly IWorkspace[],
): IWikiWorkspace {
  return findMainWikiWorkspace(workspace, workspaces);
}
