import { formatMobileTimelineTimestamp, mobileMessageRoleKey } from '../localizedFormatting';

it.each([
  ['assistant', 'AgentChat.Agent'],
  ['user', 'AgentChat.User'],
  ['tool', 'AgentChat.Tool'],
  ['system', 'AgentChat.Agent'],
])('uses the shared detail role translation for %s', (role, key) => {
  expect(mobileMessageRoleKey(role)).toBe(key);
});

describe('formatMobileTimelineTimestamp', () => {
  const timestamp = Date.UTC(2026, 7, 26, 9, 7);

  it.each(['en', 'ja', 'zh-CN'])('formats a bounded timeline marker for %s', locale => {
    const formatted = formatMobileTimelineTimestamp(timestamp, locale);
    expect(formatted).toContain('2026');
    expect(formatted.length).toBeLessThan(80);
  });

  it('fails closed for invalid timestamps', () => {
    expect(formatMobileTimelineTimestamp(Number.NaN, 'en')).toBe('—');
  });
});
