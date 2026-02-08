import React from 'react';
import { Button, Select } from 'antd';
import { eaConsole, type EAConsoleDomain, type EAConsoleLevel, type EAConsoleMessage } from '@/ea/eaConsole';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import styles from './style.module.less';

const LEVELS: EAConsoleLevel[] = ['info', 'success', 'warning', 'error'];
const DOMAINS: EAConsoleDomain[] = ['canvas', 'relationship', 'validation', 'repository', 'governance', 'system'];

const useConsoleMessages = () => {
  return React.useSyncExternalStore(eaConsole.subscribe, eaConsole.getSnapshot, eaConsole.getSnapshot);
};

const formatTimestamp = (ts: number) => {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const resolveElementType = (repo: ReturnType<typeof useEaRepository>['eaRepository'], elementId?: string) => {
  if (!repo || !elementId) return null;
  return repo.objects.get(elementId)?.type ?? null;
};

const buildContextSummary = (msg: EAConsoleMessage) => {
  const parts: string[] = [];
  if (msg.context?.elementId) parts.push(`Element: ${msg.context.elementId}`);
  if (msg.context?.relationshipType) parts.push(`Relationship: ${msg.context.relationshipType}`);
  if (msg.context?.viewId) parts.push(`View: ${msg.context.viewId}`);
  return parts.join(' • ');
};

const EAConsolePanel: React.FC = () => {
  const messages = useConsoleMessages();
  const { eaRepository } = useEaRepository();
  const { setSelectedElement } = useIdeSelection();
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollRef = React.useRef(true);

  const [levelFilter, setLevelFilter] = React.useState<EAConsoleLevel | 'all'>('all');
  const [domainFilter, setDomainFilter] = React.useState<EAConsoleDomain | 'all'>('all');

  const filtered = React.useMemo(() => {
    return messages.filter((msg) => {
      const levelOk = levelFilter === 'all' || msg.level === levelFilter;
      const domainOk = domainFilter === 'all' || msg.domain === domainFilter;
      return levelOk && domainOk;
    });
  }, [messages, levelFilter, domainFilter]);

  React.useEffect(() => {
    if (!listRef.current || !autoScrollRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [filtered.length]);

  const onScroll = React.useCallback(() => {
    const node = listRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    autoScrollRef.current = distance < 12;
  }, []);

  const levelOptions = [{ value: 'all', label: 'All levels' }, ...LEVELS.map((level) => ({ value: level, label: level }))];
  const domainOptions = [{ value: 'all', label: 'All domains' }, ...DOMAINS.map((domain) => ({ value: domain, label: domain }))];

  const handleEntryClick = (msg: EAConsoleMessage) => {
    if (!msg.context?.elementId) return;
    const elementType = resolveElementType(eaRepository, msg.context.elementId);
    setSelectedElement({
      id: msg.context.elementId,
      type: elementType ?? 'Unknown',
      source: 'Console',
    });
  };

  return (
    <div className={styles.consoleRoot}>
      <div className={styles.consoleHeader}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Level</span>
          <Select
            className={styles.filterSelect}
            size="small"
            value={levelFilter}
            onChange={(next) => setLevelFilter(next as EAConsoleLevel | 'all')}
            options={levelOptions}
          />
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Domain</span>
          <Select
            className={styles.filterSelect}
            size="small"
            value={domainFilter}
            onChange={(next) => setDomainFilter(next as EAConsoleDomain | 'all')}
            options={domainOptions}
          />
        </div>
        <div className={styles.headerActions}>
          <Button size="small" onClick={() => eaConsole.clear()}>
            Clear
          </Button>
        </div>
      </div>

      <div className={styles.consoleList} ref={listRef} onScroll={onScroll}>
        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No console messages.</div>
        ) : (
          filtered.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.consoleRow} ${styles[`level${msg.level}`] ?? ''}`}
              role="button"
              tabIndex={0}
              title={buildContextSummary(msg) || undefined}
              onClick={() => handleEntryClick(msg)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleEntryClick(msg);
              }}
            >
              <div className={styles.rowMeta}>
                <span className={styles.timestamp}>{formatTimestamp(msg.timestamp)}</span>
                <span className={styles.domain}>{msg.domain}</span>
                <span className={styles.level}>{msg.level}</span>
              </div>
              <div className={styles.rowMessage}>{msg.message}</div>
              {msg.context ? (
                <div className={styles.rowContext}>{buildContextSummary(msg)}</div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default EAConsolePanel;
