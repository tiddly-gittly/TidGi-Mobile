import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';
import { Appbar, Button, Card, Chip, Text } from 'react-native-paper';
import { styled, useTheme } from 'styled-components/native';
import * as MemeLoop from '../../services/MemeLoopService';
import { type TaskInfo, useAgentStore } from '../../store/agent';
import { useMemeLoopStore } from '../../store/memeloop';

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

const TASK_CARD_CONTENT_STYLE = { gap: 8 } as const;
const STATUS_CHIP_TEXT_STYLE = { fontSize: 11 } as const;
const EMPTY_DESCRIPTION_STYLE = {
  marginTop: 8,
  textAlign: 'center',
} as const;

type TaskStatusTranslationKey =
  | 'TaskMonitor.Running'
  | 'TaskMonitor.Waiting'
  | 'TaskMonitor.Completed'
  | 'TaskMonitor.Error'
  | 'TaskMonitor.Cancelled';

function statusLabelKey(status: TaskInfo['status']): TaskStatusTranslationKey {
  switch (status) {
    case 'running':
      return 'TaskMonitor.Running';
    case 'waiting':
      return 'TaskMonitor.Waiting';
    case 'completed':
      return 'TaskMonitor.Completed';
    case 'error':
      return 'TaskMonitor.Error';
    case 'cancelled':
      return 'TaskMonitor.Cancelled';
  }
}

function statusColor(status: TaskInfo['status']): string | undefined {
  switch (status) {
    case 'running':
      return undefined;
    case 'waiting':
      return '#ff9800';
    case 'completed':
      return '#4caf50';
    case 'error':
      return '#f44336';
    case 'cancelled':
      return '#9e9e9e';
    default:
      return undefined;
  }
}

export function TaskMonitor(): React.JSX.Element {
  const { t } = useTranslation();
  const theme = useTheme();
  const tasks = useAgentStore((s) => s.tasks);
  const selectedRemoteNodeId = useMemeLoopStore((s) => s.selectedRemoteNodeId);
  const taskNodeId = tasks[0]?.nodeId;
  const subscriptionNodeId = selectedRemoteNodeId ?? taskNodeId;

  useEffect(() => {
    if (!subscriptionNodeId) {
      return undefined;
    }

    const unsubscribe = MemeLoop.getMemeLoopService().subscribe(
      subscriptionNodeId,
      'memeloop.task.update',
      (parameters: unknown) => {
        const update = parameters as {
          conversationId: string;
          status: TaskInfo['status'];
          progress?: string;
        };
        useAgentStore.getState().updateTask(update.conversationId, {
          status: update.status,
          progress: update.progress,
        });
      },
    );

    return unsubscribe;
  }, [subscriptionNodeId]);

  const handleCancel = async (conversationId: string) => {
    const task = tasks.find((entry) => entry.conversationId === conversationId);
    if (task) {
      await MemeLoop.getMemeLoopService()
        .rpcCall<{ ok: boolean }>(task.nodeId, 'memeloop.agent.cancel', {
          conversationId,
        })
        .catch(() => {});
    }
    useAgentStore
      .getState()
      .updateTask(conversationId, { status: 'cancelled' });
  };

  const renderItem = ({ item }: { item: TaskInfo }) => (
    <TaskCard mode='outlined'>
      <Card.Title
        title={item.definitionId}
        subtitle={`${t('TaskMonitor.Node')}: ${item.nodeId.slice(0, 12)} · ${new Date(item.startedAt).toLocaleTimeString()}`}
      />
      <Card.Content style={TASK_CARD_CONTENT_STYLE}>
        <StatusChip
          $status={item.status}
          compact
          textStyle={{
            ...STATUS_CHIP_TEXT_STYLE,
            color: statusColor(item.status),
          }}
          icon={item.status === 'running'
            ? 'loading'
            : item.status === 'waiting'
            ? 'clock-outline'
            : item.status === 'completed'
            ? 'check'
            : 'alert'}
        >
          {t(statusLabelKey(item.status))}
        </StatusChip>
        {item.progress && <Text variant='bodySmall'>{item.progress}</Text>}
      </Card.Content>
      {(item.status === 'running' || item.status === 'waiting') && (
        <Card.Actions>
          <Button
            onPress={() => void handleCancel(item.conversationId)}
            textColor={theme.colors.error}
          >
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
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              {t('TaskMonitor.NoTasks')}
            </Text>
            <Text
              style={{
                ...EMPTY_DESCRIPTION_STYLE,
                color: theme.colors.onSurfaceVariant,
              }}
            >
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
