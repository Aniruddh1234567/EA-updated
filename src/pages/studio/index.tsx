import React from 'react';
import { history, useParams } from '@umijs/max';
import { Alert, Typography } from 'antd';
import { setStudioActiveRepositoryId } from '@/services/studio';

const StudioRuntimePage: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [workspace, setWorkspace] = React.useState<{
    id: string;
    name: string;
    description: string;
    layout: unknown;
    mode: 'DRAFT';
    repositoryId?: string | null;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState(false);

  React.useEffect(() => {
    if (!workspaceId) {
      setError('Missing workspace id.');
      return;
    }
    try {
      const raw = sessionStorage.getItem(`studio:${workspaceId}`);
      if (!raw) {
        setError('Workspace not found in session storage.');
        return;
      }
      const parsed = JSON.parse(raw) as {
        id: string;
        name: string;
        description: string;
        layout: unknown;
        mode: 'DRAFT';
        repositoryId?: string | null;
      };
      setWorkspace(parsed);
    } catch {
      setError('Failed to load workspace data.');
    }
  }, [workspaceId]);

  React.useEffect(() => {
    if (!workspace) return undefined;
    setStudioActiveRepositoryId(workspace.repositoryId ?? null);
    return () => {
      setStudioActiveRepositoryId(null);
    };
  }, [workspace]);

  React.useEffect(() => {
    if (!workspace || opening) return;
    setOpening(true);
    try {
      window.dispatchEvent(
        new CustomEvent('ea:studio.open', {
          detail: {
            id: workspace.id,
            name: workspace.name,
            description: workspace.description,
            layout: workspace.layout ?? null,
            repositoryId: workspace.repositoryId ?? undefined,
          },
        }),
      );
    } catch {
      // Best-effort only.
    }
    history.replace('/');
  }, [opening, workspace]);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" showIcon message="Studio workspace error" description={error} />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Text type="secondary">Loading workspace…</Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Typography.Text type="secondary">Opening Studio…</Typography.Text>
    </div>
  );
};

export default StudioRuntimePage;
