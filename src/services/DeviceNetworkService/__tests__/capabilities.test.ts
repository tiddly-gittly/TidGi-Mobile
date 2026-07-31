import { buildMobileCapabilities } from '../capabilities';

describe('mobile device capabilities', () => {
  it('advertises wiki data but not an inbound agent loop that Mobile does not implement', () => {
    expect(buildMobileCapabilities([
      { id: 'wiki-1', name: 'Notes', type: 'wiki', wikiFolderLocation: '/documents/wiki-1' },
      { id: 'web', name: 'Web', type: 'webpage' },
    ])).toEqual({
      tools: [],
      mcpServers: [],
      hasWiki: true,
      agentLoop: false,
      imChannels: [],
      wikis: [{ wikiId: 'wiki-1', title: 'Notes', pathHint: '/documents/wiki-1' }],
    });
  });
});
