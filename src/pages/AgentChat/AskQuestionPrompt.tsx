import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { styled } from 'styled-components/native';

const Container = styled(Card)`
  margin: 8px;
`;

const Content = styled(Card.Content)`
  gap: 8px;
`;

const Actions = styled(Card.Actions)`
  justify-content: flex-end;
`;

interface AskQuestionPromptProps {
  question: string;
  onAnswer: (answer: string) => void;
}

export function AskQuestionPrompt({ question, onAnswer }: AskQuestionPromptProps): React.JSX.Element {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState('');

  return (
    <Container mode="outlined">
      <Content>
        <Text variant="labelLarge">💬 {t('Agent.AskQuestion')}</Text>
        <Text>{question}</Text>
        <TextInput mode="outlined" dense value={answer} onChangeText={setAnswer} placeholder={t('Agent.Answer')} />
      </Content>
      <Actions>
        <Button onPress={() => { onAnswer(answer); setAnswer(''); }} disabled={!answer.trim()}>{t('Agent.Send')}</Button>
      </Actions>
    </Container>
  );
}
