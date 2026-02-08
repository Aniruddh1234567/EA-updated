import { Card, Checkbox, Divider, Space, Typography } from 'antd';
import React from 'react';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { OBJECT_TYPE_DEFINITIONS, type ObjectType } from '@/pages/dependency-view/utils/eaMetaModel';
import { getCustomMetaModelConfig } from '@/repository/customFrameworkConfig';
import { message } from '@/ea/eaConsole';

const isSoftDeleted = (attributes: Record<string, unknown> | null | undefined) => Boolean((attributes as any)?._deleted === true);

const CustomMetaModelEditor: React.FC = () => {
  const { eaRepository, metadata, updateRepositoryMetadata } = useEaRepository();

  const customConfig = React.useMemo(
    () => getCustomMetaModelConfig(metadata?.frameworkConfig ?? undefined),
    [metadata?.frameworkConfig],
  );

  const enabledSet = React.useMemo(() => new Set<ObjectType>(customConfig.enabledObjectTypes), [customConfig.enabledObjectTypes]);

  const allTypes = React.useMemo(() => {
    const types = Object.keys(OBJECT_TYPE_DEFINITIONS) as ObjectType[];
    types.sort((a, b) => a.localeCompare(b));
    return types;
  }, []);

  const updateEnabled = React.useCallback(
    (nextEnabled: ObjectType[]) => {
      if (!metadata) return;
      const sorted = [...new Set(nextEnabled)].sort((a, b) => a.localeCompare(b));

      // If disabling types, enforce: live objects must remain within enabled set.
      if (eaRepository) {
        const blocked = new Set<ObjectType>(sorted);
        for (const obj of eaRepository.objects.values()) {
          if (isSoftDeleted(obj.attributes)) continue;
          if (!blocked.has(obj.type)) {
            message.warning(`Cannot disable type "${obj.type}" while live objects exist.`);
            return;
          }
        }
      }

      const res = updateRepositoryMetadata({
        frameworkConfig: {
          ...(metadata.frameworkConfig ?? {}),
          custom: {
            enabledObjectTypes: sorted,
          },
        },
      });

      if (!res.ok) {
        message.warning(res.error);
        return;
      }

      message.success('Custom meta-model updated.');
    },
    [eaRepository, metadata, updateRepositoryMetadata],
  );

  if (!metadata || metadata.referenceFramework !== 'Custom') {
    return (
      <Card size="small">
        <Typography.Text type="secondary">Custom meta-model editor is only available for Custom Reference Framework.</Typography.Text>
      </Card>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Custom Meta-model Editor
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Blank canvas by design. Enable at least one element type to unlock modeling.
      </Typography.Paragraph>

      <Card size="small">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text strong>Enabled element types</Typography.Text>
          <Checkbox.Group
            style={{ width: '100%' }}
            value={[...enabledSet]}
            onChange={(checked) => updateEnabled(checked as ObjectType[])}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {allTypes.map((t) => (
                <Checkbox key={t} value={t}>
                  {t}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>

          <Divider style={{ margin: '12px 0' }} />
          <Typography.Text type="secondary">
            Note: you can’t disable a type that still has live objects.
          </Typography.Text>
        </Space>
      </Card>
    </div>
  );
};

export default CustomMetaModelEditor;
