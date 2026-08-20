import { mergeServerStatuses } from '../serverStatus';

const originalServer = {
  id: 'desktop',
  name: 'Old desktop',
  provider: 'TidGi-Desktop',
  status: 'online',
  uri: 'http://old.example',
  useStandardGitProtocol: false,
};

describe('mergeServerStatuses', () => {
  it('keeps configuration edited while an older status request was running', () => {
    const editedServer = {
      ...originalServer,
      name: 'New desktop',
      uri: 'https://new.example',
      useStandardGitProtocol: true,
    };

    expect(mergeServerStatuses(
      { desktop: editedServer },
      { desktop: 'disconnected' },
    )).toEqual({
      desktop: {
        ...editedServer,
        status: 'disconnected',
      },
    });
  });

  it('does not restore a deleted server or discard a newly added server', () => {
    const newServer = { ...originalServer, id: 'new', name: 'New server' };

    expect(mergeServerStatuses(
      { new: newServer },
      { desktop: 'online' },
    )).toEqual({ new: newServer });
  });

  it('preserves identity when probe results do not change status', () => {
    const servers = { desktop: originalServer };
    const merged = mergeServerStatuses(servers, { desktop: 'online' });

    expect(merged).toBe(servers);
    expect(merged.desktop).toBe(originalServer);
  });
});
