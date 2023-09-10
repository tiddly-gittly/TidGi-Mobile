import { useEffect } from 'react';
import { IWikiWorkspace } from '../../store/wiki';
import { sqliteServiceService } from '.';

export function useSQLiteService(workspace: IWikiWorkspace) {
  useEffect(() => {
    return (() => {
      void (async () => {
        try {
          await sqliteServiceService.closeDatabase(workspace);
        } catch (error) {
          console.error(error);
        }
      })();
    });
  }, [workspace]);
}
