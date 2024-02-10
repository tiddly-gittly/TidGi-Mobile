/* eslint-disable unicorn/no-useless-undefined */
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, MD3Colors, ProgressBar, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { IWikiWorkspace } from '../../store/workspace';
import { useImportBinary } from './useImportBinary';

const ImportStatusText = styled.Text`
  width: 100%;
  display: flex;
  flex-direction: row;
`;

export function ImportBinary(props: { autoImportBinary?: boolean; wikiWorkspace: IWikiWorkspace }) {
  const { t } = useTranslation();
  const { importBinary, importingBinary, importPercentage, importBinaryError, resetState, importSuccess, importWarning } = useImportBinary(
    props.wikiWorkspace,
  );
  useEffect(() => {
    if (props.autoImportBinary === true) {
      void importBinary();
    }
  }, [importBinary, props.autoImportBinary]);

  const {
    importBinaryFetchAndWritPercentage,
    importBinaryReadListPercentage,
  } = importPercentage;
  return (
    <>
      <Text>{t('AddWorkspace.ImportBinaryFilesDescription')}</Text>
      <Button
        mode='outlined'
        disabled={importingBinary || importSuccess || importBinaryError !== undefined}
        onPress={importBinary}
      >
        <Text>{importSuccess ? t('AddWorkspace.Success') : t('AddWorkspace.ImportBinaryFiles')}</Text>
      </Button>
      {importingBinary && (
        <>
          <Text>
            {t('AddWorkspace.ImportBinaryFiles')} {importBinaryReadListPercentage < 1
              ? `${t('Downloading.ReadList')} ${Math.floor(importBinaryReadListPercentage * 100)}%`
              : (importBinaryFetchAndWritPercentage < 1
                ? `${t('Downloading.FetchAndWrite')} ${Math.floor(importBinaryFetchAndWritPercentage * 100)}%`
                : t('Log.SynchronizationFinish'))}
          </Text>
          <ProgressBar progress={importBinaryReadListPercentage} color={MD3Colors.tertiary40} />
          <ProgressBar progress={importBinaryFetchAndWritPercentage} color={MD3Colors.tertiary50} />
        </>
      )}
      {importBinaryError !== undefined && (
        <>
          <Button
            mode='elevated'
            onPress={resetState}
          >
            <Text>{t('AddWorkspace.Reset')}</Text>
          </Button>
          <ImportStatusText style={{ color: MD3Colors.error50 }}>
            <Text>{t('ErrorMessage')}{' '}</Text>
            {importBinaryError}
          </ImportStatusText>
        </>
      )}
      {importWarning !== undefined && (
        <>
          <Text>{t('AddWorkspace.WarningMessageDescription')}</Text>
          <ImportStatusText style={{ color: MD3Colors.tertiary50 }}>
            <Text>{t('WarningMessage')}{' '}</Text>
            {importWarning}
          </ImportStatusText>
        </>
      )}
    </>
  );
}
