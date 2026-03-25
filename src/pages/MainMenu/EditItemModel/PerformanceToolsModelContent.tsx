import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Switch, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';

import { FlexibleText, SwitchContainer } from '../../../components/PreferenceWidgets';
import { IWikiWorkspace, useWorkspaceStore } from '../../../store/workspace';

interface ModalProps {
  id: string | undefined;
  onClose: () => void;
}

export function PerformanceToolsModelContent({ id, onClose }: ModalProps): JSX.Element {
  const { t } = useTranslation();

  // Use useShallow + useMemo to avoid re-renders from .find() recreation
  const workspaces = useWorkspaceStore(useShallow(state => state.workspaces));
  const wiki = useMemo(
    () => id === undefined ? undefined : workspaces.find((w): w is IWikiWorkspace => w.id === id && (w.type === undefined || w.type === 'wiki')),
    [id, workspaces],
  );
  const updateWorkspace = useWorkspaceStore(state => state.update);

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
      <SectionContainer>
        <Text variant='titleLarge'>{t('Preference.EnableQuickLoad')}</Text>
        <SwitchContainer>
          <FlexibleText>{t('Preference.EnableQuickLoadDescription')}</FlexibleText>
          <Switch
            value={wiki.enableQuickLoad}
            onValueChange={(value) => {
              updateWorkspace(id, { enableQuickLoad: value });
            }}
          />
        </SwitchContainer>
      </SectionContainer>
      <SectionContainer>
        <Text variant='titleLarge'>{t('Preference.AllowReadFileAttachment')}</Text>
        <SwitchContainer>
          <FlexibleText>{t('Preference.AllowReadFileAttachmentDescription')}</FlexibleText>
          <Switch
            value={wiki.allowReadFileAttachment}
            onValueChange={(value) => {
              updateWorkspace(id, { allowReadFileAttachment: value });
            }}
          />
        </SwitchContainer>
      </SectionContainer>
    </ModalContainer>
  );
}

const ModalContainer = styled.View`
  background-color: #fff;
  padding: 20px;
`;
const CloseButton = styled(Button)`
  margin-bottom: 10px;
`;
const SectionContainer = styled.View`
  flex-direction: column;
  justify-content: baseline;
  align-items: stretch;
  margin-top: 15px;
`;
