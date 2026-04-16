import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, View } from 'react-native';
import { IconButton } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';

const Container = styled.View`
  flex-direction: row;
  align-items: flex-end;
  padding: 8px;
  border-top-width: 1px;
  border-top-color: ${({ theme }) => theme.colors.outlineVariant};
  background-color: ${({ theme }) => theme.colors.surface};
`;

const InputWrapper = styled.View`
  flex: 1;
  flex-direction: row;
  align-items: flex-end;
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
  border-radius: 20px;
  padding-left: 4px;
`;

const StyledInput = styled.TextInput.attrs(({ theme }) => ({
  placeholderTextColor: theme.colors.onSurfaceVariant,
}))`
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  padding: 8px 12px;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.onSurface};
`;

const AttachmentPreview = styled.View`
  flex-direction: row;
  padding: 8px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant};
  border-radius: 8px;
  margin: 4px 8px;
  align-items: center;
`;

const AttachmentText = styled.Text`
  flex: 1;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.onSurface};
  margin-left: 8px;
`;

const ZERO_MARGIN_ICON_STYLE = { margin: 0 } as const;
const ATTACHMENT_MENU_STYLE = {
  flexDirection: 'row',
  padding: 8,
  borderTopWidth: 1,
} as const;

export interface Attachment {
  uri: string;
  name: string;
  type: 'image' | 'file';
  mimeType?: string;
  size?: number;
}

interface InputContainerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: (message: string, attachments?: Attachment[]) => void;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  isStreaming?: boolean;
  allowAttachments?: boolean;
}

export function InputContainer({
  value,
  onChangeText,
  onSend,
  onStop,
  placeholder,
  disabled = false,
  isStreaming = false,
  allowAttachments = true,
}: InputContainerProps): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;

    onSend(text, attachments.length > 0 ? attachments : undefined);
    onChangeText('');
    setAttachments([]);
    Keyboard.dismiss();
  }, [value, attachments, onSend, onChangeText]);

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  const handlePickImage = useCallback(() => {
    console.warn('Image picking is not enabled in this build yet.');
    setShowAttachmentMenu(false);
  }, []);

  const handlePickFile = useCallback(() => {
    console.warn('Document picking is not enabled in this build yet.');
    setShowAttachmentMenu(false);
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((previous) => previous.filter((_, index_) => index_ !== index));
  }, []);

  return (
    <>
      {attachments.length > 0 && (
        <View>
          {attachments.map((attachment, index) => (
            <AttachmentPreview key={index}>
              <IconButton
                icon={attachment.type === 'image' ? 'image' : 'file-document'}
                size={16}
                style={ZERO_MARGIN_ICON_STYLE}
              />
              <AttachmentText numberOfLines={1}>
                {attachment.name}
              </AttachmentText>
              <IconButton
                icon='close'
                size={16}
                onPress={() => {
                  handleRemoveAttachment(index);
                }}
                style={ZERO_MARGIN_ICON_STYLE}
              />
            </AttachmentPreview>
          ))}
        </View>
      )}

      <Container>
        {allowAttachments && !isStreaming && (
          <IconButton
            icon='attachment'
            size={20}
            onPress={() => {
              setShowAttachmentMenu(!showAttachmentMenu);
            }}
            disabled={disabled}
          />
        )}

        <InputWrapper>
          <StyledInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder ?? t('Agent.TypeMessage')}
            multiline
            returnKeyType='default'
            submitBehavior='newline'
            editable={!disabled && !isStreaming}
          />
        </InputWrapper>

        {isStreaming
          ? (
            <IconButton
              icon='stop-circle'
              iconColor={theme.colors.error}
              size={24}
              onPress={handleStop}
            />
          )
          : (
            <IconButton
              icon='send'
              iconColor={theme.colors.primary}
              size={24}
              onPress={handleSend}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
            />
          )}
      </Container>

      {showAttachmentMenu && (
        <View
          style={{
            ...ATTACHMENT_MENU_STYLE,
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.outlineVariant,
          }}
        >
          <IconButton
            icon='image'
            onPress={handlePickImage}
            mode='contained-tonal'
          />
          <IconButton
            icon='file-document'
            onPress={handlePickFile}
            mode='contained-tonal'
          />
        </View>
      )}
    </>
  );
}
