import React from 'react';
import { v4 as uuid } from 'uuid';
import { history, useModel } from '@umijs/max';
import { Button, Dropdown, Form, Input, Modal, Segmented } from 'antd';
import DarkDropdown from './DarkDropdown';
import {
  AppstoreOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';

import styles from './index.module.less';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useEaProject } from '@/ea/EaProjectContext';
import {
  ARCHITECTURE_SCOPES,
  GOVERNANCE_MODES,
  LIFECYCLE_COVERAGE_OPTIONS,
  REFERENCE_FRAMEWORKS,
  TIME_HORIZONS,
  type ArchitectureScope,
  type GovernanceMode,
  type LifecycleCoverage,
  type ReferenceFramework,
  type TimeHorizon,
} from '@/repository/repositoryMetadata';
import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewLayoutStore } from '@/diagram-studio/view-runtime/ViewLayoutStore';
import { DesignWorkspaceStore } from '@/ea/DesignWorkspaceStore';
import { message } from '@/ea/eaConsole';

const safeSlug = (value: string) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'export';

const safeParseJson = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readLocalStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const FirstLaunch: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const { createNewRepository, loadRepositoryFromJsonText, eaRepository, metadata } = useEaRepository();
  const { createProject, refreshProject } = useEaProject();

  const ACTIVE_REPO_ID_KEY = 'ea.repository.activeId';
  const ACTIVE_REPO_NAME_KEY = 'ea.repository.activeName';
  const PROJECT_DIRTY_KEY = 'ea.project.dirty';
  const PROJECT_STATUS_EVENT = 'ea:projectStatusChanged';
  const RECENT_REPOSITORIES_KEY = 'ea.repository.recent';
  const LEGACY_PROJECT_PATH_KEY = 'ea.project.filePath';
  const LEGACY_RECENT_PROJECTS_KEY = 'ea.project.recent';

  const [mode, setMode] = React.useState<'home' | 'create'>('home');
  const [legacyImportAvailable, setLegacyImportAvailable] = React.useState(false);
  const [legacyImporting, setLegacyImporting] = React.useState(false);
  const [recentProjects, setRecentProjects] = React.useState<
    Array<{ id: string; name: string; description?: string | null; lastOpened?: string | null }>
  >([]);
  const [createFormReady, setCreateFormReady] = React.useState(false);
  const [form] = Form.useForm<{
    repositoryName: string;
    organizationName: string;
    architectureScope: ArchitectureScope;
    referenceFramework: ReferenceFramework;
    governanceMode: GovernanceMode;
    lifecycleCoverage: LifecycleCoverage;
    timeHorizon: TimeHorizon;
  }>();
  const repositoryRef = React.useRef({ eaRepository, metadata });

  const importFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const readFileAsText = async (file: File) => {
    return await file.text();
  };

  React.useEffect(() => {
    repositoryRef.current = { eaRepository, metadata };
  }, [eaRepository, metadata]);

  const updateProjectStatus = React.useCallback(
    (opts: { repositoryId?: string | null; repositoryName?: string | null; dirty?: boolean | null; clear?: boolean }) => {
      if (opts.clear) {
        try {
          localStorage.removeItem(ACTIVE_REPO_ID_KEY);
          localStorage.removeItem(ACTIVE_REPO_NAME_KEY);
          localStorage.removeItem(PROJECT_DIRTY_KEY);
        } catch {
          // ignore
        }
      } else {
        if (opts.repositoryId === null) {
          try {
            localStorage.removeItem(ACTIVE_REPO_ID_KEY);
          } catch {
            // ignore
          }
        } else if (typeof opts.repositoryId === 'string') {
          try {
            localStorage.setItem(ACTIVE_REPO_ID_KEY, opts.repositoryId);
          } catch {
            // ignore
          }
        }

        if (opts.repositoryName === null) {
          try {
            localStorage.removeItem(ACTIVE_REPO_NAME_KEY);
          } catch {
            // ignore
          }
        } else if (typeof opts.repositoryName === 'string') {
          try {
            localStorage.setItem(ACTIVE_REPO_NAME_KEY, opts.repositoryName);
          } catch {
            // ignore
          }
        }

        if (typeof opts.dirty === 'boolean') {
          try {
            localStorage.setItem(PROJECT_DIRTY_KEY, String(opts.dirty));
          } catch {
            // ignore
          }
        }
      }

      try {
        window.dispatchEvent(new Event(PROJECT_STATUS_EVENT));
      } catch {
        // ignore
      }
    },
    [ACTIVE_REPO_ID_KEY, ACTIVE_REPO_NAME_KEY, PROJECT_DIRTY_KEY, PROJECT_STATUS_EVENT],
  );

  const applyProjectPayload = React.useCallback(
    (payload: any) => {
      const snapshot = payload?.repository?.snapshot ?? null;
      if (!snapshot || typeof snapshot !== 'object') {
        return { ok: false, error: 'Invalid repository data: missing snapshot.' } as const;
      }

      const snapshotText = JSON.stringify(snapshot);
      const loadRes = loadRepositoryFromJsonText(snapshotText);
      if (!loadRes.ok) return loadRes;

      const snapshotViews = Array.isArray((snapshot as any)?.views) ? (snapshot as any).views : [];
      const viewItems = snapshotViews.length > 0 ? snapshotViews : Array.isArray(payload?.views?.items) ? payload.views.items : [];
      const snapshotStudio = (snapshot as any)?.studioState ?? null;
      const viewLayouts = snapshotStudio?.viewLayouts ?? payload?.studioState?.viewLayouts ?? {};

      const existingViews = ViewStore.list();
      for (const v of existingViews) {
        ViewLayoutStore.remove(v.id);
      }

      ViewStore.replaceAll(viewItems);

      for (const v of viewItems as Array<{ id?: string }>) {
        const id = String(v?.id ?? '').trim();
        if (!id) continue;
        const layout = viewLayouts?.[id];
        if (layout && typeof layout === 'object') {
          ViewLayoutStore.set(id, layout as Record<string, { x: number; y: number }>);
        } else {
          ViewLayoutStore.remove(id);
        }
      }

      const repositoryName = snapshot?.metadata?.repositoryName || 'default';
      const designWorkspaces = Array.isArray(snapshotStudio?.designWorkspaces)
        ? snapshotStudio.designWorkspaces
        : Array.isArray(payload?.studioState?.designWorkspaces)
          ? payload.studioState.designWorkspaces
          : [];
      DesignWorkspaceStore.replaceAll(repositoryName, designWorkspaces);

      const ideLayout = payload?.studioState?.ideLayout ?? null;
      if (ideLayout && typeof ideLayout === 'object') {
        const map: Array<[string, string | null | undefined]> = [
          ['ide.activity', ideLayout.activity],
          ['ide.sidebar.open', ideLayout.sidebarOpen],
          ['ide.sidebar.width', ideLayout.sidebarWidth],
          ['ide.bottom.open', ideLayout.bottomOpen],
          ['ide.bottom.height', ideLayout.bottomHeight],
          ['ide.panel.dock', ideLayout.panelDock],
          ['ide.panel.right.width', ideLayout.rightPanelWidth],
        ];
        for (const [key, value] of map) {
          if (value === null || value === undefined) continue;
          try {
            localStorage.setItem(key, String(value));
          } catch {
            // ignore
          }
        }
      }

      const prefs = payload?.studioState?.preferences ?? null;
      if (prefs && typeof prefs === 'object') {
        const prefMap: Array<[string, string | null | undefined]> = [
          ['ea.applicationGrouping', prefs.applicationGrouping],
          ['ea.programmeScope.showTechnology', prefs.programmeScopeShowTechnology],
          ['ea.seed.banner.dismissed', prefs.seedBannerDismissed],
          ['ea.catalogDefined', prefs.catalogDefined],
        ];
        for (const [key, value] of prefMap) {
          if (value === null || value === undefined) continue;
          try {
            localStorage.setItem(key, String(value));
          } catch {
            // ignore
          }
        }
      }

      try {
        window.dispatchEvent(new Event('ea:viewsChanged'));
        window.dispatchEvent(new Event('ea:workspacesChanged'));
      } catch {
        // Best-effort only.
      }

      return { ok: true } as const;
    },
    [loadRepositoryFromJsonText],
  );

  const updateRecentProjects = React.useCallback(
    (entry: { id: string; name: string; description?: string | null }) => {
      try {
        const raw = localStorage.getItem(RECENT_REPOSITORIES_KEY);
        const existing = safeParseJson<Array<{ id: string; name: string; description?: string; lastOpened?: string }>>(raw, []);
        const next = [
          {
            id: entry.id,
            name: entry.name,
            description: entry.description ?? undefined,
            lastOpened: new Date().toISOString(),
          },
          ...existing.filter((item) => item.id && item.id !== entry.id),
        ].slice(0, 10);
        localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify(next));
        setRecentProjects(next);
      } catch {
        // ignore
      }
    },
    [RECENT_REPOSITORIES_KEY],
  );

  const removeRecentProject = React.useCallback(
    (id: string) => {
      try {
        const raw = localStorage.getItem(RECENT_REPOSITORIES_KEY);
        const existing = safeParseJson<Array<{ id: string; name: string; description?: string; lastOpened?: string }>>(raw, []);
        const next = existing.filter((item) => item.id !== id);
        localStorage.setItem(RECENT_REPOSITORIES_KEY, JSON.stringify(next));
        setRecentProjects(next);
      } catch {
        // ignore
      }
    },
    [RECENT_REPOSITORIES_KEY],
  );

  const waitForRepositoryReady = React.useCallback(async () => {
    for (let i = 0; i < 8; i += 1) {
      if (repositoryRef.current.eaRepository && repositoryRef.current.metadata) {
        return repositoryRef.current;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return repositoryRef.current;
  }, []);

  const buildProjectPayload = React.useCallback(async () => {
    const repoState = await waitForRepositoryReady();
    if (!repoState.eaRepository || !repoState.metadata) return null;

    const views = ViewStore.list();
    const viewLayouts = ViewLayoutStore.listAll();

    const repositoryName = repoState.metadata.repositoryName || 'default';
    const designWorkspaces = DesignWorkspaceStore.list(repositoryName);

    const studioState = {
      ideLayout: {
        activity: readLocalStorage('ide.activity'),
        sidebarOpen: readLocalStorage('ide.sidebar.open'),
        sidebarWidth: readLocalStorage('ide.sidebar.width'),
        bottomOpen: readLocalStorage('ide.bottom.open'),
        bottomHeight: readLocalStorage('ide.bottom.height'),
        panelDock: readLocalStorage('ide.panel.dock'),
        rightPanelWidth: readLocalStorage('ide.panel.right.width'),
      },
      preferences: {
        applicationGrouping: readLocalStorage('ea.applicationGrouping'),
        programmeScopeShowTechnology: readLocalStorage('ea.programmeScope.showTechnology'),
        seedBannerDismissed: readLocalStorage('ea.seed.banner.dismissed'),
        catalogDefined: readLocalStorage('ea.catalogDefined'),
      },
      viewLayouts,
      designWorkspaces,
    };

    const repositorySnapshot = {
      version: 1 as const,
      metadata: repoState.metadata,
      objects: Array.from(repoState.eaRepository.objects.values()).map((o) => ({
        id: o.id,
        type: o.type,
        attributes: { ...(o.attributes ?? {}) },
      })),
      relationships: repoState.eaRepository.relationships.map((r) => ({
        fromId: r.fromId,
        toId: r.toId,
        type: r.type,
        attributes: { ...(r.attributes ?? {}) },
      })),
      views,
      studioState: {
        viewLayouts,
        designWorkspaces,
      },
      updatedAt: new Date().toISOString(),
    };

    return {
      version: 1 as const,
      meta: {
        createdAt: repoState.metadata.createdAt,
        updatedAt: new Date().toISOString(),
        repositoryId: readLocalStorage(ACTIVE_REPO_ID_KEY) ?? undefined,
        repositoryName: repoState.metadata.repositoryName,
        organizationName: repoState.metadata.organizationName,
        referenceFramework: repoState.metadata.referenceFramework,
        timeHorizon: repoState.metadata.timeHorizon,
      },
      repository: {
        metadata: repoState.metadata,
        metamodel: repoState.metadata.frameworkConfig ?? null,
        snapshot: repositorySnapshot,
      },
      views: {
        items: views,
      },
      studioState,
    };
  }, [waitForRepositoryReady]);

  const handleOpenProject = React.useCallback(async () => {
    if (!window.eaDesktop?.listManagedRepositories) {
      message.info('Open Repository is available in the desktop app.');
      return;
    }

    const res = await window.eaDesktop.listManagedRepositories();
    if (!res.ok) {
      Modal.error({ title: 'Refresh Repositories failed', content: res.error });
      return;
    }

    setRecentProjects(
      res.items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? null,
        lastOpened: item.lastOpenedAt ?? null,
      })),
    );

    if (!res.items.length) {
      message.info('No repositories found. Create a new repository to begin.');
    }
  }, []);

  const handleOpenRecentProject = React.useCallback(
    async (entry: { id: string; name: string; description?: string | null }) => {
      if (!entry.id) return;
      if (!window.eaDesktop?.loadManagedRepository) {
        message.info('Open Repository is available in the desktop app.');
        return;
      }

      const res = await window.eaDesktop.loadManagedRepository(entry.id);
      if (!res.ok) {
        Modal.error({ title: 'Open Repository failed', content: res.error });
        return;
      }
      if (!res.content) {
        Modal.error({ title: 'Open Repository failed', content: 'Empty repository data.' });
        return;
      }

      try {
        const payload = JSON.parse(res.content);
        const applied = applyProjectPayload(payload);
        if (!applied.ok) {
          Modal.error({ title: 'Open Repository failed', content: applied.error });
          return;
        }

        const name =
          payload?.meta?.repositoryName ||
          payload?.repository?.metadata?.repositoryName ||
          entry.name ||
          'EA Repository';

        try {
          await createProject({
            name,
            description: payload?.meta?.organizationName ? `${payload.meta.organizationName} EA repository` : '',
          });
        } catch {
          // Best-effort only.
        }

        const description = payload?.meta?.organizationName
          ? `${payload.meta.organizationName} EA repository`
          : entry.description ?? null;
        updateProjectStatus({ repositoryId: res.repositoryId ?? entry.id, repositoryName: name, dirty: false });
        updateRecentProjects({ id: res.repositoryId ?? entry.id, name, description });
        message.success('Repository opened.');
        history.push('/workspace');
      } catch (err) {
        Modal.error({ title: 'Open Repository failed', content: err instanceof Error ? err.message : 'Invalid repository data.' });
      }
    },
    [applyProjectPayload, updateProjectStatus, updateRecentProjects],
  );

  const importRepositoryPackage = React.useCallback(
    async (rawText: string, sourceName?: string) => {
      const payload = JSON.parse(rawText);
      const applied = applyProjectPayload(payload);
      if (!applied.ok) {
        message.error(applied.error);
        return;
      }

      const repoState = await waitForRepositoryReady();
      const name =
        payload?.meta?.repositoryName ||
        payload?.repository?.metadata?.repositoryName ||
        repoState.metadata?.repositoryName ||
        sourceName ||
        'Imported Repository';
      const description = payload?.meta?.organizationName
        ? `${payload.meta.organizationName} EA repository`
        : repoState.metadata?.organizationName
          ? `${repoState.metadata.organizationName} EA repository`
          : null;
      const repositoryId = uuid();
      updateProjectStatus({ repositoryId, repositoryName: name, dirty: false });

      if (window.eaDesktop?.saveManagedRepository) {
        const nextPayload = await buildProjectPayload();
        if (nextPayload) {
          const saveRes = await window.eaDesktop.saveManagedRepository({ payload: nextPayload, repositoryId });
          if (!saveRes.ok) {
            message.error(saveRes.error);
            return;
          }
        }
      }

      updateRecentProjects({ id: repositoryId, name, description });
      message.success('Repository imported.');
      history.push('/workspace');
    },
    [applyProjectPayload, buildProjectPayload, updateProjectStatus, updateRecentProjects, waitForRepositoryReady],
  );

  const resolveLegacyProjectPath = React.useCallback((): string | null => {
    const direct = readLocalStorage(LEGACY_PROJECT_PATH_KEY);
    if (direct) return direct;
    const raw = readLocalStorage(LEGACY_RECENT_PROJECTS_KEY);
    const parsed = safeParseJson<Array<{ path?: string }>>(raw, []);
    const candidate = parsed.find((item) => typeof item.path === 'string' && item.path.trim());
    return candidate?.path?.trim() || null;
  }, [LEGACY_PROJECT_PATH_KEY, LEGACY_RECENT_PROJECTS_KEY]);

  const handleLegacyImport = React.useCallback(async () => {
    if (!window.eaDesktop?.importLegacyProjectAtPath) {
      message.info('Legacy import is available in the desktop app.');
      return;
    }

    const legacyPath = resolveLegacyProjectPath();
    if (!legacyPath) {
      message.info('No legacy repository detected.');
      return;
    }

    setLegacyImporting(true);
    try {
      const res = await window.eaDesktop.importLegacyProjectAtPath(legacyPath);
      if (!res.ok) {
        message.error(res.error);
        return;
      }

      await importRepositoryPackage(res.content, res.name);

      try {
        localStorage.removeItem(LEGACY_PROJECT_PATH_KEY);
        localStorage.removeItem(LEGACY_RECENT_PROJECTS_KEY);
      } catch {
        // ignore
      }
      setLegacyImportAvailable(false);
    } finally {
      setLegacyImporting(false);
    }
  }, [importRepositoryPackage, resolveLegacyProjectPath]);

  const onImportFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.eaproj')) {
      message.info('Please choose an .eaproj repository package.');
      return;
    }
    try {
      const text = await readFileAsText(file);
      await importRepositoryPackage(text, file.name);
    } catch (e: any) {
      message.error(e?.message || 'Failed to import repository.');
    }
  };

  const readRecentProjects = React.useCallback(async () => {
    if (window.eaDesktop?.listManagedRepositories) {
      const res = await window.eaDesktop.listManagedRepositories();
      if (res.ok) {
        setRecentProjects(
          res.items.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            lastOpened: item.lastOpenedAt ?? null,
          })),
        );
        return;
      }
    }

    try {
      const raw = localStorage.getItem(RECENT_REPOSITORIES_KEY);
      if (raw) {
        const parsed = safeParseJson<Array<{ id: string; name: string; description?: string; lastOpened?: string }>>(raw, []);
        if (parsed.length) {
          setRecentProjects(
            parsed.map((item) => ({
              id: item.id,
              name: item.name,
              description: item.description ?? null,
              lastOpened: item.lastOpened ?? null,
            })),
          );
          return;
        }
      }

      const activeId = localStorage.getItem(ACTIVE_REPO_ID_KEY);
      const activeName = localStorage.getItem(ACTIVE_REPO_NAME_KEY);
      if (!activeId || !activeName) {
        setRecentProjects([]);
        return;
      }
      setRecentProjects([{ id: activeId, name: activeName, description: null, lastOpened: null }]);
    } catch {
      setRecentProjects([]);
    }
  }, [ACTIVE_REPO_ID_KEY, ACTIVE_REPO_NAME_KEY, RECENT_REPOSITORIES_KEY]);


  React.useEffect(() => {
    void readRecentProjects();
    const onStatus = () => {
      void readRecentProjects();
    };
    window.addEventListener(PROJECT_STATUS_EVENT, onStatus as EventListener);
    window.addEventListener('storage', onStatus as EventListener);
    return () => {
      window.removeEventListener(PROJECT_STATUS_EVENT, onStatus as EventListener);
      window.removeEventListener('storage', onStatus as EventListener);
    };
  }, [PROJECT_STATUS_EVENT, readRecentProjects]);

  React.useEffect(() => {
    const legacyPath = resolveLegacyProjectPath();
    setLegacyImportAvailable(Boolean(legacyPath));
  }, [resolveLegacyProjectPath]);

  React.useEffect(() => {
    if (!window.eaDesktop?.consumePendingRepositoryImports) return;

    const consumePending = async () => {
      const res = await window.eaDesktop?.consumePendingRepositoryImports();
      if (!res || !res.ok) return;
      for (const item of res.items || []) {
        try {
          await importRepositoryPackage(item.content, item.name);
        } catch {
          // Best-effort only.
        }
      }
    };

    void consumePending();

    if (window.eaDesktop?.onRepositoryPackageImport) {
      window.eaDesktop.onRepositoryPackageImport((payload) => {
        void importRepositoryPackage(payload.content, payload.name);
      });
    }
  }, [importRepositoryPackage]);

  return (
    <div className={styles.pageRoot}>
      {/* ── TOP HEADER — matches Electron titleBarOverlay height ── */}
      <div className={styles.topHeader}>
        <span className={styles.topHeaderTitle}>Architecture Studio</span>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div className={styles.shellLayout}>
        {/* ── LEFT SIDEBAR — action anchor ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarActions}>
            <button type="button" className={styles.sidebarBtn} onClick={() => setMode('create')}>
              <PlusOutlined /> Create New Repository
            </button>
            <button type="button" className={`${styles.sidebarBtn} ${styles.sidebarBtnSecondary}`} onClick={handleOpenProject}>
              <FolderOpenOutlined /> Open Repository
            </button>
            <button type="button" className={`${styles.sidebarBtn} ${styles.sidebarBtnSecondary}`} onClick={() => importFileInputRef.current?.click()}>
              <ImportOutlined /> Import Repository
            </button>
            {legacyImportAvailable ? (
              <button type="button" className={`${styles.sidebarBtn} ${styles.sidebarBtnSecondary}`} onClick={handleLegacyImport}>
                <ImportOutlined /> Import Legacy
              </button>
            ) : null}
          </div>
          <div className={styles.sidebarDivider} />
          <div className={styles.sidebarSection}>Explorer</div>
          <div className={styles.sidebarStatus}>
            <span className={styles.sidebarStatusLabel}>No Repository Opened</span>
            Open or create a repository to begin.
          </div>
          <input
            ref={importFileInputRef}
            type="file"
            accept="application/octet-stream,.eaproj"
            style={{ display: 'none' }}
            onChange={(e) => {
              void onImportFileSelected(e.target.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
        </div>

        {/* ── CENTER PANEL — context surface ── */}
        {mode === 'home' ? (
          <div className={styles.centerPanel}>
            <div className={styles.centerContent}>
              {/* branding */}
              <div className={styles.brand}>
                <h1 className={styles.brandTitle}>Welcome</h1>
                <p className={styles.brandSubtitle}>Enterprise Architecture Modeling Environment</p>
              </div>

              {/* workspace context */}
              <div className={styles.workspaceContext}>
                <h2 className={styles.workspaceContextTitle}>Workspace Context</h2>
                <p className={styles.workspaceContextText}>
                  Repositories store your enterprise models, views, and relationships.
                </p>
                <p className={styles.workspaceContextHint}>
                  Create or open a repository to start modeling.
                </p>
              </div>

              <hr className={styles.sectionDivider} />

              {/* Recent section */}
              <div className={styles.welcomeSection}>
                <h2 className={styles.welcomeSectionTitle}>Recent</h2>
                <div className={styles.recentList}>
                  {recentProjects.length ? (
                    recentProjects.map((item) => {
                      const desc = item.description || 'EA repository';
                      const timeStr = item.lastOpened
                        ? new Date(item.lastOpened).toLocaleString()
                        : null;
                      return (
                        <Dropdown
                          key={`${item.id}-${item.name}`}
                          menu={{
                            items: [
                              { key: 'open', label: 'Open' },
                              { key: 'remove', label: 'Remove from Recent' },
                              { type: 'divider' },
                              { key: 'reveal', label: 'Reveal in Explorer', disabled: true },
                            ],
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              if (key === 'open') void handleOpenRecentProject(item);
                              else if (key === 'remove') removeRecentProject(item.id);
                            },
                          }}
                          trigger={['contextMenu']}
                        >
                          <button
                            type="button"
                            onClick={() => void handleOpenRecentProject(item)}
                            className={styles.recentRow}
                          >
                            <div className={styles.recentRowIcon}>
                              <AppstoreOutlined />
                            </div>
                            <div className={styles.recentRowCenter}>
                              <span className={styles.recentRowName} title={item.name}>
                                {item.name}
                              </span>
                              <span className={styles.recentRowMeta} title={desc}>
                                {desc}
                              </span>
                            </div>
                            <div className={styles.recentRowRight}>
                              {timeStr && (
                                <span className={styles.recentRowTime}>{timeStr}</span>
                              )}
                              <span className={styles.recentRowHint}>
                                <RightOutlined />
                              </span>
                            </div>
                          </button>
                        </Dropdown>
                      );
                    })
                  ) : (
                    <div className={styles.emptyRecent}>
                      No recent repositories. Create or open a repository to get started.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── CREATE FORM ── */
          <div className={styles.createFormPanel}>
            <div className={styles.createFormInner}>
              <div className={styles.createFormHeader}>
                <div className={styles.createFormIconWrap}>
                  <AppstoreOutlined />
                </div>
                <div>
                  <h2 className={styles.createFormTitle}>New Repository</h2>
                  <p className={styles.createFormHint}>
                    Create a repository to store architecture models, views,
                    and relationships for your organization.
                  </p>
                </div>
              </div>
              <div className={styles.createFormDivider} />
              <Form
                form={form}
                layout="vertical"
                size="middle"
                requiredMark={false}
                initialValues={{
                  architectureScope: 'Enterprise',
                  referenceFramework: 'Custom',
                  governanceMode: 'Strict',
                  lifecycleCoverage: 'Both',
                  timeHorizon: '1–3 years',
                }}
                onValuesChange={() => {
                  const v = form.getFieldsValue();
                  setCreateFormReady(
                    Boolean(v.repositoryName?.trim()) && Boolean(v.organizationName?.trim()),
                  );
                }}
                onFinish={(values) => {
                  const res = createNewRepository({
                    ...values,
                  });
                  if (!res.ok) {
                    message.error(res.error);
                    return;
                  }

                  try {
                    const intent =
                      values.architectureScope === 'Domain'
                        ? 'business.capabilities'
                        : values.architectureScope === 'Programme'
                          ? 'implmig.programmes'
                          : 'business.enterprises';
                    localStorage.setItem('ea.startup.open.v1', intent);
                  } catch {
                    // Best-effort only.
                  }

                  void (async () => {
                    try { await refreshProject(); } catch { /* ignore */ }

                    try {
                      await createProject({
                        name: values.repositoryName,
                        description: `${values.organizationName} EA repository`,
                      });
                    } catch { /* ignore */ }

                    const repositoryId = uuid();
                    updateProjectStatus({
                      repositoryId,
                      repositoryName: values.repositoryName,
                      dirty: false,
                    });

                    const payload = await buildProjectPayload();
                    if (!payload) {
                      message.error('Failed to create repository data.');
                      return;
                    }

                    if (!window.eaDesktop?.saveManagedRepository) {
                      message.info('Managed repositories are available in the desktop app.');
                      return;
                    }

                    const saveRes = await window.eaDesktop.saveManagedRepository({
                      payload,
                      repositoryId,
                    });

                    if (!saveRes.ok) {
                      message.error(saveRes.error);
                      return;
                    }

                    const description = values.organizationName
                      ? `${values.organizationName} EA repository`
                      : null;
                    updateRecentProjects({ id: saveRes.repositoryId ?? repositoryId, name: values.repositoryName, description });
                    history.push('/workspace');
                  })();

                  message.success('Repository created.');
                }}
              >
                {/* ── Section 1: Basic Information ── */}
                <div className={styles.createFormSectionLabel}>Basic Information</div>
                <Form.Item
                  name="repositoryName"
                  rules={[{ required: true, whitespace: true, message: '' }]}
                >
                  <Input placeholder="Repository name" autoFocus />
                </Form.Item>
                <Form.Item
                  name="organizationName"
                  rules={[{ required: true, whitespace: true, message: '' }]}
                >
                  <Input placeholder="Organization name" />
                </Form.Item>

                {/* ── Section 2: Architecture Defaults ── */}
                <div className={styles.createFormSectionDivider} />
                <div className={styles.createFormSectionLabel}>Architecture Defaults</div>
                <div className={styles.createFormFieldRow}>
                  <Form.Item label="Scope" name="architectureScope" className={styles.createFormFieldHalf}>
                    <DarkDropdown options={ARCHITECTURE_SCOPES.map((v) => ({ value: v, label: v }))} />
                  </Form.Item>
                  <Form.Item label="Framework" name="referenceFramework" className={styles.createFormFieldHalf}>
                    <DarkDropdown options={REFERENCE_FRAMEWORKS.map((v) => ({ value: v, label: v }))} />
                  </Form.Item>
                </div>

                {/* ── Section 3: Governance & Planning ── */}
                <div className={styles.createFormSectionDivider} />
                <div className={styles.createFormSectionLabel}>Governance & Planning</div>
                <Form.Item label="Governance" name="governanceMode">
                  <Segmented
                    options={GOVERNANCE_MODES}
                    className={styles.createFormSegmented}
                  />
                </Form.Item>
                <div className={styles.createFormFieldRow}>
                  <Form.Item label="Lifecycle" name="lifecycleCoverage" className={styles.createFormFieldHalf}>
                    <DarkDropdown options={LIFECYCLE_COVERAGE_OPTIONS.map((v) => ({ value: v, label: v }))} />
                  </Form.Item>
                  <Form.Item label="Horizon" name="timeHorizon" className={styles.createFormFieldHalf}>
                    <DarkDropdown options={TIME_HORIZONS.map((v) => ({ value: v, label: v }))} />
                  </Form.Item>
                </div>
                <div className={styles.createFormActions}>
                  <button
                    type="button"
                    className={styles.createFormBackBtn}
                    onClick={() => { setMode('home'); setCreateFormReady(false); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`${styles.createFormSubmitBtn} ${createFormReady ? styles.createFormSubmitReady : ''}`}
                    disabled={!createFormReady}
                  >
                    Create Repository
                  </button>
                </div>
              </Form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FirstLaunch;
