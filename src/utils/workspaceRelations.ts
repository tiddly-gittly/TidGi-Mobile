import type { IHtmlWorkspace, IWikiWorkspace, IWorkspace } from '../store/workspace';

export function isWikiWorkspace(workspace: IWorkspace): workspace is IWikiWorkspace {
  return workspace.type === undefined || workspace.type === 'wiki';
}

export function isSyncableWorkspace(workspace: IWorkspace): workspace is IHtmlWorkspace | IWikiWorkspace {
  return workspace.type === 'html' || isWikiWorkspace(workspace);
}

export function findMainWikiWorkspace(
  workspace: IWikiWorkspace,
  workspaces: readonly IWorkspace[],
): IWikiWorkspace {
  // Callers often hold a render-time workspace snapshot. Always prefer the
  // current store entry so recently saved sync credentials are visible when a
  // sync starts without requiring the page to render again first.
  const currentWorkspace = workspaces.find((candidate): candidate is IWikiWorkspace => isWikiWorkspace(candidate) && candidate.id === workspace.id) ?? workspace;
  if (currentWorkspace.isSubWiki !== true || typeof currentWorkspace.mainWikiID !== 'string') return currentWorkspace;
  return workspaces.find((candidate): candidate is IWikiWorkspace => isWikiWorkspace(candidate) && candidate.id === currentWorkspace.mainWikiID && candidate.isSubWiki !== true) ??
    currentWorkspace;
}

export function getRelatedWikiWorkspaces(
  workspace: IWikiWorkspace,
  workspaces: readonly IWorkspace[],
): IWikiWorkspace[] {
  const mainWorkspace = findMainWikiWorkspace(workspace, workspaces);
  if (mainWorkspace.id === workspace.id && workspace.isSubWiki === true) return [workspace];
  return [
    mainWorkspace,
    ...workspaces.filter((candidate): candidate is IWikiWorkspace => isWikiWorkspace(candidate) && candidate.isSubWiki === true && candidate.mainWikiID === mainWorkspace.id),
  ];
}

export function getSyncConfigurationWorkspace(
  workspace: IWikiWorkspace,
  workspaces: readonly IWorkspace[],
): IWikiWorkspace {
  return findMainWikiWorkspace(workspace, workspaces);
}

export function getSyncConfigurationWorkspaceByID(
  workspaceID: string,
  workspaces: readonly IWorkspace[],
): IHtmlWorkspace | IWikiWorkspace | undefined {
  const workspace = workspaces.find(candidate => candidate.id === workspaceID);
  if (workspace?.type === 'html') return workspace;
  if (workspace !== undefined && isWikiWorkspace(workspace)) {
    return getSyncConfigurationWorkspace(workspace, workspaces);
  }
  return undefined;
}
