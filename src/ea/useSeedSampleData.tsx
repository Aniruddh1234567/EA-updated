import React from 'react';
import { Alert, List, Modal, Space, Typography } from 'antd';
import { message } from '@/ea/eaConsole';

import { useEaRepository } from '@/ea/EaRepositoryContext';
import { useIdeSelection } from '@/ide/IdeSelectionContext';
import { applySeedPlan, buildSeedPlan, isRepositoryEffectivelyEmpty, type SeedPlan } from './seedSampleData';

const SeedPreview: React.FC<{ plan: SeedPlan; showNonEmptyWarning: boolean }> = ({ plan, showNonEmptyWarning }) => {
  const elementItems = Object.entries(plan.summary.elementsByType);
  const relationshipItems = Object.entries(plan.summary.relationshipsByType);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      {showNonEmptyWarning ? (
        <Alert
          type="warning"
          showIcon
          message="Sample data will be added alongside existing architecture."
          description="No existing elements are modified."
        />
      ) : null}

      <div>
        <Typography.Text strong>
          Elements to create ({plan.summary.totalObjects})
        </Typography.Text>
        {elementItems.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            None (object types may be disallowed by scope or meta-model).
          </Typography.Paragraph>
        ) : (
          <List
            size="small"
            bordered
            dataSource={elementItems}
            renderItem={([type, count]) => (
              <List.Item key={type}>
                <Typography.Text>{type}</Typography.Text>
                <Typography.Text type="secondary">{count}</Typography.Text>
              </List.Item>
            )}
          />
        )}
      </div>

      <div>
        <Typography.Text strong>
          Relationships to create ({plan.summary.totalRelationships})
        </Typography.Text>
        {relationshipItems.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            None (relationship types may be disallowed by framework policy).
          </Typography.Paragraph>
        ) : (
          <List
            size="small"
            bordered
            dataSource={relationshipItems}
            renderItem={([type, count]) => (
              <List.Item key={type}>
                <Typography.Text>{type}</Typography.Text>
                <Typography.Text type="secondary">{count}</Typography.Text>
              </List.Item>
            )}
          />
        )}
      </div>

      {plan.skippedObjectTypes.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="Skipped object types"
          description={plan.skippedObjectTypes.join(', ')}
        />
      ) : null}

      {plan.skippedRelationshipTypes.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="Skipped relationship types"
          description={plan.skippedRelationshipTypes.join(', ')}
        />
      ) : null}

      {plan.warnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Notes"
          description={
            <div>
              {plan.warnings.map((w, idx) => (
                <div key={idx}>{w}</div>
              ))}
            </div>
          }
        />
      ) : null}

      <Typography.Text type="secondary">
        All seeded objects and relationships are flagged with isSampleData = true.
      </Typography.Text>
    </Space>
  );
};

export const useSeedSampleData = () => {
  const { eaRepository, metadata, trySetEaRepository } = useEaRepository();
  const { setSelection } = useIdeSelection();

  const isRepoEmpty = React.useMemo(() => isRepositoryEffectivelyEmpty(eaRepository), [eaRepository]);
  const hasRepository = Boolean(eaRepository && metadata);

  const openSeedSampleDataModal = React.useCallback(() => {
    if (!eaRepository || !metadata) {
      Modal.info({
        title: 'No repository loaded',
        content: 'Create or open a repository before seeding sample data.',
      });
      return;
    }

    const plan = buildSeedPlan({ repository: eaRepository, metadata });
    if (plan.summary.totalObjects === 0) {
      Modal.info({
        title: 'Seeding not available',
        content: 'No seed data can be created for this scope or meta-model configuration.',
      });
      return;
    }

    Modal.confirm({
      title: 'Seed Sample Architecture',
      okText: 'Seed sample data',
      cancelText: 'Cancel',
      width: 720,
      content: <SeedPreview plan={plan} showNonEmptyWarning={!isRepositoryEffectivelyEmpty(eaRepository)} />,
      onOk: () => {
        const applied = applySeedPlan(eaRepository, plan);
        if (!applied.ok) {
          Modal.error({
            title: 'Seeding failed',
            content: applied.errors.join('\n'),
          });
          return Promise.reject();
        }

        const res = trySetEaRepository(applied.nextRepository);
        if (!res.ok) {
          message.error(res.error);
          return Promise.reject();
        }

        setSelection({ kind: 'none', keys: [] });
        message.success('Sample architecture data seeded.');
        return undefined;
      },
    });
  }, [eaRepository, metadata, setSelection, trySetEaRepository]);

  return { openSeedSampleDataModal, isRepoEmpty, hasRepository } as const;
};
