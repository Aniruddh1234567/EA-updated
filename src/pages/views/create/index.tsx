import { PageContainer, ProFormSelect, ProFormText, ProFormTextArea, StepsForm } from '@ant-design/pro-components';
import { history, useModel } from '@umijs/max';
import { Button, Card, Divider, Result, Typography } from 'antd';
import React, { useMemo, useState } from 'react';

import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
import type { ViewInstance } from '@/diagram-studio/viewpoints/ViewInstance';
import { message } from '@/ea/eaConsole';

const createViewId = (): string => {
  // Browser-safe unique-enough id for UI-only creation (no persistence).
  // If the backend later requires UUIDs, this can be swapped for a uuid library.
  return `view_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const nowIso = () => new Date().toISOString();

type CreateViewWizardProps = {
  embedded?: boolean;
  navigateOnCreate?: boolean;
  showCreatedPreview?: boolean;
  successMessage?: string;
  onCreated?: (view: ViewInstance) => void;
};

export const CreateViewWizard: React.FC<CreateViewWizardProps> = ({
  embedded = false,
  navigateOnCreate = true,
  showCreatedPreview = true,
  successMessage,
  onCreated,
}) => {
  const { initialState } = useModel('@@initialState');
  const createdBy = initialState?.currentUser?.name || initialState?.currentUser?.userid || 'ui';
  const [createdView, setCreatedView] = useState<ViewInstance | null>(null);

  const layoutOptions = [
    { label: 'Hierarchical', value: 'hierarchical' },
    { label: 'Radial', value: 'radial' },
    { label: 'Grid', value: 'grid' },
  ];

  const defaultLayoutForViewpoint = (viewpointId: string | undefined): 'hierarchical' | 'radial' | 'grid' => {
    const vp = viewpointId ? ViewpointRegistry.get(viewpointId) : null;
    if (!vp) return 'grid';
    if (vp.defaultLayout === 'dagre') return 'hierarchical';
    if (vp.defaultLayout === 'grid') return 'grid';
    return 'grid';
  };

  const viewpointOptions = useMemo(() => {
    return ViewpointRegistry.list().map((vp) => ({
      value: vp.id,
      label: `${vp.name} (${vp.id})`,
    }));
  }, []);

  const content = (
    <Card>
      <Typography.Title level={4}>Create View (Viewpoint-first)</Typography.Title>
      <Typography.Paragraph type="secondary">
        Select a viewpoint; the view is a projection contract only. No repository writes, no inference, no layout
        persistence.
      </Typography.Paragraph>

      <StepsForm
        onFinish={async (values: Record<string, unknown>) => {
          const viewpointId = values?.viewpointId as string | undefined;
          if (!viewpointId) {
            message.error('Please select a viewpoint');
            return false;
          }

          const viewId = createViewId();
          const timestamp = nowIso();

          const layout = (values?.layout as string | undefined) ?? defaultLayoutForViewpoint(viewpointId);

          const view: ViewInstance = {
            id: viewId,
            name: typeof values?.name === 'string' ? values.name : viewpointId,
            description:
              typeof values?.description === 'string'
                ? values.description
                : 'View scoped by viewpoint (entire repository).',
            viewpointId,
            scope: { kind: 'EntireRepository' },
            layoutMetadata: { layout },
            createdAt: timestamp,
            createdBy,
            status: 'DRAFT',
          };

          const saved = ViewStore.save(view);
          setCreatedView(saved);
          onCreated?.(saved);
          message.success(successMessage ?? 'View saved');
          if (navigateOnCreate) {
            history.replace(`/views/${saved.id}`);
          }
          return true;
        }}
        submitter={{
          searchConfig: {
            submitText: 'Create View',
          },
        }}
      >
        <StepsForm.StepForm name="viewpoint" title="Viewpoint" initialValues={{ viewpointId: viewpointOptions[0]?.value }}>
          <ProFormSelect
            name="viewpointId"
            label="Viewpoint"
            options={viewpointOptions}
            rules={[{ required: true }]}
          />

          <Card>
            <Typography.Paragraph type="secondary">
              Viewpoints are strict contracts: only allowed elements/relationships are projected; scope defaults to entire repository; layout metadata starts empty.
            </Typography.Paragraph>
          </Card>
        </StepsForm.StepForm>

        <StepsForm.StepForm name="metadata" title="Name & Description">
          <ProFormText name="name" label="View name" rules={[{ required: true }]} />
          <ProFormTextArea
            name="description"
            label="Description"
            rules={[{ required: true }]}
            fieldProps={{ autoSize: { minRows: 3, maxRows: 6 } }}
          />
          <ProFormSelect
            name="layout"
            label="Layout"
            options={layoutOptions}
            fieldProps={{
              placeholder: 'Choose default layout for this view',
            }}
            extra="Stored with the view; runtime uses this to render diagrams."
          />
        </StepsForm.StepForm>

      </StepsForm>

      {showCreatedPreview && createdView ? (
        <>
          <Divider />
          <Typography.Title level={5}>Created View (not saved)</Typography.Title>
          <pre>{JSON.stringify(createdView, null, 2)}</pre>
        </>
      ) : null}
    </Card>
  );

  if (embedded) return content;
  return <PageContainer>{content}</PageContainer>;
};

const CreateViewWizardPage: React.FC = () => {
  React.useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('ea:studio.view.create'));
    } catch {
      // Best-effort only.
    }
    try {
      history.replace('/workspace');
    } catch {
      // Best-effort only.
    }
  }, []);

  return (
    <Result
      status="info"
      title="Opening in Studio"
      subTitle="Create View is hosted inside Studio."
      extra={
        <Button type="primary" onClick={() => history.replace('/workspace')}>
          Go to Studio
        </Button>
      }
    />
  );
};

export default CreateViewWizardPage;
