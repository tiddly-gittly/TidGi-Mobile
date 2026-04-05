import React from 'react';
import { Image, ScrollView } from 'react-native';
import { SegmentedButtons, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';
import { IGitFileContent } from '../../../services/GitService';

interface IGitFilePreviewModalProps {
  afterContent: IGitFileContent;
  beforeContent: IGitFileContent;
  filePath: string;
  mode: 'diff' | 'full';
  onModeChange: (mode: 'diff' | 'full') => void;
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
}: IGitFilePreviewModalProps): React.JSX.Element {
  const beforeText = beforeContent.kind === 'text' ? (beforeContent.text ?? '') : '';
  const afterText = afterContent.kind === 'text' ? (afterContent.text ?? '') : '';

  return (
    <Container>
      <Text variant='titleMedium'>{filePath}</Text>
      <SegmentedButtons
        value={mode}
        onValueChange={(value) => {
          onModeChange(value as 'diff' | 'full');
        }}
        buttons={[
          { value: 'diff', label: 'Diff' },
          { value: 'full', label: 'Full' },
        ]}
      />

      <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
        {mode === 'diff' && beforeContent.kind === 'text' && afterContent.kind === 'text' && <CodeText>{renderTextDiff(beforeText, afterText)}</CodeText>}

        {mode === 'full' && afterContent.kind === 'text' && <CodeText>{afterText}</CodeText>}

        {mode === 'full' && afterContent.kind === 'image' && afterContent.dataUri && <PreviewImage source={{ uri: afterContent.dataUri }} />}

        {mode === 'diff' && (beforeContent.kind === 'image' || afterContent.kind === 'image') && (
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
    </Container>
  );
}

const Container = styled.View`
  margin-top: 8px;
  gap: 8px;
  flex: 1;
`;

const CodeText = styled(Text)`
  font-family: monospace;
`;

const PreviewImage = styled(Image)`
  width: 100%;
  min-height: 180px;
  resize-mode: contain;
`;
