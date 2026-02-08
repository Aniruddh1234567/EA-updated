const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure Electron can write cache/profile data even in restricted folders.
const userDataDir =
  process.env.ELECTRON_USER_DATA_DIR || path.join(app.getPath('temp'), 'ea-app-profile');
app.setPath('userData', userDataDir);

const managedRepoRoot = () => path.join(app.getPath('userData'), 'ArchitectureStudio', 'repositories');

const sanitizeRepoId = (value) => {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('Invalid repository id.');
  return safe;
};

const ensureManagedRepoRoot = async () => {
  const root = managedRepoRoot();
  await fs.promises.mkdir(root, { recursive: true });
  return root;
};

const repoDirForId = (repoId) => path.join(managedRepoRoot(), sanitizeRepoId(repoId));

const readJsonIfExists = async (filePath) => {
  try {
    const text = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const writeJson = async (filePath, value) => {
  const json = JSON.stringify(value, null, 2);
  await fs.promises.writeFile(filePath, json, 'utf8');
};

const getRepositoryNameFromPayload = (payload) => {
  const metaName = payload?.meta?.repositoryName || payload?.repository?.metadata?.repositoryName;
  return String(metaName || 'Repository').trim() || 'Repository';
};

const buildMetaRecord = (repoId, payload, existingMeta) => {
  const now = new Date().toISOString();
  const name = getRepositoryNameFromPayload(payload);
  const orgName = String(payload?.meta?.organizationName || payload?.repository?.metadata?.organizationName || '').trim();
  const description = orgName ? `${orgName} EA repository` : `Repository: ${name}`;
  return {
    id: repoId,
    name,
    description,
    createdAt: existingMeta?.createdAt || payload?.meta?.createdAt || now,
    updatedAt: now,
    lastOpenedAt: existingMeta?.lastOpenedAt || null,
  };
};

const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;

let mainWindow;
const pendingRepositoryImports = [];

const enqueueRepositoryImport = async (filePath) => {
  try {
    if (!filePath || !filePath.toLowerCase().endsWith('.eaproj')) return;
    const content = await fs.promises.readFile(filePath, 'utf8');
    const name = path.basename(filePath);
    pendingRepositoryImports.push({ name, content });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ea:repositoryPackageImport', { name, content });
    }
  } catch (err) {
    console.error('[EA] Repository import enqueue failed', err);
  }
};

function createWindow() {
  const titleBarOverlay = process.platform === 'win32'
    ? {
        color: '#1e1e1e',
        symbolColor: '#cccccc',
        height: 34,
      }
    : undefined;

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.removeMenu();
  win.loadURL(startUrl);

  mainWindow = win;

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

ipcMain.handle('ea:saveProject', async (_event, args) => {
  try {
    const payload = args?.payload ?? null;
    if (!payload) return { ok: false, error: 'Missing payload.' };

    const saveAs = Boolean(args?.saveAs);
    let targetPath = typeof args?.filePath === 'string' ? args.filePath : '';

    if (!targetPath || saveAs) {
      const suggestedName = typeof args?.suggestedName === 'string' ? args.suggestedName : 'ea-project.eaproj';
      const res = await dialog.showSaveDialog({
        title: 'Save EA Project',
        defaultPath: suggestedName,
        filters: [
          { name: 'EA Project', extensions: ['eaproj'] },
        ],
      });
      if (res.canceled || !res.filePath) return { ok: true, canceled: true };
      targetPath = res.filePath;
    }

    const json = JSON.stringify(payload, null, 2);
    console.log('[EA] Save Project: writing file to', targetPath);
    try {
      await fs.promises.writeFile(targetPath, json, 'utf8');
      try {
        await fs.promises.access(targetPath, fs.constants.F_OK);
      } catch (verifyErr) {
        console.error('[EA] Save Project: file missing after write', targetPath, verifyErr);
        return { ok: false, error: `Save failed: file not found at ${targetPath}` };
      }
      console.log('[EA] Save Project: write success', targetPath);
    } catch (err) {
      console.error('[EA] Save Project: write failed', targetPath, err);
      throw err;
    }
    return { ok: true, filePath: targetPath };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to save project.' };
  }
});

ipcMain.handle('ea:listManagedRepositories', async () => {
  try {
    const root = await ensureManagedRepoRoot();
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const repoId = sanitizeRepoId(entry.name);
      const repoDir = path.join(root, entry.name);
      const meta = await readJsonIfExists(path.join(repoDir, 'meta.json'));
      if (meta?.id && meta?.name) {
        items.push({
          id: String(meta.id),
          name: String(meta.name),
          description: meta.description ? String(meta.description) : undefined,
          createdAt: meta.createdAt ?? null,
          updatedAt: meta.updatedAt ?? null,
          lastOpenedAt: meta.lastOpenedAt ?? null,
        });
      }
    }
    items.sort((a, b) => String(b.lastOpenedAt || b.updatedAt || '').localeCompare(String(a.lastOpenedAt || a.updatedAt || '')));
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to list repositories.' };
  }
});

ipcMain.handle('ea:loadManagedRepository', async (_event, args) => {
  try {
    const repoId = sanitizeRepoId(args?.repositoryId);
    const repoDir = repoDirForId(repoId);
    const content = await fs.promises.readFile(path.join(repoDir, 'repository.json'), 'utf8');
    const existingMeta = await readJsonIfExists(path.join(repoDir, 'meta.json'));
    const nextMeta = {
      ...(existingMeta || {}),
      id: repoId,
      lastOpenedAt: new Date().toISOString(),
    };
    await writeJson(path.join(repoDir, 'meta.json'), nextMeta);
    return { ok: true, repositoryId: repoId, content };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to load repository.' };
  }
});

ipcMain.handle('ea:saveManagedRepository', async (_event, args) => {
  try {
    const payload = args?.payload ?? null;
    if (!payload) return { ok: false, error: 'Missing payload.' };

    const existingId = typeof args?.repositoryId === 'string' ? args.repositoryId : '';
    const repoId = sanitizeRepoId(existingId || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')));
    const root = await ensureManagedRepoRoot();
    const repoDir = path.join(root, repoId);
    await fs.promises.mkdir(repoDir, { recursive: true });

    const metaPath = path.join(repoDir, 'meta.json');
    const existingMeta = await readJsonIfExists(metaPath);
    const meta = buildMetaRecord(repoId, payload, existingMeta);

    await writeJson(path.join(repoDir, 'repository.json'), payload);
    await writeJson(metaPath, meta);

    return { ok: true, repositoryId: repoId, name: meta.name };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to save repository.' };
  }
});

ipcMain.handle('ea:openProject', async () => {
  return {
    ok: false,
    error: 'Repository packages must be imported into the managed repository store. Use Import Repository to create a managed repository.',
  };
});

ipcMain.handle('ea:openProjectAtPath', async (_event, args) => {
  return {
    ok: false,
    error: 'Repository packages must be imported into the managed repository store. Use Import Repository to create a managed repository.',
  };
});

ipcMain.handle('ea:importLegacyProjectAtPath', async (_event, args) => {
  try {
    const filePath = typeof args?.filePath === 'string' ? args.filePath : '';
    if (!filePath) return { ok: false, error: 'Missing legacy project location.' };
    const content = await fs.promises.readFile(filePath, 'utf8');
    const name = path.basename(filePath);
    return { ok: true, name, content };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to import legacy project.' };
  }
});

ipcMain.handle('ea:consumePendingRepositoryImports', async () => {
  const items = pendingRepositoryImports.splice(0, pendingRepositoryImports.length);
  return { ok: true, items };
});

ipcMain.handle('ea:exportRepository', async (_event, args) => {
  try {
    const payload = args?.payload ?? null;
    if (!payload) return { ok: false, error: 'Missing payload.' };

    const suggestedName = typeof args?.suggestedName === 'string' ? args.suggestedName : 'ea-project.eaproj';
    const res = await dialog.showOpenDialog({
      title: 'Export Repository',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (res.canceled || !res.filePaths?.length) return { ok: true, canceled: true };
    const folderPath = res.filePaths[0];
    const fileName = suggestedName.toLowerCase().endsWith('.eaproj') ? suggestedName : `${suggestedName}.eaproj`;
    const targetPath = path.join(folderPath, fileName);

    const json = JSON.stringify(payload, null, 2);
    await fs.promises.writeFile(targetPath, json, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to export repository.' };
  }
});

ipcMain.handle('ea:pickProjectFolder', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: 'Select Project Folder',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (res.canceled || !res.filePaths?.length) return { ok: true, canceled: true };
    return { ok: true, folderPath: res.filePaths[0] };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to select folder.' };
  }
});

ipcMain.handle('ea:openDevTools', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'No active window.' };
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to open dev tools.' };
  }
});

app.whenReady().then(() => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', (_event, argv) => {
    const candidates = (argv || []).filter((arg) => typeof arg === 'string' && arg.toLowerCase().endsWith('.eaproj'));
    for (const p of candidates) {
      void enqueueRepositoryImport(p);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void enqueueRepositoryImport(filePath);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
