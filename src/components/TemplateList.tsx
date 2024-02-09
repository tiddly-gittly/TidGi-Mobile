import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Menu, useTheme } from 'react-native-paper';
import styled from 'styled-components/native';

const TemplateItem = styled(Card)`
  margin: 8px;
`;

export interface ITemplateListItem {
  contribute: string;
  description: string;
  fallbackUrls?: string;
  language: string;
  tags: string;
  title: string;
  url: string;
}

interface ITemplateListItemProps {
  item: ITemplateListItem;
  onPreviewPress: (url: string) => void;
  onUsePress: (url: string) => void;
}

export function TemplateListItem({ item, onPreviewPress, onUsePress }: ITemplateListItemProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const openMenu = () => {
    setVisible(true);
  };
  const closeMenu = () => {
    setVisible(false);
  };

  const fallbackUrls = item.fallbackUrls?.split?.(' ')?.filter?.(Boolean) ?? [];
  const [selectedUrl, setSelectedUrl] = useState(item.url);

  const handleSelectUrl = useCallback((url: string) => {
    setSelectedUrl(url);
    closeMenu();
  }, []);

  return (
    <TemplateItem>
      <Card.Title title={item.title} subtitle={item.description} />
      <Card.Actions>
        <Button
          icon='eye-outline'
          mode='text'
          onPress={() => {
            onPreviewPress(selectedUrl);
          }}
        >
          {t('AddWorkspace.Preview')}
        </Button>
        <Menu
          visible={visible}
          onDismiss={closeMenu}
          anchor={<Button icon='dots-vertical' onPress={openMenu}>{t('AddWorkspace.SelectSource')}</Button>}
        >
          {[item.url, ...fallbackUrls].map((url, index) => (
            <Menu.Item
              key={index}
              style={url === selectedUrl ? { backgroundColor: theme.colors.primaryContainer } : undefined}
              title={new URL(url).hostname}
              onPress={() => {
                handleSelectUrl(url);
              }}
            />
          ))}
        </Menu>
        <Button
          icon='plus'
          mode='text'
          onPress={() => {
            onUsePress(selectedUrl);
          }}
        >
          {t('AddWorkspace.Use')}
        </Button>
      </Card.Actions>
    </TemplateItem>
  );
}
