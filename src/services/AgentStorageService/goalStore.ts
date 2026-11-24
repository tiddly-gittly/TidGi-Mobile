import type { AgentGoal, GoalStore } from 'memeloop/mobile';

import type { AgentSqlDatabase } from './storagePort';

const pageSize = 100;

/** Goal state shares the conversation database and its transaction queue. */
export class MobileGoalStore implements GoalStore {
  constructor(
    private readonly database: () => Promise<AgentSqlDatabase>,
    private readonly serialize: <Result>(operation: () => Promise<Result>) => Promise<Result>,
  ) {}

  get(conversationId: string): Promise<AgentGoal | null> {
    return this.serialize(async () => {
      const row = await (await this.database()).getFirstAsync<{ goalJson: string }>(
        'SELECT goalJson FROM agent_goals WHERE conversationId = ?',
        [conversationId],
      );
      return row ? JSON.parse(row.goalJson) as AgentGoal : null;
    });
  }

  save(goal: AgentGoal, expectedRevision: number | null): Promise<boolean> {
    return this.serialize(async () => {
      const database = await this.database();
      const values = [goal.executionNodeId, goal.status, goal.revision, JSON.stringify(goal), goal.conversationId];
      const result = expectedRevision === null
        ? await database.runAsync(
          'INSERT OR IGNORE INTO agent_goals (executionNodeId, status, revision, goalJson, conversationId) VALUES (?, ?, ?, ?, ?)',
          values,
        )
        : await database.runAsync(
          'UPDATE agent_goals SET executionNodeId = ?, status = ?, revision = ?, goalJson = ? WHERE conversationId = ? AND revision = ?',
          [...values, expectedRevision],
        );
      return result.changes === 1;
    });
  }

  listActive(executionNodeId: string, cursor?: string): ReturnType<GoalStore['listActive']> {
    return this.serialize(async () => {
      const rows = await (await this.database()).getAllAsync<{ conversationId: string; goalJson: string }>(
        `SELECT conversationId, goalJson FROM agent_goals
         WHERE executionNodeId = ? AND status = 'active' AND conversationId > ?
         ORDER BY conversationId LIMIT ?`,
        [executionNodeId, cursor ?? '', pageSize + 1],
      );
      const page = rows.slice(0, pageSize);
      return {
        items: page.map(row => JSON.parse(row.goalJson) as AgentGoal),
        ...(rows.length > pageSize ? { nextCursor: page.at(-1)!.conversationId } : {}),
      };
    });
  }
}
