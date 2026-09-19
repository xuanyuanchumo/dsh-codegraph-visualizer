import { useReducer, useCallback } from 'react';
import type { PanelControls } from '../components/Toolbar.tsx';

export interface PanelState {
  showSearch: boolean;
  collapsed: boolean;
  showCycles: boolean;
  cycleIsolation: boolean;
  showCallChain: boolean;
  showImpact: boolean;
  showInheritance: boolean;
  showMiniMap: boolean;
  showImport: boolean;
  showLegend: boolean;
  showPathFind: boolean;
  showHealthScore: boolean;
  showRules: boolean;
  showHotspot: boolean;
  showGodModule: boolean;
  showCoreFunction: boolean;
  showFilterPanel: boolean;
  toggleSearch: () => void;
  toggleCollapsed: () => void;
  toggleCycles: () => void;
  toggleCycleIsolation: () => void;
  toggleCallChain: () => void;
  toggleImpact: () => void;
  toggleInheritance: () => void;
  toggleMiniMap: () => void;
  toggleImport: () => void;
  toggleLegend: () => void;
  togglePathFind: () => void;
  toggleHealthScore: () => void;
  toggleRules: () => void;
  toggleHotspot: () => void;
  toggleGodModule: () => void;
  toggleCoreFunction: () => void;
  toggleFilterPanel: () => void;
  setShowSearch: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowImport: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCallChain: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCycles: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCycleIsolation: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowImpact: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowInheritance: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowMiniMap: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowLegend: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowPathFind: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowHealthScore: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowRules: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowHotspot: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowGodModule: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCoreFunction: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowFilterPanel: (v: boolean | ((prev: boolean) => boolean)) => void;
  toPanelControls: () => PanelControls;
}

type PanelVisibilityKey =
  | 'showSearch' | 'showCycles' | 'cycleIsolation' | 'showCallChain' | 'showImpact'
  | 'showInheritance' | 'showMiniMap' | 'showImport' | 'showLegend'
  | 'showPathFind' | 'showHealthScore' | 'showRules' | 'showHotspot'
  | 'showGodModule' | 'showCoreFunction' | 'showFilterPanel';

interface PanelStateInternal {
  showSearch: boolean;
  collapsed: boolean;
  showCycles: boolean;
  cycleIsolation: boolean;
  showCallChain: boolean;
  showImpact: boolean;
  showInheritance: boolean;
  showMiniMap: boolean;
  showImport: boolean;
  showLegend: boolean;
  showPathFind: boolean;
  showHealthScore: boolean;
  showRules: boolean;
  showHotspot: boolean;
  showGodModule: boolean;
  showCoreFunction: boolean;
  showFilterPanel: boolean;
}

type Action =
  | { type: 'toggle'; key: PanelVisibilityKey | 'collapsed' }
  | { type: 'set'; key: PanelVisibilityKey; value: boolean | ((prev: boolean) => boolean) };

const initialState: PanelStateInternal = {
  showSearch: false,
  collapsed: false,
  showCycles: false,
  cycleIsolation: false,
  showCallChain: false,
  showImpact: false,
  showInheritance: false,
  showMiniMap: false,
  showImport: false,
  showLegend: false,
  showPathFind: false,
  showHealthScore: false,
  showRules: false,
  showHotspot: false,
  showGodModule: false,
  showCoreFunction: false,
  showFilterPanel: false,
};

function reducer(state: PanelStateInternal, action: Action): PanelStateInternal {
  switch (action.type) {
    case 'toggle': {
      const key = action.key;
      return { ...state, [key]: !state[key] };
    }
    case 'set': {
      const key = action.key;
      const prev = state[key];
      const next = typeof action.value === 'function' ? action.value(prev) : action.value;
      return { ...state, [key]: next };
    }
  }
}

