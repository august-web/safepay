import { useEffect, useRef } from 'react';
import { announce } from './announcer';

/**
 * Announces a message once when a screen/section becomes active - used for
 * route changes and step transitions so screen readers land in the right
 * place with the right context (brief: focus management pattern).
 */
export function useAnnounceOnFocus(message: string | null): void {
  const lastMessage = useRef<string | null>(null);

  useEffect(() => {
    if (message == null || message.length === 0) return;
    if (lastMessage.current === message) return;
    lastMessage.current = message;
    // Small delay lets the navigation transition finish first.
    const timer = setTimeout(() => announce(message), 150);
    return () => clearTimeout(timer);
  }, [message]);
}
