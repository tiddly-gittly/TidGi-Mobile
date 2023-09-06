/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable unicorn/no-null */
import { Picker } from '@react-native-picker/picker';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Button, Switch, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { FlexibleText, SwitchContainer } from '../../../components/PreferenceWidgets';
import { ServerProvider, ServerStatus, useServerStore } from '../../../store/server';

interface ServerEditModalProps {
  id?: string;
  onClose: () => void;
}

export function ServerEditModalContent({ id, onClose }: ServerEditModalProps): JSX.Element {
  const { t } = useTranslation();
  const server = useServerStore(state => id === undefined ? undefined : state.servers[id]);
  const updateServer = useServerStore(state => state.update);
  const deleteServer = useServerStore(state => state.remove);

  // States for each field in the server type
  const [editedName, setEditedName] = useState(server?.name ?? '');
  const [editedUri, setEditedUri] = useState(server?.uri ?? '');
  const [editedProvider, setEditedProvider] = useState<ServerProvider>(server?.provider ?? ServerProvider.TidGiDesktop);
  const [editedStatus, setEditedStatus] = useState<ServerStatus>(server?.status ?? ServerStatus.online);
  const [editedSyncActive, setEditedSyncActive] = useState(server?.syncActive ?? false);

  // This is for location field. You might want to implement a proper method to pick a location.
  const [editedLocation, setEditedLocation] = useState(((server?.location) != null) || {});

  if (id === undefined || server === undefined) {
    return (
      <ModalContainer>
        <Text>{t('EditWorkspace.ServerNotFound')}</Text>
      </ModalContainer>
    );
  }

  const handleSave = () => {
    updateServer({
      id: server.id,
      name: editedName,
      uri: editedUri,
      provider: editedProvider,
      status: editedStatus,
      syncActive: editedSyncActive,
      location: editedLocation,
    });
    onClose();
  };

  return (
    <ModalContainer>
      <StyledTextInput label={t('EditWorkspace.ServerName')} value={editedName} onChangeText={setEditedName} />
      <StyledTextInput label={t('EditWorkspace.ServerURI')} value={editedUri} onChangeText={setEditedUri} />

      {/* You might need a dropdown or picker for provider and status */}
      <Picker selectedValue={editedProvider} onValueChange={setEditedProvider}>
        <Picker.Item label={t('EditWorkspace.TidGiDesktop')} value={ServerProvider.TidGiDesktop} />
        <Picker.Item label={t('EditWorkspace.TiddlyHost')} value={ServerProvider.TiddlyHost} enabled={false} />
      </Picker>

      <Picker selectedValue={editedStatus} onValueChange={setEditedStatus}>
        <Picker.Item label={t('EditWorkspace.ServerDisconnected')} value={ServerStatus.disconnected} />
        <Picker.Item label={t('EditWorkspace.ServerOnline')} value={ServerStatus.online} />
      </Picker>

      <SwitchContainer>
        <FlexibleText>{t('EditWorkspace.SyncActive')}</FlexibleText>
        <Switch
          value={editedSyncActive}
          onValueChange={setEditedSyncActive}
        />
      </SwitchContainer>

      {/* Implement a location picker or a method to input/edit location if required */}

      <ButtonsContainer>
        <Button onPress={handleSave}>
          <Text>{t('EditWorkspace.Save')}</Text>
        </Button>
        <Button
          onPress={() => {
            // Prompt the user with an alert for confirmation.
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('EditWorkspace.Cancel'),
                  onPress: () => {},
                  style: 'cancel',
                },
                {
                  text: t('Delete'),
                  onPress: () => {
                    // Proceed with deletion if confirm is pressed.}
                    deleteServer(server.id);
                    onClose();
                  },
                },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
        <Button onPress={onClose}>{t('EditWorkspace.Cancel')}</Button>
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
