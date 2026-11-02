import { installMobileWebEvents } from '..';

it('provides the DOM event contract required by native libp2p without host Event globals', () => {
  const host = {} as Pick<typeof globalThis, 'Event' | 'EventTarget' | 'CustomEvent'>;
  installMobileWebEvents(host);
  class Libp2pEvent extends host.Event {}
  const target = new host.EventTarget();
  const listener = jest.fn((event: Event) => {
    event.preventDefault();
  });
  target.addEventListener('peer', listener, { once: true });
  const detail = { peerId: 'peer' };
  const event = new host.CustomEvent('peer', { detail, cancelable: true });
  expect(target.dispatchEvent(event)).toBe(false);
  expect(event.detail).toBe(detail);
  expect(event.target).toBe(target);
  expect(event.defaultPrevented).toBe(true);
  target.dispatchEvent(new Libp2pEvent('peer'));
  expect(listener).toHaveBeenCalledTimes(1);
  target.addEventListener('remove', listener);
  target.removeEventListener('remove', listener);
  target.dispatchEvent(new host.Event('remove'));
  expect(listener).toHaveBeenCalledTimes(1);
  const EventBefore = host.Event;
  installMobileWebEvents(host);
  expect(host.Event).toBe(EventBefore);
});
