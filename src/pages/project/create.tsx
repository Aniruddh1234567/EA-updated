import React from 'react';

import { PageContainer } from '@ant-design/pro-components';
import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';

import { useEaProject } from '@/ea/EaProjectContext';

const CreateEaProjectPage: React.FC = () => {
  const { project, createProject } = useEaProject();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (project) return null;

  const onFinish = async (values: { name: string; description?: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await createProject({
        name: values.name,
        description: values.description ?? '',
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to create repository');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer>
      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Title level={4} style={{ marginBottom: 0 }}>
              Create Enterprise Architecture Repository
            </Typography.Title>
            <Typography.Text type="secondary">
              Create a workspace to start building your repository.
            </Typography.Text>
          </div>

          {error ? <Alert type="error" message={error} showIcon /> : null}

          <Form layout="vertical" onFinish={onFinish} requiredMark="optional">
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: 'Name is required' }]}
            >
              <Input placeholder="Enterprise Architecture" />
            </Form.Item>

            <Form.Item label="Description" name="description">
              <Input.TextArea placeholder="Optional" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={submitting}>
                Create Repository
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </PageContainer>
  );
};

export default CreateEaProjectPage;
