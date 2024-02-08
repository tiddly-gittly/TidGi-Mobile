import { useCallback, useState } from 'react';
import { importService } from '../../services/ImportService';
import { IWikiWorkspace } from '../../store/workspace';

export function useImportBinary(newWorkspace: IWikiWorkspace | undefined) {
  const [error, setError] = useState<string | undefined>();
  const [importingBinary, setImportingBinary] = useState<boolean>(false);
  const [importSuccess, setImportSuccess] = useState<boolean>(false);
  const [importBinaryFetchAndWritPercentage, setImportBinaryFetchAndWritPercentage] = useState(0);
  const [importBinaryReadListPercentage, setImportBinaryReadListPercentage] = useState(0);
  const [importWarning, setImportWarning] = useState<string | undefined>();
  const resetState = useCallback(() => {
    setImportBinaryFetchAndWritPercentage(0);
    setImportBinaryReadListPercentage(0);
    setError(undefined);
    setImportingBinary(false);
  }, []);
  const importBinary = useCallback(async () => {
    if (newWorkspace === undefined) return;
    setImportingBinary(true);
    try {
      await importService.loadBinaryTiddlersAsFilesFromServer(newWorkspace, {
        setFetchAndWritProgress: setImportBinaryFetchAndWritPercentage,
        setReadListProgress: setImportBinaryReadListPercentage,
        setWarning: setImportWarning,
      });
      setImportSuccess(true);
    } catch (error) {
      setError(`Failed to import binary tiddlers, maybe you forget to enable custom filter in Tiddlywiki?: ${(error as Error).message} ${(error as Error).stack ?? ''}`);
    } finally {
      setImportingBinary(false);
    }
  }, [newWorkspace]);
  return {
    importBinaryError: error,
    resetState,
    importBinary,
    importingBinary,
    importSuccess,
    importWarning,
    importPercentage: {
      importBinaryFetchAndWritPercentage,
      importBinaryReadListPercentage,
    },
  };
}
