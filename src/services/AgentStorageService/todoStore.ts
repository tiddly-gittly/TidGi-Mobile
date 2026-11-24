import { type TodoItem } from 'memeloop';
import { type AgentSqlDatabase } from './storagePort';
import { parseJson, strictJson } from './storageShared';

interface MobileTodoStoreContext {
  enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result>;
  database(): Promise<AgentSqlDatabase>;
}

export class MobileTodoStore {
  constructor(private readonly context: MobileTodoStoreContext) {}

  public async transact<Result>(
    conversationId: string,
    operation: (todos: Map<string, TodoItem>) => Result | Promise<Result>,
  ): Promise<Result> {
    if (conversationId.trim() === '') throw new Error('mobile_todo_conversation_id_required');
    return this.context.enqueueMutation(async () => {
      const database = await this.context.database();
      let result!: Result;
      await database.withTransactionAsync(async () => {
        const rows = await database.getAllAsync<{ itemId: string; itemJson: string }>(
          'SELECT itemId, itemJson FROM agent_todos WHERE conversationId = ? ORDER BY itemId',
          [conversationId],
        );
        const todos = new Map(rows.map(row => [row.itemId, parseJson(row.itemJson) as TodoItem]));
        result = await operation(todos);
        for (const [itemId, item] of todos) this.assertMobileTodoItem(itemId, item);
        await database.runAsync('DELETE FROM agent_todos WHERE conversationId = ?', [conversationId]);
        for (const [itemId, item] of todos) {
          await database.runAsync(
            'INSERT INTO agent_todos (conversationId, itemId, itemJson) VALUES (?, ?, ?)',
            [conversationId, itemId, strictJson(item)],
          );
        }
      });
      return result;
    });
  }

  public assertMobileTodoItem(itemId: string, item: TodoItem): void {
    if (
      itemId.trim() === '' || item.id !== itemId ||
      item.content.trim() === '' || !['pending', 'in_progress', 'completed', 'cancelled'].includes(item.status) ||
      !['high', 'medium', 'low'].includes(item.priority) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
      !Number.isSafeInteger(item.updatedAt) || item.updatedAt < item.createdAt
    ) throw new Error('mobile_todo_item_invalid');
  }
}
