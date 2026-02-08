import React from 'react';
import { Modal } from 'antd';
import { useModel } from '@umijs/max';

import { CreateViewWizard } from '@/pages/views/create';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { ENABLE_RBAC, hasRepositoryPermission, type RepositoryRole } from '@/repository/accessControl';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';

const CreateViewController: React.FC = () => {
  const { initialState } = useModel('@@initialState');
  const { metadata } = useEaRepository();
  const [open, setOpen] = React.useState(false);
  const [modalKey, setModalKey] = React.useState(0);

  const userRole: RepositoryRole = React.useMemo(() => {
    if (!ENABLE_RBAC) return 'Owner';
    const access = initialState?.currentUser?.access;
    if (access === 'admin') return 'Owner';
    if (access === 'architect' || access === 'user') return 'Architect';
    return 'Viewer';
  }, [initialState?.currentUser?.access]);

  const governanceStrict = (metadata as any)?.governanceMode === 'Strict';
  const canEditView = hasRepositoryPermission(userRole, 'editView');
  const viewReadOnly = governanceStrict && !canEditView;

  const generateWorkingViewId = React.useCallback(() => {
    try {
      if (typeof globalThis.crypto?.randomUUID === 'function') return `working-view-${globalThis.crypto.randomUUID()}`;
    } catch {
      // fall through
    }
    return `working-view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }, []);

  React.useEffect(() => {
    const onStudioViewCreate = () => {
      try {
        setModalKey((prev) => prev + 1);
        setOpen(true);
      } catch (err) {
        console.error('[CreateViewController] Failed to open Create View modal.', err);
      }
    };

    window.addEventListener('ea:studio.view.create', onStudioViewCreate as EventListener);
    return () => window.removeEventListener('ea:studio.view.create', onStudioViewCreate as EventListener);
  }, []);

  const handleCreated = React.useCallback(
    (view: ViewInstance) => {
      try {
        const nextId = view.id?.trim() || generateWorkingViewId();
        const draft: ViewInstance = {
          ...view,
          id: nextId,
          status: 'DRAFT',
          layoutMetadata: { ...(view.layoutMetadata ?? {}), workingView: true },
        };
        setOpen(false);
        setModalKey((prev) => prev + 1);
        if (canEditView) {
          try {
            window.dispatchEvent(
              new CustomEvent('ea:studio.view.open', {
                detail: { viewId: draft.id, view: draft, readOnly: viewReadOnly, working: true },
              }),
            );
          } catch (err) {
            console.error('[CreateViewController] Failed to open working view in Studio.', err);
          }
        }
      } catch (err) {
        console.error('[CreateViewController] Failed during Create View completion.', err);
      }
    },
    [canEditView, generateWorkingViewId, viewReadOnly],
  );

  return (
    <Modal
      key={modalKey}
      open={open}
      title="Create View"
      onCancel={() => {
        try {
          setOpen(false);
          setModalKey((prev) => prev + 1);
        } catch (err) {
          console.error('[CreateViewController] Failed to close Create View modal.', err);
        }
      }}
      footer={null}
      destroyOnClose
      width={820}
    >
      <CreateViewWizard
        embedded
        navigateOnCreate={false}
        showCreatedPreview={false}
        successMessage="View created"
        onCreated={handleCreated}
      />
    </Modal>
  );
};

export default CreateViewController;
