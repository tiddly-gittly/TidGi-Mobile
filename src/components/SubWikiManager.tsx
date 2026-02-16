/**
 * Sub-wiki Management UI
 * Allows users to create and manage sub-wikis with routing rules
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';
import { Button, Card, Chip, Dialog, IconButton, List, Portal, Switch, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { readTidgiConfig, writeTidgiConfig } from '../services/WikiStorageService/tidgiConfigManager';
import { IWikiWorkspace, useWorkspaceStore } from '../store/workspace';

const Container = styled(ScrollView)`
  flex: 1;
  padding: 16px;
`;

const SubWikiCard = styled(Card)`
  margin-bottom: 12px;
`;

const CardContent = styled(Card.Content)`
  padding: 12px;
`;

const SubWikiHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const SubWikiTitle = styled(Text)`
  font-size: 16px;
  font-weight: bold;
`;

const TagsContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
`;

const TitleText = styled(Text)`
  margin-bottom: 16px;
`;

const ActionsRow = styled.View`
  flex-direction: row;
`;

const SmallMarginText = styled(Text)`
  margin-top: 4px;
`;

const DialogInput = styled(TextInput)`
  margin-bottom: 12px;
`;

const RoutingRulesLabel = styled(Text)`
  margin-bottom: 8px;
`;

const TagInputField = styled(TextInput)`
  margin-bottom: 8px;
`;

const TagsDialogContainer = styled(TagsContainer)`
  margin-bottom: 12px;
`;

const CustomFiltersInput = styled(TextInput)`
  margin-top: 12px;
`;

interface ISubWikiConfig {
  customFilters?: string;
  id: string;
  includeTagTree: boolean;
  name: string;
  path: string;
  tagNames: string[];
}

export interface ISubWikiManagerProps {
  onLongPressWorkspace?: (workspace: IWikiWorkspace) => void;
  workspace: IWikiWorkspace;
}

export const SubWikiManager: FC<ISubWikiManagerProps> = ({ workspace, onLongPressWorkspace }) => {
  const { t } = useTranslation();
  const allWorkspaces = useWorkspaceStore(state => state.workspaces);
  const [subWikis, setSubWikis] = useState<ISubWikiConfig[]>([]);
  const [mainTagNames, setMainTagNames] = useState<string[]>([]);
  const [mainTagInput, setMainTagInput] = useState('');
  const [mainIncludeTagTree, setMainIncludeTagTree] = useState(false);
  const [mainPathFilterEnable, setMainPathFilterEnable] = useState(false);
  const [mainPathFilter, setMainPathFilter] = useState<string>('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingSubWiki, setEditingSubWiki] = useState<ISubWikiConfig | null>(null);

  // Load main workspace routing config from tidgi.config.json on mount
  useEffect(() => {
    void (async () => {
      try {
        const config = await readTidgiConfig(workspace);
        setMainTagNames(Array.isArray(config.tagNames) ? config.tagNames : []);
        setMainIncludeTagTree(config.includeTagTree === true);
        setMainPathFilterEnable(config.fileSystemPathFilterEnable === true);
        setMainPathFilter(typeof config.fileSystemPathFilter === 'string' ? config.fileSystemPathFilter : '');
      } catch (error) {
        console.error('Failed to load sub-wiki config:', error);
      }
    })();
  }, [workspace]);

  // Load routing config from each attached sub workspace's own tidgi.config.json
  useEffect(() => {
    void (async () => {
      try {
        const subWikiConfigs = await Promise.all(attachedSubWikiWorkspaces.map(async (attachedSubWikiWorkspace) => {
          const config = await readTidgiConfig(attachedSubWikiWorkspace);
          return {
            id: attachedSubWikiWorkspace.id,
            name: attachedSubWikiWorkspace.name,
            path: attachedSubWikiWorkspace.wikiFolderLocation,
            tagNames: Array.isArray(config.tagNames) ? config.tagNames : [],
            includeTagTree: config.includeTagTree === true,
            customFilters: typeof config.fileSystemPathFilter === 'string' ? config.fileSystemPathFilter : '',
          } satisfies ISubWikiConfig;
        }));
        setSubWikis(subWikiConfigs);
      } catch (error) {
        console.error('Failed to load attached sub workspace routing config:', error);
      }
    })();
  }, [attachedSubWikiWorkspaces]);

  // Form state
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newTagNames, setNewTagNames] = useState<string[]>([]);
  const [newIncludeTagTree, setNewIncludeTagTree] = useState(false);
  const [newCustomFilters, setNewCustomFilters] = useState('');
  const [tagInput, setTagInput] = useState('');

  const attachedSubWikiWorkspaces = allWorkspaces.filter((item): item is IWikiWorkspace => item.type === 'wiki' && item.isSubWiki === true && item.mainWikiID === workspace.id);

  const resetForm = useCallback(() => {
    setNewName('');
    setNewPath('');
    setNewTagNames([]);
    setNewIncludeTagTree(false);
    setNewCustomFilters('');
    setTagInput('');
    setEditingSubWiki(null);
  }, []);

  const handleAddTag = useCallback(() => {
    if (tagInput.trim() && !newTagNames.includes(tagInput.trim())) {
      setNewTagNames([...newTagNames, tagInput.trim()]);
      setTagInput('');
    }
  }, [tagInput, newTagNames]);

  const handleRemoveTag = useCallback((tag: string) => {
    setNewTagNames(newTagNames.filter(t => t !== tag));
  }, [newTagNames]);

  const persistSubWikis = useCallback(async (updatedSubWikis: ISubWikiConfig[]) => {
    try {
      await Promise.all(updatedSubWikis.map(async (subWiki) => {
        const targetWorkspace = attachedSubWikiWorkspaces.find(attachedSubWikiWorkspace => attachedSubWikiWorkspace.id === subWiki.id);
        if (!targetWorkspace) return;
        await writeTidgiConfig(targetWorkspace, {
          tagNames: subWiki.tagNames,
          includeTagTree: subWiki.includeTagTree,
          fileSystemPathFilterEnable: Boolean(subWiki.customFilters && subWiki.customFilters.trim().length > 0),
          fileSystemPathFilter: subWiki.customFilters && subWiki.customFilters.trim().length > 0 ? subWiki.customFilters : null,
        });
      }));
    } catch (error) {
      console.error('Failed to persist sub-wiki config:', error);
    }
  }, [attachedSubWikiWorkspaces]);

  const persistRoutingConfig = useCallback(async () => {
    try {
      await writeTidgiConfig(workspace, {
        tagNames: mainTagNames,
        includeTagTree: mainIncludeTagTree,
        fileSystemPathFilterEnable: mainPathFilterEnable,
        fileSystemPathFilter: mainPathFilter.trim() === '' ? null : mainPathFilter,
      });
    } catch (error) {
      console.error('Failed to persist main routing config:', error);
    }
  }, [mainIncludeTagTree, mainPathFilter, mainPathFilterEnable, mainTagNames, workspace]);

  const addMainTag = useCallback(() => {
    const trimmedTag = mainTagInput.trim();
    if (!trimmedTag || mainTagNames.includes(trimmedTag)) return;
    setMainTagNames(previous => [...previous, trimmedTag]);
    setMainTagInput('');
  }, [mainTagInput, mainTagNames]);

  const removeMainTag = useCallback((tag: string) => {
    setMainTagNames(previous => previous.filter(item => item !== tag));
  }, []);

  const handleSaveSubWiki = useCallback(() => {
    if (editingSubWiki === null) {
      Alert.alert(t('WarningMessage'), t('SubWiki.EditSubWiki'));
      return;
    }

    const subWiki: ISubWikiConfig = {
      id: editingSubWiki.id,
      name: newName.trim(),
      path: newPath.trim(),
      tagNames: newTagNames,
      includeTagTree: newIncludeTagTree,
      customFilters: newCustomFilters.trim() || undefined,
    };

    const updatedSubWikis = subWikis.map(sw => sw.id === editingSubWiki.id ? subWiki : sw);
    setSubWikis(updatedSubWikis);
    void persistSubWikis(updatedSubWikis);

    setShowAddDialog(false);
    resetForm();
  }, [newName, newPath, newTagNames, newIncludeTagTree, newCustomFilters, editingSubWiki, subWikis, resetForm, t, persistSubWikis]);

  const handleEditSubWiki = useCallback((subWiki: ISubWikiConfig) => {
    setEditingSubWiki(subWiki);
    setNewName(subWiki.name);
    setNewPath(subWiki.path);
    setNewTagNames(subWiki.tagNames);
    setNewIncludeTagTree(subWiki.includeTagTree);
    setNewCustomFilters(subWiki.customFilters || '');
    setShowAddDialog(true);
  }, []);

  const handleDeleteSubWiki = useCallback((id: string) => {
    const updatedSubWikis = subWikis.filter(sw => sw.id !== id);
    setSubWikis(updatedSubWikis);
    void persistSubWikis(updatedSubWikis);
  }, [subWikis, persistSubWikis]);

  return (
    <Container>
      <SubWikiCard>
        <CardContent>
          <SubWikiTitle>{t('WorkspaceSettings.SubWikiRouting')}</SubWikiTitle>
          <Text variant='bodySmall'>{t('WorkspaceSettings.RoutingDescription')}</Text>

          <TagInputField
            label={t('WorkspaceSettings.AddNewTag')}
            value={mainTagInput}
            onChangeText={setMainTagInput}
            mode='outlined'
            right={<TextInput.Icon icon='plus' onPress={addMainTag} />}
            onSubmitEditing={addMainTag}
          />

          {mainTagNames.length > 0 && (
            <TagsDialogContainer>
              {mainTagNames.map(tag => (
                <Chip
                  key={tag}
                  onClose={() => {
                    removeMainTag(tag);
                  }}
                  mode='outlined'
                >
                  {tag}
                </Chip>
              ))}
            </TagsDialogContainer>
          )}

          <List.Item
            title={t('WorkspaceSettings.IncludeTagTree')}
            description={t('WorkspaceSettings.IncludeTagTreeDescription')}
            right={() => (
              <Switch
                value={mainIncludeTagTree}
                onValueChange={setMainIncludeTagTree}
              />
            )}
          />

          <List.Item
            title={t('WorkspaceSettings.EnablePathFilter')}
            description={t('WorkspaceSettings.EnablePathFilterDescription')}
            right={() => (
              <Switch
                value={mainPathFilterEnable}
                onValueChange={setMainPathFilterEnable}
              />
            )}
          />

          <CustomFiltersInput
            label={t('WorkspaceSettings.FileSystemPathFilter')}
            value={mainPathFilter}
            onChangeText={setMainPathFilter}
            mode='outlined'
            multiline
            numberOfLines={4}
          />

          <Button
            mode='outlined'
            onPress={() => {
              void persistRoutingConfig();
            }}
          >
            {t('Common.Save')}
          </Button>
        </CardContent>
      </SubWikiCard>

      <TitleText variant='titleLarge'>
        {t('SubWiki.AttachedSubKnowledgeBases')} ({attachedSubWikiWorkspaces.length})
      </TitleText>
      {attachedSubWikiWorkspaces.map((attachedSubWikiWorkspace) => (
        <SubWikiCard
          key={attachedSubWikiWorkspace.id}
          onLongPress={() => {
            onLongPressWorkspace?.(attachedSubWikiWorkspace);
          }}
        >
          <CardContent>
            <SubWikiHeader>
              <SubWikiTitle>{attachedSubWikiWorkspace.name}</SubWikiTitle>
            </SubWikiHeader>
            <Text variant='bodySmall'>{attachedSubWikiWorkspace.id}</Text>
            <Text variant='bodySmall'>{attachedSubWikiWorkspace.wikiFolderLocation}</Text>
          </CardContent>
        </SubWikiCard>
      ))}

      <TitleText variant='titleLarge'>
        {t('SubWiki.SubWikis')} ({subWikis.length})
      </TitleText>

      {subWikis.map(subWiki => (
        <SubWikiCard key={subWiki.id}>
          <CardContent>
            <SubWikiHeader>
              <SubWikiTitle>{subWiki.name}</SubWikiTitle>
              <ActionsRow>
                <IconButton
                  icon='pencil'
                  size={20}
                  onPress={() => {
                    handleEditSubWiki(subWiki);
                  }}
                />
                <IconButton
                  icon='delete'
                  size={20}
                  onPress={() => {
                    handleDeleteSubWiki(subWiki.id);
                  }}
                />
              </ActionsRow>
            </SubWikiHeader>

            <Text variant='bodySmall'>
              {t('SubWiki.Path')}: {subWiki.path}
            </Text>

            {subWiki.tagNames.length > 0 && (
              <>
                <SmallMarginText variant='bodySmall'>
                  {t('SubWiki.Tags')}:
                </SmallMarginText>
                <TagsContainer>
                  {subWiki.tagNames.map(tag => (
                    <Chip key={tag} mode='outlined' compact>
                      {tag}
                    </Chip>
                  ))}
                </TagsContainer>
              </>
            )}

            {subWiki.includeTagTree && (
              <SmallMarginText variant='bodySmall'>
                ✓ {t('SubWiki.IncludeTagTree')}
              </SmallMarginText>
            )}

            {subWiki.customFilters && (
              <SmallMarginText variant='bodySmall'>
                {t('SubWiki.CustomFilters')}: {subWiki.customFilters.substring(0, 50)}...
              </SmallMarginText>
            )}
          </CardContent>
        </SubWikiCard>
      ))}

      {/* Add/Edit Dialog */}
      <Portal>
        <Dialog
          visible={showAddDialog}
          onDismiss={() => {
            setShowAddDialog(false);
            resetForm();
          }}
        >
          <Dialog.Title>
            {editingSubWiki ? t('SubWiki.EditSubWiki') : t('SubWiki.AddSubWiki')}
          </Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView>
              <DialogInput
                label={t('SubWiki.Name')}
                value={newName}
                onChangeText={setNewName}
                mode='outlined'
              />

              <DialogInput
                label={t('SubWiki.Path')}
                value={newPath}
                onChangeText={setNewPath}
                mode='outlined'
                placeholder='subfolder/'
              />

              <RoutingRulesLabel variant='labelLarge'>
                {t('SubWiki.RoutingRules')}
              </RoutingRulesLabel>

              <TagInputField
                label={t('SubWiki.AddTag')}
                value={tagInput}
                onChangeText={setTagInput}
                mode='outlined'
                right={
                  <TextInput.Icon
                    icon='plus'
                    onPress={handleAddTag}
                  />
                }
                onSubmitEditing={handleAddTag}
              />

              {newTagNames.length > 0 && (
                <TagsDialogContainer>
                  {newTagNames.map(tag => (
                    <Chip
                      key={tag}
                      onClose={() => {
                        handleRemoveTag(tag);
                      }}
                      mode='outlined'
                    >
                      {tag}
                    </Chip>
                  ))}
                </TagsDialogContainer>
              )}

              <List.Item
                title={t('SubWiki.IncludeTagTree')}
                description={t('SubWiki.IncludeTagTreeDescription')}
                right={() => (
                  <IconButton
                    icon={newIncludeTagTree ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    onPress={() => {
                      setNewIncludeTagTree(!newIncludeTagTree);
                    }}
                  />
                )}
              />

              <CustomFiltersInput
                label={t('SubWiki.CustomFilters')}
                value={newCustomFilters}
                onChangeText={setNewCustomFilters}
                mode='outlined'
                multiline
                numberOfLines={4}
                placeholder='[tag[MyTag]]\n[prefix[$:/]]'
              />
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setShowAddDialog(false);
                resetForm();
              }}
            >
              {t('Common.Cancel')}
            </Button>
            <Button onPress={handleSaveSubWiki}>
              {t('Common.Save')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Container>
  );
};