export function usePanelState(): PanelState {
  const [state, dispatch] = useReducer(reducer, initialState);

  const makeToggle = useCallback((key: PanelVisibilityKey | 'collapsed') => () => dispatch({ type: 'toggle', key }), []);
  const makeSet = useCallback((key: PanelVisibilityKey) => (v: boolean | ((prev: boolean) => boolean)) => dispatch({ type: 'set', key, value: v }), []);

  const toggleSearch = useCallback(makeToggle('showSearch'), [makeToggle]);
  const toggleCollapsed = useCallback(makeToggle('collapsed'), [makeToggle]);
  const toggleCycles = useCallback(makeToggle('showCycles'), [makeToggle]);
  const toggleCycleIsolation = useCallback(makeToggle('cycleIsolation'), [makeToggle]);
  const toggleCallChain = useCallback(makeToggle('showCallChain'), [makeToggle]);
  const toggleImpact = useCallback(makeToggle('showImpact'), [makeToggle]);
  const toggleInheritance = useCallback(makeToggle('showInheritance'), [makeToggle]);
  const toggleMiniMap = useCallback(makeToggle('showMiniMap'), [makeToggle]);
  const toggleImport = useCallback(makeToggle('showImport'), [makeToggle]);
  const toggleLegend = useCallback(makeToggle('showLegend'), [makeToggle]);
  const togglePathFind = useCallback(makeToggle('showPathFind'), [makeToggle]);
  const toggleHealthScore = useCallback(makeToggle('showHealthScore'), [makeToggle]);
  const toggleRules = useCallback(makeToggle('showRules'), [makeToggle]);
  const toggleHotspot = useCallback(makeToggle('showHotspot'), [makeToggle]);
  const toggleGodModule = useCallback(makeToggle('showGodModule'), [makeToggle]);
  const toggleCoreFunction = useCallback(makeToggle('showCoreFunction'), [makeToggle]);
  const toggleFilterPanel = useCallback(makeToggle('showFilterPanel'), [makeToggle]);

  const setShowSearch = useCallback(makeSet('showSearch'), [makeSet]);
  const setShowImport = useCallback(makeSet('showImport'), [makeSet]);
  const setShowCallChain = useCallback(makeSet('showCallChain'), [makeSet]);
  const setShowCycles = useCallback(makeSet('showCycles'), [makeSet]);
  const setShowCycleIsolation = useCallback(makeSet('cycleIsolation'), [makeSet]);
  const setShowImpact = useCallback(makeSet('showImpact'), [makeSet]);
  const setShowInheritance = useCallback(makeSet('showInheritance'), [makeSet]);
  const setShowMiniMap = useCallback(makeSet('showMiniMap'), [makeSet]);
  const setShowLegend = useCallback(makeSet('showLegend'), [makeSet]);
  const setShowPathFind = useCallback(makeSet('showPathFind'), [makeSet]);
  const setShowHealthScore = useCallback(makeSet('showHealthScore'), [makeSet]);
  const setShowRules = useCallback(makeSet('showRules'), [makeSet]);
  const setShowHotspot = useCallback(makeSet('showHotspot'), [makeSet]);
  const setShowGodModule = useCallback(makeSet('showGodModule'), [makeSet]);
  const setShowCoreFunction = useCallback(makeSet('showCoreFunction'), [makeSet]);
  const setShowFilterPanel = useCallback(makeSet('showFilterPanel'), [makeSet]);

  return {
    ...state,
    toggleSearch, toggleCollapsed, toggleCycles, toggleCycleIsolation, toggleCallChain, toggleImpact, toggleInheritance, toggleMiniMap, toggleImport, toggleLegend,
    togglePathFind, toggleHealthScore, toggleRules, toggleHotspot, toggleGodModule, toggleCoreFunction, toggleFilterPanel,
    setShowSearch, setShowImport, setShowCallChain, setShowCycles, setShowCycleIsolation, setShowImpact, setShowInheritance, setShowMiniMap, setShowLegend,
    setShowPathFind, setShowHealthScore, setShowRules, setShowHotspot, setShowGodModule, setShowCoreFunction, setShowFilterPanel,
    toPanelControls: () => ({
      showSearch: state.showSearch, showCallChain: state.showCallChain, showCycles: state.showCycles,
      cycleIsolation: state.cycleIsolation,
      showImpact: state.showImpact, showInheritance: state.showInheritance, showMiniMap: state.showMiniMap,
      showLegend: state.showLegend, showImport: state.showImport, showPathFind: state.showPathFind,
      showHealthScore: state.showHealthScore, showRules: state.showRules, showHotspot: state.showHotspot,
      showGodModule: state.showGodModule, showCoreFunction: state.showCoreFunction, showFilterPanel: state.showFilterPanel,
      onToggleSearch: toggleSearch, onToggleCallChain: toggleCallChain, onToggleCycles: toggleCycles,
      onToggleCycleIsolation: toggleCycleIsolation,
      onToggleImpact: toggleImpact, onToggleInheritance: toggleInheritance, onToggleMiniMap: toggleMiniMap,
      onToggleLegend: toggleLegend, onToggleImport: toggleImport, onTogglePathFind: togglePathFind,
      onToggleHealthScore: toggleHealthScore, onToggleRules: toggleRules, onToggleHotspot: toggleHotspot,
      onToggleGodModule: toggleGodModule, onToggleCoreFunction: toggleCoreFunction, onToggleFilterPanel: toggleFilterPanel,
    }),
  };
}
