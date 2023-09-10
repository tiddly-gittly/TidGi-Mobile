import { useEffect, useRef } from 'react';
import { IWorkspace } from '../../store/workspace';
import { sqliteServiceService } from '.';

export function useCloseSQLite(workspace?: IWorkspace) {
  // use ref to prevent update to workspace.lastLocationHash trigger this effect
  const databaseToCloseReference = useRef<IWorkspace | undefined>(workspace);
  useEffect(() => {
    return (() => {
      void (async () => {
        try {
          if (databaseToCloseReference.current === undefined) return;
          console.log(`Closing sqlite database for ${databaseToCloseReference.current.id} in useSQLiteService`);
          if (databaseToCloseReference.current?.type === 'wiki') {
            // eslint-disable-next-line react-hooks/exhaustive-deps
            await sqliteServiceService.closeDatabase(databaseToCloseReference.current);
          }
        } catch (error) {
          console.error(error);
        }
      })();
    });
  }, []);
}
