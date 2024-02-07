import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';

import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';
import { ImportBinary } from '../../Importer/ImportBinary';

interface ModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function PerformanceToolsModelContent({ id, onClose }: ModalProps): JSX.Element {
  const { t } = useTranslation();

  const wiki = useWorkspaceStore(state =>
    id === undefined ? undefined : state.workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki'))
  );

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  return (
    <ModalContainer>
      <CloseButton mode='outlined' onPress={onClose}>{t('Menu.Close')}</CloseButton>
      <ImportBinary wikiWorkspace={wiki} />
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
`;
const CloseButton = styled(Button)`
  margin-bottom: 10px;
`;
