import { formatMobileTimelineTimestamp } from '../localizedFormatting';

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
