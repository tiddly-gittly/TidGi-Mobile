import React, { useCallback, useState } from 'react';
import { Clipboard, Dimensions, Image, LayoutChangeEvent, ScrollView, View } from 'react-native';
import { Button, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { gitAddToGitignore, gitDiscardFileChanges, IGitFileContent } from '../../../services/GitService';
import { IWikiWorkspace } from '../../../store/workspace';

interface IGitFilePreviewModalProps {
  afterContent: IGitFileContent;
  beforeContent: IGitFileContent;
  filePath: string;
  mode: 'diff' | 'full';
  onModeChange: (mode: 'diff' | 'full') => void;
  /** Pass the workspace when the file is from uncommitted changes (enables discard/ignore actions) */
  uncommittedWorkspace?: IWikiWorkspace;
  onDiscardSuccess?: () => void;
}

function renderTextDiff(beforeText: string, afterText: string): string {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const rows: string[] = [];
  const sharedLength = Math.min(beforeLines.length, afterLines.length);
  for (let index = 0; index < sharedLength; index++) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      rows.push(`  ${beforeLine}`);
    } else {
      rows.push(`- ${beforeLine}`);
      rows.push(`+ ${afterLine}`);
    }
  }
  for (let index = sharedLength; index < beforeLines.length; index++) {
    rows.push(`- ${beforeLines[index]}`);
  }
  for (let index = sharedLength; index < afterLines.length; index++) {
    rows.push(`+ ${afterLines[index]}`);
  }
  return rows.join('\n');
}

export function GitFilePreviewModal({
  afterContent,
  beforeContent,
  filePath,
  mode,
  onModeChange,
  uncommittedWorkspace,
  onDiscardSuccess,
}: IGitFilePreviewModalProps): React.JSX.Element {
  const theme = useTheme();
  const beforeText = beforeContent.kind === 'text' ? (beforeContent.text ?? '') : '';
  const afterText = afterContent.kind === 'text' ? (afterContent.text ?? '') : '';
  const [headerHeight, setHeaderHeight] = useState(0);
  const [panelMode, setPanelMode] = useState<'diff' | 'full' | 'actions'>('diff');
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isIgnoring, setIsIgnoring] = useState(false);

  const canAct = uncommittedWorkspace !== undefined;
  const extensionMatch = filePath.match(/\.([^.\\/]+)$/);
  const fileExtension = extensionMatch?.[1] ?? null;

  const handleDiscard = () => {
    if (!uncommittedWorkspace) return;
    setIsDiscarding(true);
    void gitDiscardFileChanges(uncommittedWorkspace, filePath)
      .then(() => {
        onDiscardSuccess?.();
      })
      .catch(console.error)
      .finally(() => {
        setIsDiscarding(false);
      });
  };

  const handleIgnoreFile = () => {
    if (!uncommittedWorkspace) return;
    setIsIgnoring(true);
    void gitAddToGitignore(uncommittedWorkspace, filePath)
      .then(() => {
        onDiscardSuccess?.();
      })
      .catch(console.error)
      .finally(() => {
        setIsIgnoring(false);
      });
  };

  const handleIgnoreExtension = () => {
    if (!uncommittedWorkspace || !fileExtension) return;
    setIsIgnoring(true);
    void gitAddToGitignore(uncommittedWorkspace, `*.${fileExtension}`)
      .then(() => {
        onDiscardSuccess?.();
      })
      .catch(console.error)
      .finally(() => {
        setIsIgnoring(false);
      });
  };

  const handleCopyPath = () => {
    Clipboard.setString(filePath);
  };

  // Card has max-height: 80% of screen. Card.Title ~ 56px, Card.Content padding ~ 16px.
  // We measure the header (filePath text + segmented buttons) to compute remaining space.
  const windowHeight = Dimensions.get('window').height;
  const cardMaxHeight = windowHeight * 0.8;
  // Remaining height for scroll view after subtracting card chrome and header
  const scrollViewHeight = Math.max(100, cardMaxHeight - 56 - 32 - headerHeight - 16);

  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    setHeaderHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <View>
      <View onLayout={onHeaderLayout}>
        <Text variant='titleMedium' style={{ marginTop: 8 }}>{filePath}</Text>
        <SegmentedButtons
          style={{ marginTop: 8 }}
          value={panelMode}
          onValueChange={(value) => {
            if (value === 'diff' || value === 'full') onModeChange(value);
            setPanelMode(value as 'diff' | 'full' | 'actions');
          }}
          buttons={[
            { value: 'diff', label: 'Diff' },
            { value: 'full', label: 'Full' },
            { value: 'actions', label: '操作', disabled: !canAct },
          ]}
        />
      </View>

      {panelMode === 'actions'
        ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            <Button
              mode='outlined'
              icon='undo-variant'
              textColor={theme.colors.error}
              loading={isDiscarding}
              disabled={isDiscarding || isIgnoring}
              onPress={handleDiscard}
            >
              撤销此文件变更
            </Button>
            <Button
              mode='outlined'
              icon='eye-off-outline'
              loading={isIgnoring}
              disabled={isDiscarding || isIgnoring}
              onPress={handleIgnoreFile}
            >
              忽略此文件 (.gitignore)
            </Button>
            {fileExtension && (
              <Button
                mode='outlined'
                icon='eye-off-outline'
                loading={isIgnoring}
                disabled={isDiscarding || isIgnoring}
                onPress={handleIgnoreExtension}
              >
                忽略所有 .{fileExtension} 文件
              </Button>
            )}
            <Button mode='outlined' icon='content-copy' onPress={handleCopyPath}>
              复制文件路径
            </Button>
          </View>
        )
        : (
          <ScrollView style={{ height: scrollViewHeight, marginTop: 8 }} nestedScrollEnabled>
            {panelMode === 'diff' && beforeContent.kind === 'text' && afterContent.kind === 'text' && <CodeText>{renderTextDiff(beforeText, afterText)}</CodeText>}

            {panelMode === 'full' && afterContent.kind === 'text' && <CodeText>{afterText}</CodeText>}

            {panelMode === 'full' && afterContent.kind === 'image' && afterContent.dataUri && <PreviewImage source={{ uri: afterContent.dataUri }} />}

            {panelMode === 'diff' && (beforeContent.kind === 'image' || afterContent.kind === 'image') && (
              <>
                <Text variant='labelLarge'>Before</Text>
                {beforeContent.kind === 'image' && beforeContent.dataUri ? <PreviewImage source={{ uri: beforeContent.dataUri }} /> : <Text>(missing)</Text>}
                <Text variant='labelLarge'>After</Text>
                {afterContent.kind === 'image' && afterContent.dataUri ? <PreviewImage source={{ uri: afterContent.dataUri }} /> : <Text>(missing)</Text>}
              </>
            )}

            {afterContent.kind === 'binary' && <Text>Binary content preview is not supported.</Text>}
            {afterContent.kind === 'missing' && beforeContent.kind === 'missing' && <Text>File content is not available.</Text>}
          </ScrollView>
        )}
    </View>
  );
}

const CodeText = styled(Text)`
  font-family: monospace;
`;

const PreviewImage = styled(Image)`
  width: 100%;
  min-height: 180px;
  resize-mode: contain;
`;
