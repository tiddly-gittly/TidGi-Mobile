import { StackScreenProps } from '@react-navigation/stack';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import Collapsible from 'react-native-collapsible';
import { Button, Chip, List, Switch, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useShallow } from 'zustand/react/shallow';
import type { RootStackParameterList } from '../../App';
import { ServerList } from '../../components/ServerList';
import { SubWikiManager } from '../../components/SubWikiManager';
import { gitBackgroundSyncService } from '../../services/BackgroundSyncService';
import { gitGetUnsyncedCommitCount } from '../../services/GitService';
import { readTidgiConfig, writeTidgiConfig } from '../../services/WikiStorageService/tidgiConfigManager';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';
import { deleteWikiFile } from '../Config/Developer/useClearAllWikiData';
import { ServerEditModalContent } from '../Config/ServerAndSync/ServerEditModal';
import { AddNewServerModelContent } from '../MainMenu/AddNewServerModelContent';
import { PerformanceToolsModelContent } from '../MainMenu/EditItemModel/PerformanceToolsModelContent';
import { WikiChangesModelContent } from '../MainMenu/EditItemModel/WikiChangesModelContent';
import { WorkspaceSyncModalContent } from '../MainMenu/EditItemModel/WorkspaceSyncModalContent';
import { WorkspaceSettings } from '../WikiSettings/WorkspaceSettings';

const getUnsyncedCommitCount = gitGetUnsyncedCommitCount as (workspace: IWikiWorkspace) => Promise<number>;

function useWikiWorkspace(id: string): IWikiWorkspace | undefined {
  return useWorkspaceStore(state => state.workspaces.find((workspace): workspace is IWikiWorkspace => workspace.type === 'wiki' && workspace.id === id));
}

function useWorkspaceTitle(
  props: StackScreenProps<RootStackParameterList, keyof RootStackParameterList>,
  wiki: IWikiWorkspace | undefined,
  fallback: string,
) {
  useLayoutEffect(() => {
    props.navigation.setOptions({
      headerTitle: wiki ? `${wiki.name} · ${fallback}` : fallback,
    });
  }, [fallback, props.navigation, wiki?.id, wiki?.name]);
}

export function WorkspaceDetailPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceDetail'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  const [updateWorkspace, removeWorkspace, setServerActive] = useWorkspaceStore(useShallow(state => [state.update, state.remove, state.setServerActive]));
  const [editedName, setEditedName] = useState(wiki?.name ?? '');
  const [pendingCommitCount, setPendingCommitCount] = useState(0);
  const [expandServerList, setExpandServerList] = useState(false);

  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.Title'));

  useEffect(() => {
    if (!wiki) return;
    setEditedName(wiki.name);
    void getUnsyncedCommitCount(wiki).then(setPendingCommitCount);
  }, [wiki?.id, wiki?.name]);

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <StyledTextInput
        label={t('EditWorkspace.Name')}
        value={editedName}
        onChangeText={(value) => {
          setEditedName(value);
          updateWorkspace(wiki.id, { name: value });
        }}
      />

      <Text variant='bodySmall'>{t('Sync.UnsyncedCommitCount', { count: pendingCommitCount })}</Text>

      <Button
        mode='text'
        icon='sync'
        onPress={() => {
          navigation.navigate('WorkspaceSync', { id: wiki.id });
        }}
      >
        {t('Sync.WorkspaceSync')}
      </Button>
      <Button
        mode='text'
        icon='history'
        onPress={() => {
          navigation.navigate('WorkspaceChanges', { id: wiki.id });
        }}
      >
        {t('AddWorkspace.OpenChangeLogList')}
      </Button>
      <Button
        mode='text'
        icon='cog'
        onPress={() => {
          navigation.navigate('WorkspaceSettingsPage', { id: wiki.id });
        }}
      >
        {t('WorkspaceSettings.Title')}
      </Button>
      <Button
        mode='text'
        icon='folder-cog'
        onPress={() => {
          navigation.navigate('WorkspaceRoutingConfig', { id: wiki.id });
        }}
      >
        {t('WorkspaceSettings.SubWikiRouting')}
      </Button>
      {wiki.isSubWiki !== true && (
        <Button
          mode='text'
          icon='file-tree'
          onPress={() => {
            navigation.navigate('WorkspaceSubWikiManager', { id: wiki.id });
          }}
        >
          {t('SubWiki.ManageSubKnowledgeBases')}
        </Button>
      )}
      <Button
        mode='text'
        onPress={() => {
          navigation.navigate('WorkspacePerformance', { id: wiki.id });
        }}
      >
        {t('AddWorkspace.OpenPerformanceTools')}
      </Button>

      <Button
        mode='text'
        onPress={() => {
          void gitBackgroundSyncService.updateServerOnlineStatus();
          setExpandServerList(previous => !previous);
        }}
      >
        {t('AddWorkspace.ToggleServerList')}
      </Button>
      <Collapsible collapsed={!expandServerList}>
        <ServerList
          serverIDs={wiki.syncedServers.map(server => server.serverID)}
          activeIDs={wiki.syncedServers.filter(serverInfoInWiki => serverInfoInWiki.syncActive).map(server => server.serverID)}
          onPress={(server) => {
            const serverInWiki = wiki.syncedServers.find(serverInfoInWiki => serverInfoInWiki.serverID === server.id);
            if (serverInWiki) {
              setServerActive(wiki.id, server.id, !serverInWiki.syncActive);
            }
          }}
          onLongPress={(server) => {
            void Haptics.selectionAsync();
            navigation.navigate('WorkspaceServerEdit', { id: wiki.id, serverId: server.id });
          }}
        />
        <Button
          onPress={() => {
            navigation.navigate('WorkspaceAddServer', { id: wiki.id });
          }}
        >
          {t('EditWorkspace.AddNewServer')}
        </Button>
      </Collapsible>

      <FooterRow>
        <Button
          onPress={() => {
            Alert.alert(
              t('ConfirmDelete'),
              t('ConfirmDeleteDescription'),
              [
                {
                  text: t('Delete'),
                  onPress: () => {
                    deleteWikiFile(wiki);
                    removeWorkspace(wiki.id);
                    navigation.goBack();
                  },
                },
                { text: t('Cancel'), style: 'cancel' },
              ],
            );
          }}
        >
          {t('Delete')}
        </Button>
      </FooterRow>
    </PageContainer>
  );
}

