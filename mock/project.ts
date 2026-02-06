import type { Request, Response } from 'express';
import crypto from 'crypto';

import { projectStore } from '../backend/project/ProjectStore';
import type { Project, GovernanceEnforcementMode } from '../backend/project/project';

const normalizeGovernanceMode = (value: unknown): GovernanceEnforcementMode => {
  // CONFIG ONLY: only Advisory is active for now.
  // Accepting other values would imply behavior we are explicitly not implementing yet.
  if (value === 'Advisory') return 'Advisory';
  return 'Advisory';
};

function makeId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyCrypto = crypto as any;
  if (typeof anyCrypto.randomUUID === 'function') return anyCrypto.randomUUID();
  return crypto
    .createHash('sha1')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex');
}

export default {
  'GET /api/project': (_req: Request, res: Response) => {
    res.send({ success: true, data: projectStore.getProject() });
  },

  'POST /api/project': (req: Request, res: Response) => {
    if (projectStore.getProject()) {
      res.status(409).send({ success: false, errorMessage: 'Project already exists' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    const createdAt = new Date().toISOString();
    const name = typeof body.name === 'string' ? body.name : String(body.name ?? '');
    const description = typeof body.description === 'string' ? body.description : String(body.description ?? '');

    const project: Project = {
      id: makeId(),
      name,
      shortCode: '',
      description,

      organizationName: '',
      businessUnitsInScope: [],
      geographyInScope: '',
      architectureLayersInScope: {
        business: true,
        application: true,
        technology: true,
        implementationMigration: true,
        governance: true,
      },

      config: {
        governanceEnforcementMode: normalizeGovernanceMode(
          // Support both top-level and nested config shapes.
          (body as any).governanceEnforcementMode ?? (body as any)?.config?.governanceEnforcementMode,
        ),
      },

      baselineType: 'Current State',
      baselineStartDate: '',

      chiefArchitect: '',
      owningDepartment: '',
      contactEmail: '',

      createdAt,
      createdBy: '',
      status: 'Draft',
    };

    try {
      const created = projectStore.createProject(project);
      res.status(201).send({ success: true, data: created });
    } catch (e: any) {
      res.status(409).send({ success: false, errorMessage: e?.message || 'Project already exists' });
    }
  },
};
