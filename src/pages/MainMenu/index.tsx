import React from 'react';
import { useTranslation } from 'react-i18next';
import { styled } from 'styled-components/native';
import { useWikiFolders } from '../../hooks/useWikiFolders';

const SidebarContainer = styled.View`
  flex: 1;
  background-color: #f5f5f5;
  width: 300px;
`;

const WikiItem = styled.TouchableOpacity`
  padding: 10px;
  border-bottom: 1px solid #e0e0e0;
`;
const WikiItemText = styled.Text`
  padding: 10px;
`;

const ConfigButton = styled.TouchableOpacity`
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 10px;
`;

export const MainMenu = () => {
  const { t } = useTranslation();
  const wikis = []; // useWikiFolders();

  return (
    <SidebarContainer>
      {wikis.map(wiki => (
        <WikiItem key={wiki} onPress={() => {/* Implement your wiki selection logic here */}}>
          <WikiItemText>{wiki}</WikiItemText>
        </WikiItem>
      ))}

      <ConfigButton onPress={() => {/* Implement the navigation to the config page here */}}>
        <WikiItemText>{t('SideBar.Preferences')}</WikiItemText>
      </ConfigButton>
    </SidebarContainer>
  );
};
