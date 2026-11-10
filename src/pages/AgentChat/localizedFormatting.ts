export function mobileMessageRoleKey(role: string): 'AgentChat.User' | 'AgentChat.Tool' | 'AgentChat.Agent' {
  return role === 'user' ? 'AgentChat.User' : role === 'tool' ? 'AgentChat.Tool' : 'AgentChat.Agent';
}

export function formatMobileTimelineTimestamp(timestamp: number, locale?: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
