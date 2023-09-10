import { useEffect, useRef } from 'react';
import { IWikiWorkspace } from '../../store/wiki';
import { sqliteServiceService } from '.';

export function useCloseSQLite(workspace: IWikiWorkspace | undefined) {
  // use ref to prevent update to workspace.lastLocationHash trigger this effect
  const databaseToCloseReference = useRef<IWikiWorkspace | undefined>(workspace);
  useEffect(() => {
    return (() => {
      void (async () => {
        try {
          if (databaseToCloseReference.current === undefined) return;
          console.log(`Closing sqlite database for ${databaseToCloseReference.current.id} in useSQLiteService`);
          // eslint-disable-next-line react-hooks/exhaustive-deps
          await sqliteServiceService.closeDatabase(databaseToCloseReference.current);
        } catch (error) {
          console.error(error);
        }
      })();
    });
  }, []);
}