export function WorkspaceSyncPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSync'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('Sync.WorkspaceSync'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <WorkspaceSyncModalContent
        workspace={wiki}
        showCloseButton={false}
        onOpenChanges={() => {
          navigation.navigate('WorkspaceChanges', { id: wiki.id });
        }}
        onClose={() => {
          navigation.goBack();
        }}
      />
    </PageContainer>
  );
}

export function WorkspaceChangesPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceChanges'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('GitHistory.Commits'));

  return (
    <WikiChangesModelContent
      id={route.params.id}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}

export function WorkspaceSettingsPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSettingsPage'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.Title'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <WorkspaceSettings workspace={wiki} />
    </PageContainer>
  );
}

export function WorkspacePerformancePage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspacePerformance'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('Preference.Performance'));

  return (
    <PerformanceToolsModelContent
      id={route.params.id}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}

export function WorkspaceSubWikiManagerPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceSubWikiManager'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('SubWiki.ManageSubKnowledgeBases'));

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <SubWikiPageContainer>
      <SubWikiManager
        workspace={wiki}
        onPressWorkspace={(subWorkspace) => {
          navigation.navigate('WorkspaceDetail', { id: subWorkspace.id });
        }}
        onPressSettings={(subWorkspace) => {
          navigation.navigate('WorkspaceDetail', { id: subWorkspace.id });
        }}
      />
    </SubWikiPageContainer>
  );
}

/**
 * Routing config page — "文件存放位置"
 * Edits the tag-based routing rules for a workspace (main or sub-wiki).
 */
export function WorkspaceRoutingConfigPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceRoutingConfig'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('WorkspaceSettings.SubWikiRouting'));

  const [tagNames, setTagNames] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [includeTagTree, setIncludeTagTree] = useState(false);
  const [pathFilterEnable, setPathFilterEnable] = useState(false);
  const [pathFilter, setPathFilter] = useState('');

  useEffect(() => {
    if (!wiki) return;
    void (async () => {
      try {
        const config = await readTidgiConfig(wiki);
        setTagNames(Array.isArray(config.tagNames) ? config.tagNames : []);
        setIncludeTagTree(config.includeTagTree === true);
        setPathFilterEnable(config.fileSystemPathFilterEnable === true);
        setPathFilter(typeof config.fileSystemPathFilter === 'string' ? config.fileSystemPathFilter : '');
      } catch (error) {
        console.error('Failed to load routing config:', error);
      }
    })();
  }, [wiki?.id]);

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (!trimmed || tagNames.includes(trimmed)) return;
    setTagNames(previous => [...previous, trimmed]);
    setTagInput('');
  }, [tagInput, tagNames]);

  const removeTag = useCallback((tag: string) => {
    setTagNames(previous => previous.filter(item => item !== tag));
  }, []);

  const handleSave = useCallback(async () => {
    if (!wiki) return;
    try {
      await writeTidgiConfig(wiki, {
        tagNames,
        includeTagTree,
        fileSystemPathFilterEnable: pathFilterEnable,
        fileSystemPathFilter: pathFilter.trim() === '' ? null : pathFilter,
      });
      navigation.goBack();
    } catch (error) {
      console.error('Failed to save routing config:', error);
    }
  }, [wiki, tagNames, includeTagTree, pathFilterEnable, pathFilter, navigation]);

  if (!wiki) {
    return (
      <PageContainer>
        <Text>{t('EditWorkspace.NotFound')}</Text>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <RoutingDescription variant='bodySmall'>
        {t('WorkspaceSettings.RoutingDescription')}
      </RoutingDescription>

      <TagInputField
        label={t('WorkspaceSettings.AddNewTag')}
        value={tagInput}
        onChangeText={setTagInput}
        mode='outlined'
        right={<TextInput.Icon icon='plus' onPress={addTag} />}
        onSubmitEditing={addTag}
      />

      {tagNames.length > 0 && (
        <TagsRow>
          {tagNames.map(tag => (
            <Chip
              key={tag}
              onClose={() => {
                removeTag(tag);
              }}
              mode='outlined'
            >
              {tag}
            </Chip>
          ))}
        </TagsRow>
      )}

      <List.Item
        title={t('WorkspaceSettings.IncludeTagTree')}
        description={t('WorkspaceSettings.IncludeTagTreeDescription')}
        right={() => <Switch value={includeTagTree} onValueChange={setIncludeTagTree} />}
      />

      <List.Item
        title={t('WorkspaceSettings.EnablePathFilter')}
        description={t('WorkspaceSettings.EnablePathFilterDescription')}
        right={() => <Switch value={pathFilterEnable} onValueChange={setPathFilterEnable} />}
      />

      {pathFilterEnable && (
        <PathFilterInput
          label={t('WorkspaceSettings.FileSystemPathFilter')}
          value={pathFilter}
          onChangeText={setPathFilter}
          mode='outlined'
          multiline
          numberOfLines={4}
        />
      )}

      <SaveButton
        mode='contained'
        onPress={() => {
          void handleSave();
        }}
      >
        {t('Common.Save')}
      </SaveButton>
    </PageContainer>
  );
}

export function WorkspaceServerEditPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceServerEdit'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('EditWorkspace.ServerName'));

  return (
    <ServerEditModalContent
      id={route.params.serverId}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}

export function WorkspaceAddServerPage({ route, navigation }: StackScreenProps<RootStackParameterList, 'WorkspaceAddServer'>): JSX.Element {
  const { t } = useTranslation();
  const wiki = useWikiWorkspace(route.params.id);
  useWorkspaceTitle({ route, navigation } as StackScreenProps<RootStackParameterList, keyof RootStackParameterList>, wiki, t('EditWorkspace.AddNewServer'));

  return (
    <AddNewServerModelContent
      id={route.params.id}
      onClose={() => {
        navigation.goBack();
      }}
    />
  );
}

const PageContainer = styled.ScrollView`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
  padding: 16px;
`;

const SubWikiPageContainer = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const StyledTextInput = styled(TextInput)`
  margin-bottom: 10px;
`;

const FooterRow = styled.View`
  flex-direction: row;
  justify-content: flex-end;
  margin-top: 16px;
`;

const RoutingDescription = styled(Text)`
  margin-bottom: 12px;
  margin-top: 4px;
`;

const TagInputField = styled(TextInput)`
  margin-bottom: 8px;
`;

const TagsRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
`;

const PathFilterInput = styled(TextInput)`
  margin-top: 12px;
`;

const SaveButton = styled(Button)`
  margin-top: 16px;
`;
