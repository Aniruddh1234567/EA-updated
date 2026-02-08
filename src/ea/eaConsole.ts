export type EAConsoleLevel = 'info' | 'warning' | 'error' | 'success';
export type EAConsoleDomain = 'canvas' | 'relationship' | 'validation' | 'repository' | 'governance' | 'system';

export type EAConsoleMessage = {
  id: string;
  timestamp: number;
  level: EAConsoleLevel;
  domain: EAConsoleDomain;
  message: string;
  context?: {
    elementId?: string;
    relationshipType?: string;
    viewId?: string;
  };
};

type EAConsoleInternalMessage = EAConsoleMessage & { expiresAt?: number };

const DEFAULT_SUCCESS_TTL_MS = 5000;

const listeners = new Set<() => void>();
let messages: EAConsoleInternalMessage[] = [];
let cleanupTimer: number | null = null;

const notify = () => {
  listeners.forEach((listener) => listener());
};

const generateId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `ea-console-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const scheduleCleanup = () => {
  if (cleanupTimer !== null) {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }

  const now = Date.now();
  const nextExpiry = messages
    .map((msg) => msg.expiresAt)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b)[0];

  if (!nextExpiry) return;

  const delay = Math.max(50, nextExpiry - now);
  cleanupTimer = window.setTimeout(() => {
    cleanupTimer = null;
    const cutoff = Date.now();
    const nextMessages = messages.filter((msg) => !msg.expiresAt || msg.expiresAt > cutoff);
    if (nextMessages.length !== messages.length) {
      messages = nextMessages;
      notify();
    }
    scheduleCleanup();
  }, delay);
};

export type EAConsolePushInput = {
  id?: string;
  timestamp?: number;
  level: EAConsoleLevel;
  domain?: EAConsoleDomain;
  message: string;
  context?: EAConsoleMessage['context'];
  ttlMs?: number;
};

const push = (input: EAConsolePushInput): string => {
  const now = input.timestamp ?? Date.now();
  const ttlMs = input.ttlMs ?? (input.level === 'success' ? DEFAULT_SUCCESS_TTL_MS : undefined);
  const message: EAConsoleInternalMessage = {
    id: input.id ?? generateId(),
    timestamp: now,
    level: input.level,
    domain: input.domain ?? 'system',
    message: input.message,
    context: input.context,
    expiresAt: ttlMs ? now + ttlMs : undefined,
  };

  messages = [...messages, message];
  notify();
  scheduleCleanup();
  return message.id;
};

const clear = () => {
  messages = [];
  notify();
};

const remove = (id: string) => {
  const next = messages.filter((msg) => msg.id !== id);
  if (next.length !== messages.length) {
    messages = next;
    notify();
  }
};

const getSnapshot = () => messages;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const eaConsole = {
  push,
  clear,
  remove,
  getSnapshot,
  subscribe,
};

const normalizeContent = (content: unknown) => {
  if (typeof content === 'string') return content;
  if (content instanceof Error) return content.message;
  if (content == null) return '';
  return String(content);
};

type MessageArgs =
  | string
  | {
      content?: unknown;
      key?: string;
      duration?: number;
      domain?: EAConsoleDomain;
      context?: EAConsoleMessage['context'];
    };

const pushMessage = (level: EAConsoleLevel, args: MessageArgs, duration?: number) => {
  const isObj = typeof args === 'object' && args !== null && !Array.isArray(args);
  const content = isObj ? normalizeContent((args as any).content) : normalizeContent(args);
  const key = isObj ? (args as any).key : undefined;
  const domain = (isObj ? (args as any).domain : undefined) as EAConsoleDomain | undefined;
  const context = isObj ? (args as any).context : undefined;
  const rawDuration = typeof duration === 'number' ? duration : isObj ? (args as any).duration : undefined;
  const ttlMs = typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration * 1000 : undefined;
  return eaConsole.push({
    id: key,
    level,
    domain,
    message: content,
    context,
    ttlMs,
  });
};

export const message = {
  info: (args: MessageArgs, duration?: number) => pushMessage('info', args, duration),
  success: (args: MessageArgs, duration?: number) => pushMessage('success', args, duration),
  warning: (args: MessageArgs, duration?: number) => pushMessage('warning', args, duration),
  error: (args: MessageArgs, duration?: number) => pushMessage('error', args, duration),
  loading: (args: MessageArgs, duration?: number) => pushMessage('info', args, duration),
  destroy: (key?: string) => {
    if (key) remove(key);
    else clear();
  },
};

type NotificationArgs = {
  message?: unknown;
  description?: unknown;
  key?: string;
  duration?: number;
  domain?: EAConsoleDomain;
  context?: EAConsoleMessage['context'];
};

const pushNotification = (level: EAConsoleLevel, args: NotificationArgs) => {
  const title = normalizeContent(args.message);
  const description = normalizeContent(args.description);
  const combined = description ? `${title} ${description}`.trim() : title;
  const ttlMs = typeof args.duration === 'number' && args.duration > 0 ? args.duration * 1000 : undefined;
  return eaConsole.push({
    id: args.key,
    level,
    domain: args.domain,
    message: combined,
    context: args.context,
    ttlMs,
  });
};

export const notification = {
  open: (args: NotificationArgs) => pushNotification('info', args),
  info: (args: NotificationArgs) => pushNotification('info', args),
  success: (args: NotificationArgs) => pushNotification('success', args),
  warning: (args: NotificationArgs) => pushNotification('warning', args),
  error: (args: NotificationArgs) => pushNotification('error', args),
  destroy: (key?: string) => {
    if (key) remove(key);
    else clear();
  },
};
