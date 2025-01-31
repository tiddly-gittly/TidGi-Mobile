/* eslint-disable react-native/no-inline-styles */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import { IPageWorkspace, useWorkspaceStore } from '../../../store/workspace';

interface ModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WebPageEditModelContent({ id, onClose }: ModalProps): JSX.Element {
  const { t } = useTranslation();
  const page = useWorkspaceStore(state => id === undefined ? undefined : state.workspaces.find((w): w is IPageWorkspace => w.id === id && w.type === 'webpage'));
  const [updatePage, deletePage] = useWorkspaceStore(useShallow(state => [state.update, state.remove]));
  const [editedName, setEditedName] = useState(page?.name ?? '');
  const [editedUri, setEditedUri] = useState(page?.uri ?? '');

  if (id === undefined || page === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  const handleSave = () => {
    updatePage(id, {
      name: editedName,
      uri: editedUri,
    });
    onClose();
  };

  return (
    <ModalContainer>
      <StyledTextInput label={t('EditWorkspace.Name')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('AddWorkspace.PageUrl')} value={editedUri} onChangeText={setEditedUri} />

      <ButtonsContainer>
        <Button onPress={onClose}>{t('Cancel')}</Button>
        <Button
          onPress={() => {
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('Cancel'),
                  onPress: () => {},
                  style: 'cancel',
                },
                {
                  text: t('Delete'),
                  onPress: () => {
                    // await deleteWikiFile(page);
                    deletePage(id);
                    onClose();
                  },
                },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
        <Button onPress={handleSave}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
      </ButtonsContainer>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: ${({ theme }) => theme.colors.background};
  padding: 20px;
`;

const StyledTextInput = styled(TextInput)`
  margin-bottom: 10px;
`;

const ButtonsContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 15px;
`;
