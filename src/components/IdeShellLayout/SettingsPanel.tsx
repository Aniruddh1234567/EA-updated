import React from 'react';
import { Button, Tag } from 'antd';

import { dispatchIdeCommand } from '@/ide/ideCommands';
import { ENABLE_RBAC } from '@/repository/accessControl';

const SettingsPanel: React.FC = () => {
  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Settings</div>
      <div style={{ opacity: 0.75, marginBottom: 12 }}>
        Workspace-level preferences and layout controls.
      </div>

      {!ENABLE_RBAC ? (
        <Tag color="default" style={{ alignSelf: 'flex-start' }}>
          Single-user mode (RBAC disabled)
        </Tag>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a
          onClick={() => {
            dispatchIdeCommand({ type: 'view.resetLayout' });
            message.success('Layout reset.');
          }}
        >
          Reset layout
        </a>
        <a
          onClick={() => {
            dispatchIdeCommand({ type: 'view.toggleBottomPanel' });
          }}
        >
          Toggle bottom panel
        </a>
        <a
          onClick={() => {
            dispatchIdeCommand({ type: 'view.fullscreen.toggle' });
          }}
        >
          Toggle fullscreen workspace
        </a>
      </div>

      {/* User management UI intentionally omitted (implicit local user). */}
    </div>
  );
};

export default SettingsPanel;
