import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Appbar, Button, Card, Chip, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { type TaskInfo, useAgentStore } from '../../store/agent';

const Container = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const EmptyContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  padding: 32px;
`;

const TaskCard = styled(Card)`
  margin: 8px 16px;
`;

const StatusChip = styled(Chip)<{ $status: TaskInfo['status'] }>`
  align-self: flex-start;
`;

function statusColor(status: TaskInfo['status']): string | undefined {
  switch (status) {
    case 'running': return undefined;
    case 'waiting': return '#ff9800';
    case 'completed': return '#4caf50';
    case 'error': return '#f44336';
    case 'cancelled': return '#9e9e9e';
    default: return undefined;
  }
}

export function TaskMonitor(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const tasks = useAgentStore((s) => s.tasks);

  useEffect(() => {
    const unsubscribe = MemeLoop.subscribe('memeloop.task.update', (params: unknown) => {
      const update = params as { conversationId: string; status: TaskInfo['status']; progress?: string };
      useAgentStore.getState().updateTask(update.conversationId, { status: update.status, progress: update.progress });
    });
    return unsubscribe;
  }, []);

  const handleCancel = async (conversationId: string) => {
    await MemeLoop.cancelAgent(conversationId).catch(() => {});
    useAgentStore.getState().updateTask(conversationId, { status: 'cancelled' });
  };

  const renderItem = ({ item }: { item: TaskInfo }) => (
    <TaskCard mode="outlined">
      <Card.Title
        title={item.definitionId}
        subtitle={`${t('TaskMonitor.Node')}: ${item.nodeId.slice(0, 12)} · ${new Date(item.startedAt).toLocaleTimeString()}`}
      />
      <Card.Content style={{ gap: 8 }}>
        <StatusChip
          $status={item.status}
          compact
          textStyle={{ fontSize: 11, color: statusColor(item.status) }}
          icon={item.status === 'running' ? 'loading' : item.status === 'waiting' ? 'clock-outline' : item.status === 'completed' ? 'check' : 'alert'}
        >
          {t(`TaskMonitor.${item.status.charAt(0).toUpperCase() + item.status.slice(1)}` as any)}
        </StatusChip>
        {item.progress && <Text variant="bodySmall">{item.progress}</Text>}
      </Card.Content>
      {(item.status === 'running' || item.status === 'waiting') && (
        <Card.Actions>
          <Button onPress={() => void handleCancel(item.conversationId)} textColor={theme.colors.error}>
            {t('TaskMonitor.CancelTask')}
          </Button>
        </Card.Actions>
      )}
    </TaskCard>
  );

  return (
    <Container>
      <Appbar.Header>
        <Appbar.Content title={t('TaskMonitor.Title')} />
      </Appbar.Header>

      {tasks.length === 0
        ? (
          <EmptyContainer>
            <Text style={{ color: theme.colors.onSurfaceVariant ?? '#888' }}>{t('TaskMonitor.NoTasks')}</Text>
            <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant ?? '#888', textAlign: 'center' }}>
              {t('TaskMonitor.NoTasksDescription')}
            </Text>
          </EmptyContainer>
        )
        : (
          <FlatList
            data={tasks}
            keyExtractor={(item) => item.conversationId}
            renderItem={renderItem}
          />
        )}
    </Container>
  );
}
