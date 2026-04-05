import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text } from 'react-native-paper';
import { styled } from 'styled-components/native';

const Container = styled(Card)`
  margin: 8px;
`;

const Content = styled(Card.Content)`
  gap: 8px;
`;

const ParamsBox = styled.View`
  padding: 8px;
  border-radius: 8px;
  background-color: ${({ theme }) => theme.colors.surfaceVariant ?? '#f0f0f0'};
`;

const ParamsText = styled(Text)`
  font-family: monospace;
  font-size: 12px;
`;

const Actions = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px 16px;
`;

interface ToolApprovalPromptProps {
  toolName: string;
  parameters: string;
  onDecision: (decision: string) => void;
}

export function ToolApprovalPrompt({ toolName, parameters, onDecision }: ToolApprovalPromptProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Container mode="outlined">
      <Content>
        <Text variant="labelLarge">🔐 {t('Agent.ToolApproval')}</Text>
        <Text>{t('Agent.ToolApprovalDesc', { toolName })}</Text>
        {parameters && (
          <ParamsBox>
            <ParamsText numberOfLines={6}>{parameters}</ParamsText>
          </ParamsBox>
        )}
      </Content>
      <Actions>
        <Button mode="contained" onPress={() => onDecision('allow-once')}>{t('Agent.AllowOnce')}</Button>
        <Button mode="outlined" onPress={() => onDecision('allow-session')}>{t('Agent.AllowSession')}</Button>
        <Button mode="outlined" onPress={() => onDecision('allow-always')}>{t('Agent.AllowAlways')}</Button>
        <Button mode="outlined" textColor="red" onPress={() => onDecision('deny')}>{t('Agent.Deny')}</Button>
      </Actions>
    </Container>
  );
}
