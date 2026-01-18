declare module 'slash2';
declare module '*.css';
declare module '*.less';
declare module '*.scss';
declare module '*.sass';
declare module '*.svg';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';
declare module '*.webm';
declare module 'omit.js';
declare module 'numeral';
declare module 'mockjs';
declare module 'react-fittext';

declare global {
	interface Window {
		eaDesktop?: {
			saveProject: (args: {
				payload: unknown;
				filePath?: string | null;
				saveAs?: boolean;
				suggestedName?: string;
			}) => Promise<{ ok: true; filePath?: string; canceled?: boolean } | { ok: false; error: string }>;
			openProject: () => Promise<
				| { ok: true; filePath?: string; content?: string; canceled?: boolean }
				| { ok: false; error: string }
			>;
			openProjectAtPath: (filePath: string) => Promise<
				| { ok: true; filePath?: string; content?: string }
				| { ok: false; error: string }
			>;
			pickProjectFolder: () => Promise<
				| { ok: true; folderPath?: string; canceled?: boolean }
				| { ok: false; error: string }
			>;
			listManagedRepositories: () => Promise<
				| {
					ok: true;
					items: Array<{
						id: string;
						name: string;
						description?: string;
						createdAt?: string | null;
						updatedAt?: string | null;
						lastOpenedAt?: string | null;
					}>;
				}
				| { ok: false; error: string }
			>;
			loadManagedRepository: (repositoryId: string) => Promise<
				| { ok: true; repositoryId: string; content: string }
				| { ok: false; error: string }
			>;
			saveManagedRepository: (args: { payload: unknown; repositoryId?: string | null }) => Promise<
				| { ok: true; repositoryId: string; name?: string }
				| { ok: false; error: string }
			>;
			exportRepository: (args: { payload: unknown; suggestedName?: string }) => Promise<
				| { ok: true; canceled?: boolean }
				| { ok: false; error: string }
			>;
			consumePendingRepositoryImports: () => Promise<
				| { ok: true; items: Array<{ name: string; content: string }> }
				| { ok: false; error: string }
			>;
			onRepositoryPackageImport: (handler: (payload: { name: string; content: string }) => void) => void;
			importLegacyProjectAtPath: (filePath: string) => Promise<
				| { ok: true; name: string; content: string }
				| { ok: false; error: string }
			>;
			openDevTools: () => Promise<{ ok: true } | { ok: false; error: string }>;
		};
	}
}

export {};
