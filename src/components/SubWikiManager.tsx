/**
 * Sub-wiki Management UI
 * Allows users to create and manage sub-wikis with routing rules
 */

import React, { FC, useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Dialog, IconButton, List, Portal, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { useTranslation } from 'react-i18next';
import { IWikiWorkspace, useWorkspaceStore } from '../../store/workspace';

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

const ButtonRow = styled.View`
  flex-direction: row;
  gap: 8px;
  margin-top: 16px;
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
  workspace: IWikiWorkspace;
}

export const SubWikiManager: FC<ISubWikiManagerProps> = ({ workspace }) => {
  const { t } = useTranslation();
  const [subWikis, setSubWikis] = useState<ISubWikiConfig[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingSubWiki, setEditingSubWiki] = useState<ISubWikiConfig | null>(null);
  
  // Form state
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newTagNames, setNewTagNames] = useState<string[]>([]);
  const [newIncludeTagTree, setNewIncludeTagTree] = useState(false);
  const [newCustomFilters, setNewCustomFilters] = useState('');
  const [tagInput, setTagInput] = useState('');

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

  const handleSaveSubWiki = useCallback(() => {
    if (!newName.trim() || !newPath.trim()) {
      alert(t('SubWiki.NameAndPathRequired'));
      return;
    }

    const subWiki: ISubWikiConfig = {
      id: editingSubWiki?.id || `subwiki-${Date.now()}`,
      name: newName.trim(),
      path: newPath.trim(),
      tagNames: newTagNames,
      includeTagTree: newIncludeTagTree,
      customFilters: newCustomFilters.trim() || undefined,
    };

    if (editingSubWiki) {
      // Update existing
      setSubWikis(subWikis.map(sw => sw.id === editingSubWiki.id ? subWiki : sw));
    } else {
      // Add new
      setSubWikis([...subWikis, subWiki]);
    }

    setShowAddDialog(false);
    resetForm();
  }, [newName, newPath, newTagNames, newIncludeTagTree, newCustomFilters, editingSubWiki, subWikis, resetForm, t]);

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
    setSubWikis(subWikis.filter(sw => sw.id !== id));
  }, [subWikis]);

  return (
    <Container>
      <Text variant="titleLarge" style={{ marginBottom: 16 }}>
        {t('SubWiki.SubWikis')} ({subWikis.length})
      </Text>

      {subWikis.map(subWiki => (
        <SubWikiCard key={subWiki.id}>
          <CardContent>
            <SubWikiHeader>
              <SubWikiTitle>{subWiki.name}</SubWikiTitle>
              <View style={{ flexDirection: 'row' }}>
                <IconButton
                  icon="pencil"
                  size={20}
                  onPress={() => handleEditSubWiki(subWiki)}
                />
                <IconButton
                  icon="delete"
                  size={20}
                  onPress={() => handleDeleteSubWiki(subWiki.id)}
                />
              </View>
            </SubWikiHeader>

            <Text variant="bodySmall">
              {t('SubWiki.Path')}: {subWiki.path}
            </Text>

            {subWiki.tagNames.length > 0 && (
              <>
                <Text variant="bodySmall" style={{ marginTop: 4 }}>
                  {t('SubWiki.Tags')}:
                </Text>
                <TagsContainer>
                  {subWiki.tagNames.map(tag => (
                    <Chip key={tag} mode="outlined" compact>
                      {tag}
                    </Chip>
                  ))}
                </TagsContainer>
              </>
            )}

            {subWiki.includeTagTree && (
              <Text variant="bodySmall" style={{ marginTop: 4 }}>
                ✓ {t('SubWiki.IncludeTagTree')}
              </Text>
            )}

            {subWiki.customFilters && (
              <Text variant="bodySmall" style={{ marginTop: 4 }}>
                {t('SubWiki.CustomFilters')}: {subWiki.customFilters.substring(0, 50)}...
              </Text>
            )}
          </CardContent>
        </SubWikiCard>
      ))}

      <Button
        mode="contained"
        icon="plus"
        onPress={() => setShowAddDialog(true)}
        style={{ marginTop: 8 }}
      >
        {t('SubWiki.AddSubWiki')}
      </Button>

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
              <TextInput
                label={t('SubWiki.Name')}
                value={newName}
                onChangeText={setNewName}
                mode="outlined"
                style={{ marginBottom: 12 }}
              />

              <TextInput
                label={t('SubWiki.Path')}
                value={newPath}
                onChangeText={setNewPath}
                mode="outlined"
                placeholder="subfolder/"
                style={{ marginBottom: 12 }}
              />

              <Text variant="labelLarge" style={{ marginBottom: 8 }}>
                {t('SubWiki.RoutingRules')}
              </Text>

              <TextInput
                label={t('SubWiki.AddTag')}
                value={tagInput}
                onChangeText={setTagInput}
                mode="outlined"
                right={
                  <TextInput.Icon
                    icon="plus"
                    onPress={handleAddTag}
                  />
                }
                onSubmitEditing={handleAddTag}
                style={{ marginBottom: 8 }}
              />

              {newTagNames.length > 0 && (
                <TagsContainer style={{ marginBottom: 12 }}>
                  {newTagNames.map(tag => (
                    <Chip
                      key={tag}
                      onClose={() => handleRemoveTag(tag)}
                      mode="outlined"
                    >
                      {tag}
                    </Chip>
                  ))}
                </TagsContainer>
              )}

              <List.Item
                title={t('SubWiki.IncludeTagTree')}
                description={t('SubWiki.IncludeTagTreeDescription')}
                right={() => (
                  <IconButton
                    icon={newIncludeTagTree ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    onPress={() => setNewIncludeTagTree(!newIncludeTagTree)}
                  />
                )}
              />

              <TextInput
                label={t('SubWiki.CustomFilters')}
                value={newCustomFilters}
                onChangeText={setNewCustomFilters}
                mode="outlined"
                multiline
                numberOfLines={4}
                placeholder="[tag[MyTag]]\n[prefix[$:/]]"
                style={{ marginTop: 12 }}
              />
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => {
              setShowAddDialog(false);
              resetForm();
            }}>
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
