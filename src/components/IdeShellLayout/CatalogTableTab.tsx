import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { Space, Typography } from 'antd';
import React from 'react';
import styles from './style.module.less';
import type { ObjectType } from '@/pages/dependency-view/utils/eaMetaModel';
import { useEaRepository } from '@/ea/EaRepositoryContext';

export type CatalogKind =
  | 'enterprises'
  | 'capabilities'
  | 'businessServices'
  | 'processes'
  | 'departments'
  | 'applications'
  | 'applicationServices'
  | 'interfaces'
  | 'nodes'
  | 'compute'
  | 'runtime'
  | 'databases'
  | 'infrastructureServices'
  | 'technologies'
  | 'programmes'
  | 'projects'
  | 'principles'
  | 'requirements'
  | 'standards';

export const titleForCatalogKind = (kind: CatalogKind) => {
  switch (kind) {
    case 'enterprises':
      return 'Enterprises';
    case 'capabilities':
      return 'Capabilities';
    case 'businessServices':
      return 'Business Services';
    case 'processes':
      return 'Business Processes';
    case 'departments':
      return 'Departments';
    case 'applications':
      return 'Applications';
    case 'applicationServices':
      return 'Application Services';
    case 'interfaces':
      return 'Interfaces';
    case 'nodes':
      return 'Nodes';
    case 'compute':
      return 'Compute';
    case 'runtime':
      return 'Runtime';
    case 'databases':
      return 'Databases';
    case 'infrastructureServices':
      return 'Infrastructure Services';
    case 'technologies':
      return 'Infrastructure Services';
    case 'programmes':
      return 'Programmes';
    case 'projects':
      return 'Projects';
    case 'principles':
      return 'Principles';
    case 'requirements':
      return 'Requirements';
    case 'standards':
      return 'Standards';
    default:
      return 'Catalog';
  }
};

const objectTypesForCatalog = (kind: CatalogKind): readonly ObjectType[] => {
  switch (kind) {
    case 'enterprises':
      return ['Enterprise'];
    case 'capabilities':
      return ['Capability'];
    case 'businessServices':
      return ['BusinessService'];
    case 'processes':
      return ['BusinessProcess'];
    case 'departments':
      return ['Department'];
    case 'applications':
      return ['Application'];
    case 'applicationServices':
      return ['ApplicationService'];
    case 'interfaces':
      return ['Interface'];
    case 'nodes':
      return ['Node'];
    case 'compute':
      return ['Compute'];
    case 'runtime':
      return ['Runtime'];
    case 'databases':
      return ['Database'];
    case 'infrastructureServices':
      return ['Technology', 'Storage', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'];
    case 'technologies':
      return ['Technology', 'Storage', 'API', 'MessageBroker', 'IntegrationPlatform', 'CloudService'];
    case 'programmes':
      return ['Programme'];
    case 'projects':
      return ['Project'];
    case 'principles':
      return ['Principle'];
    case 'requirements':
      return ['Requirement'];
    case 'standards':
      return ['Standard'];
    default:
      return [];
  }
};

type CatalogRow = {
  id: string;
  name: string;
  description: string;
  elementType: string;
  layer: string;
  lifecycleState: string;
  ownerRole: string;
  ownerName: string;
};

const layerForObjectType = (type: ObjectType): string => {
  if (
    type === 'Enterprise' ||
    type === 'Capability' ||
    type === 'CapabilityCategory' ||
    type === 'SubCapability' ||
    type === 'BusinessService' ||
    type === 'BusinessProcess' ||
    type === 'Department'
  ) {
    return 'Business';
  }
  if (type === 'Application' || type === 'ApplicationService' || type === 'Interface') return 'Application';
  if (
    type === 'Technology' ||
    type === 'Node' ||
    type === 'Compute' ||
    type === 'Runtime' ||
    type === 'Database' ||
    type === 'Storage' ||
    type === 'API' ||
    type === 'MessageBroker' ||
    type === 'IntegrationPlatform' ||
    type === 'CloudService'
  )
    return 'Technology';
  if (type === 'Programme' || type === 'Project') return 'Implementation & Migration';
  if (type === 'Principle' || type === 'Requirement' || type === 'Standard') return 'Governance';
  return 'Unknown';
};

const isSoftDeleted = (attributes: Record<string, unknown> | null | undefined) => Boolean((attributes as any)?._deleted === true);

const toText = (value: unknown): string => (typeof value === 'string' ? value : '');

const baseColumns: ProColumns<CatalogRow>[] = [
  { title: 'ID', dataIndex: 'id', width: 240 },
  { title: 'Name', dataIndex: 'name', width: 260 },
  { title: 'Description', dataIndex: 'description', ellipsis: true, width: 360 },
  { title: 'Element Type', dataIndex: 'elementType', width: 160 },
  { title: 'Layer', dataIndex: 'layer', width: 140 },
  { title: 'Lifecycle', dataIndex: 'lifecycleState', width: 140 },
  { title: 'Owner Role', dataIndex: 'ownerRole', width: 160 },
  { title: 'Owner Name', dataIndex: 'ownerName', width: 180 },
];

const CatalogTableTab: React.FC<{ kind: CatalogKind }> = ({ kind }) => {
  const { eaRepository } = useEaRepository();

  const [loading] = React.useState(false);

  const rows = React.useMemo<CatalogRow[]>(() => {
    if (!eaRepository) return [];
    const allowedTypes = new Set<ObjectType>(objectTypesForCatalog(kind));
    const out: CatalogRow[] = [];

    for (const obj of eaRepository.objects.values()) {
      if (!allowedTypes.has(obj.type)) continue;
      if (isSoftDeleted(obj.attributes)) continue;

      const name = toText(obj.attributes?.name) || obj.id;
      const description = toText(obj.attributes?.description);
      const lifecycleState = toText(obj.attributes?.lifecycleState);
      const ownerRole = toText(obj.attributes?.ownerRole);
      const ownerName = toText(obj.attributes?.ownerName);

      out.push({
        id: obj.id,
        name,
        description,
        elementType: obj.type,
        layer: layerForObjectType(obj.type),
        lifecycleState,
        ownerRole,
        ownerName,
      });
    }

    out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return out;
  }, [eaRepository, kind]);

  const columns = React.useMemo(() => baseColumns, []);

  return (
    <div className={styles.catalogTab}>
      <ProTable
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={loading}
        search={false}
        options={false}
        pagination={false}
        scroll={{ x: 'max-content' }}
        headerTitle={
          <Space size={8}>
            <Typography.Text strong>{titleForCatalogKind(kind)}</Typography.Text>
            <Typography.Text type="secondary">{rows.length} items</Typography.Text>
          </Space>
        }
      />
    </div>
  );
};

export default CatalogTableTab;
