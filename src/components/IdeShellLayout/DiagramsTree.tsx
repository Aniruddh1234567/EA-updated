import {
  ApartmentOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { Button, Input, Modal, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import React from 'react';
import { useLocation } from '@umijs/max';
import { useIdeShell } from './index';
import styles from './style.module.less';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { message } from '@/ea/eaConsole';

import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';

const buildTree = (
  views: ViewInstance[],
  opts?: { showCreate?: boolean; onRename?: (view: ViewInstance) => void; onDelete?: (view: ViewInstance) => void },
): DataNode[] => {
  const savedOnly = views.filter((v) => v.status === 'SAVED');
  const sorted = [...savedOnly].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const savedViewNodes: DataNode[] =
    sorted.length === 0
      ? [
          {
            key: 'views:empty',
            title: 'No saved views',
            selectable: false,
            icon: <FileTextOutlined />,
            isLeaf: true,
          } satisfies DataNode,
        ]
      : sorted.map((v) => {
          const viewpoint = ViewpointRegistry.get(v.viewpointId);
          const viewpointLabel = viewpoint?.name ?? v.viewpointId;
          return {
            key: `view:${v.id}`,
            title: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>
                  {v.name} <span style={{ color: '#8c8c8c' }}>({viewpointLabel})</span>
                </span>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      opts?.onRename?.(v);
                    }}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      opts?.onDelete?.(v);
                    }}
                  />
                </span>
              </span>
            ),
            icon: <FileTextOutlined />,
            isLeaf: true,
          } satisfies DataNode;
        });

  const children: DataNode[] = [
    ...(opts?.showCreate === false
      ? []
      : [
          {
            key: '/views/create',
            title: 'Create View…',
            icon: <FileAddOutlined />,
            isLeaf: true,
          } satisfies DataNode,
        ]),
    {
      key: 'views:saved',
      title: 'Saved Views',
      icon: <ApartmentOutlined />,
      selectable: false,
      children: savedViewNodes,
    } satisfies DataNode,
  ];

  return [
    {
      key: 'diagrams',
      title: 'DIAGRAMS',
      icon: <ApartmentOutlined />,
      selectable: false,
      children,
    },
  ];
};

const DiagramsTree: React.FC = () => {
  const { openRouteTab, studioMode, requestStudioViewSwitch } = useIdeShell();
  const { selection, setSelection, setSelectedElement } = useIdeSelection();
  const { metadata } = useEaRepository();
  const location = useLocation();

  const handleRenameView = React.useCallback((view: ViewInstance) => {
    let nextName = view.name;
    Modal.confirm({
      title: 'Rename view',
      okText: 'Rename',
      cancelText: 'Cancel',
      content: (
        <Input
          defaultValue={view.name}
          onChange={(e) => {
            nextName = e.target.value;
          }}
          placeholder="View name"
        />
      ),
      onOk: () => {
        const name = (nextName ?? '').trim();
        if (!name) {
          message.error('Name is required.');
          return Promise.reject();
        }
        ViewStore.update(view.id, (current) => ({ ...current, name }));
        try {
          window.dispatchEvent(new Event('ea:viewsChanged'));
        } catch {
          // Best-effort only.
        }
        message.success('View renamed.');
      },
    });
  }, []);

  const handleDeleteView = React.useCallback((view: ViewInstance) => {
    Modal.confirm({
      title: 'Delete view?',
      content: 'Deleting a view removes only the view definition. Repository content remains unchanged.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => {
        const removed = ViewStore.remove(view.id);
        if (!removed) {
          message.error('Delete failed. View not found.');
          return;
        }
        try {
          window.dispatchEvent(new Event('ea:viewsChanged'));
        } catch {
          // Best-effort only.
        }
        message.success('View deleted.');
      },
    });
  }, []);

  const [treeData, setTreeData] = React.useState<DataNode[]>(() => {
    try {
      const views = ViewStore.list();
      return buildTree(views, { showCreate: true, onRename: handleRenameView, onDelete: handleDeleteView });
    } catch {
      return buildTree([], { showCreate: true, onRename: handleRenameView, onDelete: handleDeleteView });
    }
  });

  React.useEffect(() => {
    const refresh = () => {
      try {
        setTreeData(buildTree(ViewStore.list(), { showCreate: true, onRename: handleRenameView, onDelete: handleDeleteView }));
      } catch {
        setTreeData(buildTree([], { showCreate: true, onRename: handleRenameView, onDelete: handleDeleteView }));
      }
    };

    refresh();
    window.addEventListener('ea:viewsChanged', refresh);
    return () => window.removeEventListener('ea:viewsChanged', refresh);
  }, [handleDeleteView, handleRenameView, metadata?.updatedAt]);

  const activeViewId = React.useMemo(() => {
    const path = location?.pathname ?? '';
    if (!path.startsWith('/views/')) return null;
    if (path.startsWith('/views/create')) return null;
    const parts = path.split('/').filter(Boolean);
    return parts.length >= 2 ? parts[1] : null;
  }, [location?.pathname]);

  const selectedKeys = React.useMemo(() => {
    if (activeViewId) return [`view:${activeViewId}`];
    if (selection.kind === 'view' && selection.keys.length > 0) return [`view:${selection.keys[0]}`];
    if (selection.kind === 'route' && selection.keys.length > 0) return [selection.keys[0]];
    return [] as string[];
  }, [activeViewId, selection.kind, selection.keys]);

  return (
    <div className={styles.explorerTree}>
      <Tree
        showIcon
        defaultExpandAll
        selectable
        treeData={treeData}
        selectedKeys={selectedKeys}
        onSelect={(selectedKeys: React.Key[], info) => {
          const key = selectedKeys?.[0];
          if (typeof key !== 'string') return;

          if (key === '/views/create') {
            if (studioMode) {
              setSelection({ kind: 'route', keys: [] });
              window.dispatchEvent(new CustomEvent('ea:studio.view.create'));
              return;
            }
            setSelection({ kind: 'route', keys: [] });
            openRouteTab(key);
            return;
          }

          if (key.startsWith('view:')) {
            const viewId = key.slice('view:'.length);
            if (!viewId) return;
            setSelection({ kind: 'view', keys: [viewId] });
            if (studioMode) {
              setSelectedElement(null);
              setSelection({ kind: 'none', keys: [] });
              const native = info?.nativeEvent as MouseEvent | KeyboardEvent | undefined;
              const modifier = Boolean(native && (native.metaKey || native.ctrlKey || native.shiftKey));
              requestStudioViewSwitch(viewId, { openMode: modifier ? 'new' : 'replace' });
              return;
            }
            openRouteTab(`/views/${viewId}`);
          }
        }}
      />
    </div>
  );
};

export default DiagramsTree;
