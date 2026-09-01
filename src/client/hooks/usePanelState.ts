import { useState, useCallback } from 'react';

export interface PanelState {
  showSearch: boolean;
  collapsed: boolean;
  showCycles: boolean;
  showCallChain: boolean;
  showMiniMap: boolean;
  showImport: boolean;
  showLegend: boolean;
  toggleSearch: () => void;
  toggleCollapsed: () => void;
  toggleCycles: () => void;
  toggleCallChain: () => void;
  toggleMiniMap: () => void;
  toggleImport: () => void;
  toggleLegend: () => void;
  setShowSearch: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowImport: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCallChain: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowCycles: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowMiniMap: (v: boolean | ((prev: boolean) => boolean)) => void;
  setShowLegend: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export function usePanelState(): PanelState {
  const [showSearch, setShowSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showCycles, setShowCycles] = useState(false);
  const [showCallChain, setShowCallChain] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  const toggleSearch = useCallback(() => setShowSearch((v) => !v), []);
  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);
  const toggleCycles = useCallback(() => setShowCycles((v) => !v), []);
  const toggleCallChain = useCallback(() => setShowCallChain((v) => !v), []);
  const toggleMiniMap = useCallback(() => setShowMiniMap((v) => !v), []);
  const toggleImport = useCallback(() => setShowImport((v) => !v), []);
  const toggleLegend = useCallback(() => setShowLegend((v) => !v), []);

  return {
    showSearch, collapsed, showCycles, showCallChain, showMiniMap, showImport, showLegend,
    toggleSearch, toggleCollapsed, toggleCycles, toggleCallChain, toggleMiniMap, toggleImport, toggleLegend,
    setShowSearch, setShowImport, setShowCallChain, setShowCycles, setShowMiniMap, setShowLegend,
  };
}