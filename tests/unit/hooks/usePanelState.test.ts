/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelState } from '../../../src/client/hooks/usePanelState.ts';

describe('usePanelState', () => {
  it('initial state has all boolean fields as false', () => {
    const { result } = renderHook(() => usePanelState());

    expect(result.current.showSearch).toBe(false);
    expect(result.current.collapsed).toBe(false);
    expect(result.current.showCycles).toBe(false);
    expect(result.current.cycleIsolation).toBe(false);
    expect(result.current.showCallChain).toBe(false);
    expect(result.current.showImpact).toBe(false);
    expect(result.current.showInheritance).toBe(false);
    expect(result.current.showMiniMap).toBe(false);
    expect(result.current.showImport).toBe(false);
    expect(result.current.showLegend).toBe(false);
    expect(result.current.showPathFind).toBe(false);
    expect(result.current.showHealthScore).toBe(false);
    expect(result.current.showRules).toBe(false);
    expect(result.current.showHotspot).toBe(false);
    expect(result.current.showGodModule).toBe(false);
    expect(result.current.showCoreFunction).toBe(false);
    expect(result.current.showFilterPanel).toBe(false);
  });

  it('toggleSearch flips showSearch from false to true', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleSearch();
    });

    expect(result.current.showSearch).toBe(true);
  });

  it('toggleCollapsed flips collapsed from false to true', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleCollapsed();
    });

    expect(result.current.collapsed).toBe(true);
  });

  it('toggleCycles flips showCycles from false to true', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleCycles();
    });

    expect(result.current.showCycles).toBe(true);
  });

  it('toggleFilterPanel flips showFilterPanel from false to true', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleFilterPanel();
    });

    expect(result.current.showFilterPanel).toBe(true);
  });

  it('multiple toggles correctly flip state back and forth', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleSearch();
    });
    expect(result.current.showSearch).toBe(true);

    act(() => {
      result.current.toggleSearch();
    });
    expect(result.current.showSearch).toBe(false);

    act(() => {
      result.current.toggleSearch();
    });
    expect(result.current.showSearch).toBe(true);
  });

  it('toggleCycleIsolation flips cycleIsolation', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleCycleIsolation();
    });

    expect(result.current.cycleIsolation).toBe(true);
  });

  it('toggleImpact flips showImpact', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleImpact();
    });

    expect(result.current.showImpact).toBe(true);
  });

  it('toggleInheritance flips showInheritance', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleInheritance();
    });

    expect(result.current.showInheritance).toBe(true);
  });

  it('J26: toggleMiniMap flips showMiniMap', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleMiniMap();
    });

    expect(result.current.showMiniMap).toBe(true);
  });

  it('toggleImport flips showImport', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleImport();
    });

    expect(result.current.showImport).toBe(true);
  });

  it('toggleLegend flips showLegend', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleLegend();
    });

    expect(result.current.showLegend).toBe(true);
  });

  it('togglePathFind flips showPathFind', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.togglePathFind();
    });

    expect(result.current.showPathFind).toBe(true);
  });

  it('toggleHealthScore flips showHealthScore', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleHealthScore();
    });

    expect(result.current.showHealthScore).toBe(true);
  });

  it('toggleRules flips showRules', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleRules();
    });

    expect(result.current.showRules).toBe(true);
  });

  it('toggleHotspot flips showHotspot', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleHotspot();
    });

    expect(result.current.showHotspot).toBe(true);
  });

  it('toggleGodModule flips showGodModule', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleGodModule();
    });

    expect(result.current.showGodModule).toBe(true);
  });

  it('toggleCoreFunction flips showCoreFunction', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleCoreFunction();
    });

    expect(result.current.showCoreFunction).toBe(true);
  });

  it('toggleCallChain flips showCallChain', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleCallChain();
    });

    expect(result.current.showCallChain).toBe(true);
  });

  it('setShowSearch sets showSearch with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowSearch(true);
    });

    expect(result.current.showSearch).toBe(true);

    act(() => {
      result.current.setShowSearch(false);
    });

    expect(result.current.showSearch).toBe(false);
  });

  it('setShowSearch supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowSearch(true);
    });

    act(() => {
      result.current.setShowSearch((prev) => !prev);
    });

    expect(result.current.showSearch).toBe(false);
  });

  it('setShowImport sets showImport with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowImport(true);
    });

    expect(result.current.showImport).toBe(true);
  });

  it('setShowImport supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowImport((prev) => !prev);
    });

    expect(result.current.showImport).toBe(true);
  });

  it('setShowCallChain sets showCallChain with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCallChain(true);
    });

    expect(result.current.showCallChain).toBe(true);
  });

  it('setShowCallChain supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCallChain(true);
    });

    act(() => {
      result.current.setShowCallChain((prev) => !prev);
    });

    expect(result.current.showCallChain).toBe(false);
  });

  it('setShowCycles sets showCycles with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCycles(true);
    });

    expect(result.current.showCycles).toBe(true);
  });

  it('setShowCycles supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCycles((prev) => !prev);
    });

    expect(result.current.showCycles).toBe(true);
  });

  it('setShowCycleIsolation sets cycleIsolation with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCycleIsolation(true);
    });

    expect(result.current.cycleIsolation).toBe(true);
  });

  it('setShowCycleIsolation supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCycleIsolation(true);
    });

    act(() => {
      result.current.setShowCycleIsolation((prev) => !prev);
    });

    expect(result.current.cycleIsolation).toBe(false);
  });

  it('setShowImpact sets showImpact with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowImpact(true);
    });

    expect(result.current.showImpact).toBe(true);
  });

  it('setShowImpact supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowImpact((prev) => !prev);
    });

    expect(result.current.showImpact).toBe(true);
  });

  it('setShowInheritance sets showInheritance with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowInheritance(true);
    });

    expect(result.current.showInheritance).toBe(true);
  });

  it('setShowInheritance supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowInheritance((prev) => !prev);
    });

    expect(result.current.showInheritance).toBe(true);
  });

  it('setShowMiniMap sets showMiniMap with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowMiniMap(true);
    });

    expect(result.current.showMiniMap).toBe(true);
  });

  it('setShowMiniMap supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowMiniMap((prev) => !prev);
    });

    expect(result.current.showMiniMap).toBe(true);
  });

  it('setShowLegend sets showLegend with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowLegend(true);
    });

    expect(result.current.showLegend).toBe(true);
  });

  it('setShowLegend supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowLegend((prev) => !prev);
    });

    expect(result.current.showLegend).toBe(true);
  });

  it('setShowPathFind sets showPathFind with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowPathFind(true);
    });

    expect(result.current.showPathFind).toBe(true);
  });

  it('setShowPathFind supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowPathFind((prev) => !prev);
    });

    expect(result.current.showPathFind).toBe(true);
  });

  it('setShowHealthScore sets showHealthScore with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowHealthScore(true);
    });

    expect(result.current.showHealthScore).toBe(true);
  });

  it('setShowHealthScore supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowHealthScore((prev) => !prev);
    });

    expect(result.current.showHealthScore).toBe(true);
  });

  it('setShowRules sets showRules with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowRules(true);
    });

    expect(result.current.showRules).toBe(true);
  });

  it('setShowRules supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowRules((prev) => !prev);
    });

    expect(result.current.showRules).toBe(true);
  });

  it('setShowHotspot sets showHotspot with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowHotspot(true);
    });

    expect(result.current.showHotspot).toBe(true);
  });

  it('setShowHotspot supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowHotspot((prev) => !prev);
    });

    expect(result.current.showHotspot).toBe(true);
  });

  it('setShowGodModule sets showGodModule with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowGodModule(true);
    });

    expect(result.current.showGodModule).toBe(true);
  });

  it('setShowGodModule supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowGodModule((prev) => !prev);
    });

    expect(result.current.showGodModule).toBe(true);
  });

  it('setShowCoreFunction sets showCoreFunction with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCoreFunction(true);
    });

    expect(result.current.showCoreFunction).toBe(true);
  });

  it('setShowCoreFunction supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowCoreFunction((prev) => !prev);
    });

    expect(result.current.showCoreFunction).toBe(true);
  });

  it('setShowFilterPanel sets showFilterPanel with direct boolean value', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowFilterPanel(true);
    });

    expect(result.current.showFilterPanel).toBe(true);
  });

  it('setShowFilterPanel supports function-style update', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowFilterPanel((prev) => !prev);
    });

    expect(result.current.showFilterPanel).toBe(true);
  });

  it('toPanelControls returns object with 16 boolean visibility fields all false initially', () => {
    const { result } = renderHook(() => usePanelState());
    const controls = result.current.toPanelControls;

    expect(controls.showSearch).toBe(false);
    expect(controls.showCycles).toBe(false);
    expect(controls.cycleIsolation).toBe(false);
    expect(controls.showCallChain).toBe(false);
    expect(controls.showImpact).toBe(false);
    expect(controls.showInheritance).toBe(false);
    expect(controls.showMiniMap).toBe(false);
    expect(controls.showImport).toBe(false);
    expect(controls.showLegend).toBe(false);
    expect(controls.showPathFind).toBe(false);
    expect(controls.showHealthScore).toBe(false);
    expect(controls.showRules).toBe(false);
    expect(controls.showHotspot).toBe(false);
    expect(controls.showGodModule).toBe(false);
    expect(controls.showCoreFunction).toBe(false);
    expect(controls.showFilterPanel).toBe(false);
  });

  it('toPanelControls returns object with 16 onToggle callback functions', () => {
    const { result } = renderHook(() => usePanelState());
    const controls = result.current.toPanelControls;

    expect(typeof controls.onToggleSearch).toBe('function');
    expect(typeof controls.onToggleCallChain).toBe('function');
    expect(typeof controls.onToggleCycles).toBe('function');
    expect(typeof controls.onToggleCycleIsolation).toBe('function');
    expect(typeof controls.onToggleImpact).toBe('function');
    expect(typeof controls.onToggleInheritance).toBe('function');
    expect(typeof controls.onToggleMiniMap).toBe('function');
    expect(typeof controls.onToggleLegend).toBe('function');
    expect(typeof controls.onToggleImport).toBe('function');
    expect(typeof controls.onTogglePathFind).toBe('function');
    expect(typeof controls.onToggleHealthScore).toBe('function');
    expect(typeof controls.onToggleRules).toBe('function');
    expect(typeof controls.onToggleHotspot).toBe('function');
    expect(typeof controls.onToggleGodModule).toBe('function');
    expect(typeof controls.onToggleCoreFunction).toBe('function');
    expect(typeof controls.onToggleFilterPanel).toBe('function');
  });

  it('toPanelControls does not include collapsed field', () => {
    const { result } = renderHook(() => usePanelState());
    const controls = result.current.toPanelControls;

    expect((controls as any).collapsed).toBeUndefined();
  });

  it('toPanelControls onToggle callbacks toggle the corresponding state', () => {
    const { result } = renderHook(() => usePanelState());
    const controls = result.current.toPanelControls;

    act(() => {
      controls.onToggleSearch();
    });

    expect(result.current.showSearch).toBe(true);

    act(() => {
      controls.onToggleFilterPanel();
    });

    expect(result.current.showFilterPanel).toBe(true);
  });

  it('toPanelControls reflects updated state after toggle', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleSearch();
    });

    const controls = result.current.toPanelControls;
    expect(controls.showSearch).toBe(true);
  });

  it('toPanelControls reflects updated state after setShow', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowImport(true);
    });

    const controls = result.current.toPanelControls;
    expect(controls.showImport).toBe(true);
  });

  it('toggling one field does not affect other fields', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.toggleSearch();
    });

    expect(result.current.showSearch).toBe(true);
    expect(result.current.showCycles).toBe(false);
    expect(result.current.collapsed).toBe(false);
    expect(result.current.showFilterPanel).toBe(false);
  });

  it('setShow with function-style update can compute from prev', () => {
    const { result } = renderHook(() => usePanelState());

    act(() => {
      result.current.setShowSearch(true);
    });

    act(() => {
      result.current.setShowSearch((prev) => prev && false);
    });

    expect(result.current.showSearch).toBe(false);
  });
});