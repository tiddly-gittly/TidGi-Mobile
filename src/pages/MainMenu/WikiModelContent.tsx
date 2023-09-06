/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useWikiStore } from '../../store/wiki';

interface WikiEditModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function WikiEditModalContent({ id, onClose }: WikiEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiStore(state => id === undefined ? undefined : state.wikis.find(w => w.id === id));
  const updateWiki = useWikiStore(state => state.update);
  const deleteWiki = useWikiStore(state => state.remove);

  const [editedName, setEditedName] = useState(wiki?.name ?? '');
  const [editedSelectiveSyncFilter, setEditedSelectiveSyncFilter] = useState(wiki?.selectiveSyncFilter ?? '');
  const [editedWikiFolderLocation, setEditedWikiFolderLocation] = useState(wiki?.wikiFolderLocation ?? '');

  if (id === undefined || wiki === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </ModalContainer>
    );
  }

  const handleSave = () => {
    updateWiki(id, {
      name: editedName,
      selectiveSyncFilter: editedSelectiveSyncFilter,
    });
    onClose();
  };

  return (
    <ModalContainer>
      <StyledTextInput label={t('EditWorkspace.Name')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('AddWorkspace.SelectiveSyncFilter')} value={editedSelectiveSyncFilter} onChangeText={setEditedSelectiveSyncFilter} />
      <StyledTextInput label={t('AddWorkspace.WorkspaceFolder')} value={editedWikiFolderLocation} onChangeText={setEditedWikiFolderLocation} />

      {/* You might want to expand with more fields based on your requirements */}

      <ButtonsContainer>
        <Button onPress={handleSave}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
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
                    deleteWiki(id);
                    onClose();
                  },
                },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
        <Button onPress={onClose}>{t('Cancel')}</Button>
      </ButtonsContainer>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: white;
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
