import React from 'react';

export type IdeSelectionKind =
  | 'none'
  | 'repository'
  | 'repositoryElement'
  | 'metamodel'
  | 'view'
  | 'analysis'
  | 'route'
  | 'workspace';

export type SelectionSource = 'Explorer' | 'Diagram' | 'ImpactAnalysis' | 'Console';

export type IdeSelectionSnapshot = {
  kind: IdeSelectionKind;
  keys: string[];
  /** Active document in the center workspace (route tab or workspace tab). */
  activeDocument: {
    kind: 'route' | 'workspace';
    key: string;
  };
  /** Global active element (single selection across the app). */
  selectedElementId: string | null;
  selectedElementType: string | null;
  selectedSource: SelectionSource | null;
  /** Back-compat (mirrors selected element). */
  activeElementId: string | null;
  activeElementType: string | null;
  activeImpactElementId: string | null;
  activeImpactElementType: string | null;
};

export type IdeSelectionContextValue = {
  selection: IdeSelectionSnapshot;
  setSelection: (next: { kind: IdeSelectionKind; keys: string[] }) => void;
  setActiveDocument: (next: { kind: 'route' | 'workspace'; key: string }) => void;
  setSelectedElement: (next: { id: string; type: string; source?: SelectionSource } | null) => void;
  /** @deprecated use setSelectedElement */
  setActiveElement: (next: { id: string; type: string } | null) => void;
  /** @deprecated use setSelectedElement with source 'ImpactAnalysis' */
  setActiveImpactElement: (next: { id: string; type: string } | null) => void;
};

const IdeSelectionContext = React.createContext<IdeSelectionContextValue | undefined>(undefined);

export const IdeSelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selection, setSelectionState] = React.useState<IdeSelectionSnapshot>(() => ({
    kind: 'none',
    keys: [],
    activeDocument: { kind: 'route', key: '/workspace' },
    selectedElementId: null,
    selectedElementType: null,
    selectedSource: null,
    activeElementId: null,
    activeElementType: null,
    activeImpactElementId: null,
    activeImpactElementType: null,
  }));

  const setSelection = React.useCallback((next: { kind: IdeSelectionKind; keys: string[] }) => {
    setSelectionState((prev) => ({
      ...prev,
      kind: next.kind,
      keys: Array.isArray(next.keys) ? next.keys : [],
    }));
  }, []);

  const setActiveDocument = React.useCallback((next: { kind: 'route' | 'workspace'; key: string }) => {
    setSelectionState((prev) => ({
      ...prev,
      activeDocument: { kind: next.kind, key: next.key },
    }));
  }, []);

  const setSelectedElement = React.useCallback((next: { id: string; type: string; source?: SelectionSource } | null) => {
    setSelectionState((prev) => ({
      ...prev,
      selectedElementId: next ? next.id : null,
      selectedElementType: next ? next.type : null,
      selectedSource: next?.source ?? (next ? 'Explorer' : null),
      activeElementId: next ? next.id : null,
      activeElementType: next ? next.type : null,
      activeImpactElementId: next?.source === 'ImpactAnalysis' && next ? next.id : null,
      activeImpactElementType: next?.source === 'ImpactAnalysis' && next ? next.type : null,
    }));
  }, []);

  const setActiveElement = React.useCallback((next: { id: string; type: string } | null) => {
    setSelectedElement(next ? { ...next, source: 'Explorer' } : null);
  }, [setSelectedElement]);

  const setActiveImpactElement = React.useCallback((next: { id: string; type: string } | null) => {
    setSelectedElement(next ? { ...next, source: 'ImpactAnalysis' } : null);
  }, [setSelectedElement]);

  const value = React.useMemo<IdeSelectionContextValue>(
    () => ({ selection, setSelection, setActiveDocument, setSelectedElement, setActiveElement, setActiveImpactElement }),
    [selection, setSelection, setActiveDocument, setSelectedElement, setActiveElement, setActiveImpactElement],
  );

  return <IdeSelectionContext.Provider value={value}>{children}</IdeSelectionContext.Provider>;
};

export function useIdeSelection(): IdeSelectionContextValue {
  const ctx = React.useContext(IdeSelectionContext);
  if (!ctx) throw new Error('useIdeSelection must be used within IdeSelectionProvider');
  return ctx;
}
