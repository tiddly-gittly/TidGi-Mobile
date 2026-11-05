import { AGENT_DEVICE_RPC_METHODS, type AgentDefinition, createAgentDeviceRpcClient } from 'memeloop/mobile';
import React from 'react';

import { RemoteAgentPicker, type RemoteAgentPickerProps } from '../RemoteAgentPicker';

jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof React>('react');
  return {
    StyleSheet: { create: <T,>(styles: T) => styles },
    FlatList: ({ data, renderItem, ListEmptyComponent }: {
      data: AgentDefinition[];
      renderItem: (value: { item: AgentDefinition }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) =>
      ReactModule.createElement(
        'List',
        {},
        data.length > 0 ? data.map(item => ReactModule.createElement(ReactModule.Fragment, { key: item.id }, renderItem({ item }))) : ListEmptyComponent,
      ),
  };
});
jest.mock('react-native-paper', () => {
  const ReactModule = jest.requireActual<typeof React>('react');
  const component = (name: string) => (properties: { children?: React.ReactNode }) => ReactModule.createElement(name, properties, properties.children);
  return {
    ActivityIndicator: component('Spinner'),
    Button: component('Button'),
    Dialog: Object.assign(component('Dialog'), {
      Title: component('DialogTitle'),
      ScrollArea: component('DialogScroll'),
      Actions: component('DialogActions'),
    }),
    List: { Item: component('AgentRow'), Icon: component('Icon') },
    Portal: component('Portal'),
    Text: component('Text'),
  };
});

interface TestNode {
  props: { onPress(): void; title?: string; disabled?: boolean; children?: React.ReactNode };
}
interface TestRenderer {
  root: { findAllByType(type: string): TestNode[] };
  update(element: React.ReactElement): void;
  unmount(): void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));

const definition: AgentDefinition = {
  id: 'custom-mjs',
  name: 'Planning workflow',
  description: 'Saved script on desktop',
  systemPrompt: '',
  tools: [],
  version: '1',
  loopId: 'agent-agent-loop',
  scriptReference: { kind: 'source', name: 'plan.mjs', source: 'export default async function run(ctx) { ctx.finish("done"); }' },
};
const labels = { title: 'Choose an agent', loading: 'Loading', empty: 'No agents', error: 'Try again', retry: 'Retry', close: 'Close' };
let view: TestRenderer | undefined;

async function flush(action: () => void) {
  await act(async () => {
    action();
    for (let index = 0; index < 25; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await flush(() => view?.unmount());
  view = undefined;
});

it('selects a real remote definition, retries the same created conversation, synchronizes and opens it', async () => {
  const requests: Array<{ method: string; parameters: unknown }> = [];
  const client = createAgentDeviceRpcClient({
    peerId: 'mac-peer',
    createRequestId: () => 'rpc-id',
    sendRpc: (_peer, method, parameters) => {
      requests.push({ method, parameters });
      if (method === AGENT_DEVICE_RPC_METHODS.getDefinitions) return Promise.resolve({ definitions: [definition] });
      if (method === AGENT_DEVICE_RPC_METHODS.create) return Promise.resolve({ conversationId: 'new-custom-conversation' });
      throw new Error(`unexpected ${method}`);
    },
  });
  const createConversationId = jest.fn(() => 'new-custom-conversation');
  const syncConversation = jest.fn<Promise<void>, [string, AbortSignal]>()
    .mockRejectedValueOnce(new Error('temporary network failure')).mockResolvedValue(undefined);
  const onCreated = jest.fn(() => Promise.resolve());
  const onClose = jest.fn();
  const properties = { client, createConversationId, syncConversation, onCreated, onClose, labels };
  await flush(() => {
    view = create(<RemoteAgentPicker {...properties} />);
  });
  expect(view?.root.findAllByType('AgentRow')[0].props.title).toBe(definition.name);
  await flush(() => {
    view?.root.findAllByType('AgentRow')[0].props.onPress();
  });
  expect(onCreated).not.toHaveBeenCalled();
  expect(view?.root.findAllByType('Text').some(node => node.props.children === labels.error)).toBe(true);
  await flush(() => {
    view?.root.findAllByType('AgentRow')[0].props.onPress();
  });
  expect(createConversationId).toHaveBeenCalledTimes(1);
  expect(requests.filter(request => request.method === AGENT_DEVICE_RPC_METHODS.create)).toEqual([
    { method: AGENT_DEVICE_RPC_METHODS.create, parameters: { definitionId: definition.id, conversationId: 'new-custom-conversation' } },
    { method: AGENT_DEVICE_RPC_METHODS.create, parameters: { definitionId: definition.id, conversationId: 'new-custom-conversation' } },
  ]);
  expect(syncConversation).toHaveBeenLastCalledWith('new-custom-conversation', expect.any(AbortSignal));
  expect(onCreated).toHaveBeenCalledWith('new-custom-conversation');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('isolates a late definition response from the previously selected host', async () => {
  let release!: (response: { definitions: AgentDefinition[] }) => void;
  const previousClient = {
    getDefinitions: () =>
      new Promise<{ definitions: AgentDefinition[] }>(resolve => {
        release = resolve;
      }),
    createAgent: jest.fn(),
  };
  const currentClient = {
    getDefinitions: () => Promise.resolve({ definitions: [{ ...definition, id: 'current', name: 'Current host agent' }] }),
    createAgent: jest.fn(),
  };
  const properties: RemoteAgentPickerProps = {
    client: previousClient,
    createConversationId: () => 'id',
    syncConversation: () => Promise.resolve(),
    onCreated: () => Promise.resolve(),
    onClose: jest.fn(),
    labels,
  };
  await flush(() => {
    view = create(<RemoteAgentPicker {...properties} />);
  });
  await flush(() => {
    view?.update(<RemoteAgentPicker {...properties} client={currentClient} />);
  });
  await flush(() => {
    release({ definitions: [definition] });
  });
  expect(view?.root.findAllByType('AgentRow').map(node => node.props.title)).toEqual(['Current host agent']);
});
