jest.mock('expo-file-system', () => ({
  Paths: {
    cache: { uri: 'file:///cache/' },
    document: { uri: 'file:///documents/' },
  },
}));
jest.mock('../../utils/expoFileSystemStorage', () => ({
  expoFileSystemStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

import { ServerStatus, useServerStore } from '../server';

describe('server reachability defaults', () => {
  beforeEach(() => {
    useServerStore.setState({ servers: {} });
  });

  it('starts a newly added endpoint disconnected until a probe succeeds', () => {
    const server = useServerStore.getState().add({ uri: 'https://example.test' });

    expect(server.status).toBe(ServerStatus.disconnected);
    expect(useServerStore.getState().servers[server.id].status).toBe(ServerStatus.disconnected);
  });

  it('does not trust a caller-provided online status before probing', () => {
    const server = useServerStore.getState().add({
      status: ServerStatus.online,
      uri: 'https://example.test',
    });

    expect(server.status).toBe(ServerStatus.disconnected);
  });
});
