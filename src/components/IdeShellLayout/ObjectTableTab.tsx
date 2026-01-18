import React from 'react';
import { Button, Form, Input, Space, Typography, message } from 'antd';
import { useModel } from '@umijs/max';
import { ViewStore } from '@/diagram-studio/view-runtime/ViewStore';
import { ViewpointRegistry } from '@/diagram-studio/viewpoints/ViewpointRegistry';
import { resolveViewScope } from '@/diagram-studio/viewpoints/resolveViewScope';
import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useIdeShell } from './index';

export type ObjectTableTabProps = {
  id: string;
  name: string;
  objectType: string;
  readOnly?: boolean;
};

const ObjectTableTab: React.FC<ObjectTableTabProps> = ({ id, name, objectType, readOnly = false }) => {
  const { initialState } = useModel('@@initialState');
  const { eaRepository, trySetEaRepository, metadata } = useEaRepository();
  const { openPropertiesPanel, openRouteTab } = useIdeShell();
  const [form] = Form.useForm();

  const actor = initialState?.currentUser?.name || initialState?.currentUser?.userid || 'ui';
  const isStrictGovernance = (metadata?.governanceMode ?? 'Advisory') === 'Strict';
  const isReadOnlyMode = (metadata?.governanceMode ?? 'Advisory') === 'Advisory';

  const obj = eaRepository?.objects.get(id) ?? null;
  const attrs = (obj?.attributes ?? {}) as Record<string, unknown>;

  const resolvedName = typeof attrs.name === 'string' && attrs.name.trim() ? String(attrs.name) : name;
  const resolvedDescription = typeof attrs.description === 'string' ? attrs.description : '';

  const relationships = eaRepository?.relationships ?? [];

  const viewsContainingElement = React.useMemo(() => {
    if (!eaRepository) return [] as Array<{ id: string; name: string; viewpointName: string }>;
    const list = ViewStore.list();
    const out: Array<{ id: string; name: string; viewpointName: string }> = [];
    for (const view of list) {
      try {
        const resolution = resolveViewScope({ view, repository: eaRepository });
        const hit = resolution.elements.some((el) => el.id === id);
        if (hit) {
          const vp = ViewpointRegistry.get(view.viewpointId);
          out.push({ id: view.id, name: view.name ?? view.id, viewpointName: vp?.name ?? view.viewpointId });
        }
      } catch {
        // skip invalid views
      }
    }
    return out;
  }, [eaRepository, id]);

  const labelForElement = React.useCallback(
    (elementId: string) => {
      const ref = eaRepository?.objects.get(elementId) ?? null;
      const refAttrs = (ref?.attributes ?? {}) as Record<string, unknown>;
      const refName = typeof refAttrs.name === 'string' && refAttrs.name.trim() ? String(refAttrs.name) : elementId;
      return {
        name: refName,
        type: ref?.type ?? 'Unknown',
      };
    },
    [eaRepository],
  );

  const outgoingRelationships = React.useMemo(
    () =>
      relationships
        .filter((r) => r.fromId === id)
        .map((r) => {
          const target = labelForElement(r.toId);
          return {
            id: r.id ?? `${r.fromId}->${r.toId}->${r.type}`,
            type: r.type,
            targetId: r.toId,
            targetName: target.name,
            targetType: target.type,
          };
        }),
    [id, labelForElement, relationships],
  );

  const incomingRelationships = React.useMemo(
    () =>
      relationships
        .filter((r) => r.toId === id)
        .map((r) => {
          const source = labelForElement(r.fromId);
          return {
            id: r.id ?? `${r.fromId}->${r.toId}->${r.type}`,
            type: r.type,
            sourceId: r.fromId,
            sourceName: source.name,
            sourceType: source.type,
          };
        }),
    [id, labelForElement, relationships],
  );

  React.useEffect(() => {
    form.setFieldsValue({ name: resolvedName, description: resolvedDescription });
  }, [form, resolvedDescription, resolvedName]);

  const persistName = React.useCallback(
    (nextRaw: string) => {
      if (readOnly || isReadOnlyMode) {
        if (!readOnly) message.warning('Read-only mode: rename is disabled.');
        return;
      }
      if (!eaRepository || !obj) {
        message.error('No repository loaded.');
        return;
      }

      const nextName = typeof nextRaw === 'string' ? nextRaw.trim() : '';
      if (isStrictGovernance && !nextName) {
        message.error('Name is required.');
        return;
      }

      const nowIso = new Date().toISOString();
      const next = eaRepository.clone();
      const res = next.updateObjectAttributes(
        id,
        {
          name: nextName,
          lastModifiedAt: nowIso,
          lastModifiedBy: actor,
        },
        'merge',
      );

      if (!res.ok) {
        message.error(res.error);
        return;
      }

      const applied = trySetEaRepository(next);
      if (!applied.ok) return;
    },
      [actor, eaRepository, id, isReadOnlyMode, isStrictGovernance, obj, readOnly, trySetEaRepository],
    );

  const applyEdits = React.useCallback(() => {
    if (readOnly || isReadOnlyMode) {
      if (!readOnly) message.warning('Read-only mode: edits are disabled.');
      return;
    }
    if (!eaRepository || !obj) {
      message.error('No repository loaded.');
      return;
    }

    const values = form.getFieldsValue();
    const nextName = typeof values?.name === 'string' ? values.name.trim() : '';
    const nextDescription = typeof values?.description === 'string' ? values.description : '';

    if (isStrictGovernance && !nextName) {
      message.error('Name is required.');
      return;
    }

    const nowIso = new Date().toISOString();
    const next = eaRepository.clone();
    const res = next.updateObjectAttributes(
      id,
      {
        name: nextName,
        description: nextDescription,
        lastModifiedAt: nowIso,
        lastModifiedBy: actor,
      },
      'merge',
    );

    if (!res.ok) {
      message.error(res.error);
      return;
    }

    const applied = trySetEaRepository(next);
    if (!applied.ok) return;

    message.success('Properties updated.');
  }, [actor, eaRepository, form, id, isReadOnlyMode, isStrictGovernance, obj, readOnly, trySetEaRepository]);

  if (!eaRepository || !obj) {
    return (
      <div style={{ padding: 12 }}>
        <Typography.Text type="secondary">Element not found in repository.</Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ marginBottom: 10 }}>
        <Typography.Text strong>{resolvedName}</Typography.Text>
        <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
          {objectType}
        </Typography.Text>
      </div>

      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Properties
      </Typography.Title>
      <Form form={form} layout="vertical">
        <Form.Item label="Name" name="name" rules={isStrictGovernance ? [{ required: true, whitespace: true }] : []}>
          <Input
            disabled={readOnly || isReadOnlyMode}
            onChange={(e) => {
              if (readOnly || isReadOnlyMode) return;
              form.setFieldsValue({ name: e.target.value });
              persistName(e.target.value);
            }}
          />
        </Form.Item>
        <Form.Item label="Description" name="description">
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} disabled={readOnly || isReadOnlyMode} />
        </Form.Item>
        <Form.Item label="Element Type">
          <Input value={objectType} disabled style={{ color: 'inherit', backgroundColor: '#fafafa' }} />
        </Form.Item>
        <Form.Item label="ID">
          <Input
            value={id}
            disabled
            style={{ color: 'inherit', backgroundColor: '#fafafa', fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>

        {!readOnly && (
          <Space>
            <Button type="primary" onClick={applyEdits}>
              Save
            </Button>
            <Button onClick={() => form.resetFields()}>Reset</Button>
          </Space>
        )}
      </Form>

      <div style={{ marginTop: 24 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Relationships
        </Typography.Title>

        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>Outgoing relationships</Typography.Text>
          {outgoingRelationships.length === 0 ? (
            <div><Typography.Text type="secondary">None</Typography.Text></div>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
              {outgoingRelationships.map((rel) => (
                <li key={rel.id}>
                  <Typography.Text>{rel.type}</Typography.Text>
                  <Typography.Text type="secondary"> → </Typography.Text>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => openPropertiesPanel({ elementId: rel.targetId, elementType: rel.targetType, dock: 'right', readOnly: true })}
                  >
                    {rel.targetName}
                  </Button>
                  <Typography.Text type="secondary"> ({rel.targetType})</Typography.Text>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>Incoming relationships</Typography.Text>
          {incomingRelationships.length === 0 ? (
            <div><Typography.Text type="secondary">None</Typography.Text></div>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
              {incomingRelationships.map((rel) => (
                <li key={rel.id}>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => openPropertiesPanel({ elementId: rel.sourceId, elementType: rel.sourceType, dock: 'right', readOnly: true })}
                  >
                    {rel.sourceName}
                  </Button>
                  <Typography.Text type="secondary"> ({rel.sourceType}) </Typography.Text>
                  <Typography.Text type="secondary">←</Typography.Text>
                  <Typography.Text style={{ marginLeft: 4 }}>{rel.type}</Typography.Text>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Typography.Text strong>View references</Typography.Text>
          {viewsContainingElement.length === 0 ? (
            <div><Typography.Text type="secondary">Not used in saved views.</Typography.Text></div>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
              {viewsContainingElement.map((v) => (
                <li key={v.id}>
                  <Button type="link" size="small" onClick={() => openRouteTab(`/views/${v.id}`)}>
                    {v.name}
                  </Button>
                  <Typography.Text type="secondary"> · {v.viewpointName}</Typography.Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

    </div>
  );
};

export default ObjectTableTab;
