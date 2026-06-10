import i18n from 'i18next';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Menu, Text, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';

const TemplateItem = styled(Card)`
  margin: 8px;
`;

export interface ITemplateListItem {
  contribute: string;
  description: string;
  fallbackUrls?: string | undefined;
  gitUrl?: string | undefined;
  /** When true, this template is bundled with the app and doesn't need network to import. */
  isLocalDefault?: boolean | undefined;
  language: string;
  tags: string;
  testIdKey?: string | undefined;
  title: string;
  url: string;
}

interface ITemplateListItemProps {
  item: ITemplateListItem;
  onPreviewPress: (url: string) => void;
  onUsePress: (item: ITemplateListItem, url: string) => void;
}

function toTemplateTestIdSegment(item: ITemplateListItem): string {
  if (typeof item.testIdKey === 'string' && item.testIdKey.length > 0) {
    return item.testIdKey;
  }

  const source = item.gitUrl ?? item.url;
  let candidate = item.title;

  try {
    const parsed = new URL(source);
    candidate = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? item.title);
  } catch {
    candidate = item.title;
  }

  const normalized = candidate
    .toLowerCase()
    .replace(/\.git$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'template';
}

export function filterTemplate(list: ITemplateListItem[]): ITemplateListItem[] {
  const currentLanguage = i18n.language;
  const normalizedCurrentLanguage = currentLanguage.toLowerCase().replace(/_/g, '-');
  const currentLanguageRoot = normalizedCurrentLanguage.split('-')[0];
  /**
   * When language is `zh`, match `zh` and `zh-CN` and `zh-Hans`
   */
  return list.filter((item) => {
    const normalizedItemLanguage = item.language.toLowerCase().replace(/_/g, '-');
    return normalizedItemLanguage === normalizedCurrentLanguage ||
      normalizedItemLanguage.startsWith(normalizedCurrentLanguage) ||
      normalizedCurrentLanguage.startsWith(normalizedItemLanguage) ||
      normalizedItemLanguage.startsWith(currentLanguageRoot);
  });
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

  const fallbackUrls = item.fallbackUrls ? item.fallbackUrls.split(' ').filter(Boolean) : [];
  const [selectedUrl, setSelectedUrl] = useState(item.url);
  const templateTestIdSegment = toTemplateTestIdSegment(item);

  const handleSelectUrl = useCallback((url: string) => {
    setSelectedUrl(url);
    closeMenu();
  }, []);

  return (
    <TemplateItem>
      <Card.Title title={item.title} />
      <Card.Content>
        <Text>{item.description}</Text>
      </Card.Content>
      <Card.Actions>
        <Button
          testID={`template-preview-${templateTestIdSegment}`}
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
          testID={`template-use-${templateTestIdSegment}`}
          icon='plus'
          mode='text'
          onPress={() => {
            onUsePress(item, selectedUrl);
          }}
        >
          {t('AddWorkspace.Use')}
        </Button>
      </Card.Actions>
    </TemplateItem>
  );
}

export const LoadingContainer = styled.View`
padding-top: 20px;
display: flex;
flex-direction: column;
justify-content: center;
align-items: center;
height: 100px;
`;
