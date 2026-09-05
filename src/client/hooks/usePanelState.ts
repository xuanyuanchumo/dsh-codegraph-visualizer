import { useState, useCallback } from 'react';

export interface PanelState {
  showSearch: boolean;
  collapsed: boolean;
  showCycles: boolean;
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
  toggleSearch: () => void;
  toggleCollapsed: () => void;
  toggleCycles: () => void;
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
  setShowSearch: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowImport: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCallChain: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCycles: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowImpact: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowInheritance: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowMiniMap: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowLegend: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowPathFind: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowHealthScore: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowRules: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowHotspot: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowGodModule: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export function usePanelState(): PanelState {
  const [showSearch, setShowSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showCycles, setShowCycles] = useState(false);
  const [showCallChain, setShowCallChain] = useState(false);
  const [showImpact, setShowImpact] = useState(false);
  const [showInheritance, setShowInheritance] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showPathFind, setShowPathFind] = useState(false);
  const [showHealthScore, setShowHealthScore] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showHotspot, setShowHotspot] = useState(false);
  const [showGodModule, setShowGodModule] = useState(false);

  const toggleSearch = useCallback(() => setShowSearch((v) => !v), []);
  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const toggleCycles = useCallback(() => setShowCycles((v) => !v), []);
  const toggleCallChain = useCallback(() => setShowCallChain((v) => !v), []);
  const toggleImpact = useCallback(() => setShowImpact((v) => !v), []);
  const toggleInheritance = useCallback(() => setShowInheritance((v) => !v), []);
  const toggleMiniMap = useCallback(() => setShowMiniMap((v) => !v), []);
  const toggleImport = useCallback(() => setShowImport((v) => !v), []);
  const toggleLegend = useCallback(() => setShowLegend((v) => !v), []);
  const togglePathFind = useCallback(() => setShowPathFind((v) => !v), []);
  const toggleHealthScore = useCallback(() => setShowHealthScore((v) => !v), []);
  const toggleRules = useCallback(() => setShowRules((v) => !v), []);
  const toggleHotspot = useCallback(() => setShowHotspot((v) => !v), []);
  const toggleGodModule = useCallback(() => setShowGodModule((v) => !v), []);

  return {
    showSearch, collapsed, showCycles, showCallChain, showImpact, showInheritance, showMiniMap, showImport, showLegend,
    showPathFind, showHealthScore, showRules, showHotspot, showGodModule,
    toggleSearch, toggleCollapsed, toggleCycles, toggleCallChain, toggleImpact, toggleInheritance, toggleMiniMap, toggleImport, toggleLegend,
    togglePathFind, toggleHealthScore, toggleRules, toggleHotspot, toggleGodModule,
    setShowSearch, setShowImport, setShowCallChain, setShowCycles, setShowImpact, setShowInheritance, setShowMiniMap, setShowLegend,
    setShowPathFind, setShowHealthScore, setShowRules, setShowHotspot, setShowGodModule,
  };
}
