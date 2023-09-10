import { useEffect } from 'react';
import { IWikiWorkspace } from '../../store/wiki';
import { sqliteServiceService } from '.';

export function useSQLiteService(workspace: IWikiWorkspace) {
  useEffect(() => {
    return (() => void sqliteServiceService.closeDatabase(workspace));
  }, [workspace]);
}
