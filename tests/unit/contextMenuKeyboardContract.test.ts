/**
 * Source ratchet for the keyboard route to the node context menu (Round 12, J0 finding).
 *
 * The graph canvas is `role="application"`, so assistive technology cannot reach the per-node
 * actions that live in the context menu (focus / isolate / hide / expand / call chain / impact /
 * find path / open source). Shift+F10 and the dedicated menu key are the only keyboard entry
 * points, and they only work while every link of the chain stays wired:
 *
 *   shortcut (usePanelKeyboard) -> handler (GraphPanel) -> node position (IRenderer/CytoscapeRenderer)
 *
 * The pointer route needs its own link, because it runs through a second boundary:
 *
 *   cxttap (InteractionController) -> renderer options (CytoscapeRenderer) -> hook (useGraphRenderer)
 *
 * The dismissal route is a third one, and it is the one that broke for real keys in J0:
 *
 *   Escape (capture) -> ContextMenu handler -> onClose -> GraphPanel state
 *
 * Each link is asserted here, because a silent break in any of them turns the feature into a
 * no-op that no component test would notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const panelKeyboard = readSource('src/client/hooks/usePanelKeyboard.ts');
const graphPanel = readSource('src/client/GraphPanel.tsx');
const iRenderer = readSource('src/client/renderer/IRenderer.ts');
const cytoscapeRenderer = readSource('src/client/renderer/CytoscapeRenderer.ts');
const interactionController = readSource('src/client/renderer/InteractionController.ts');
const useGraphRendererSource = readSource('src/client/hooks/useGraphRenderer.ts');
const keyboardHelp = readSource('src/client/components/KeyboardHelp.tsx');
const zh = readSource('src/client/i18n/dicts/zh.ts');
const en = readSource('src/client/i18n/dicts/en.ts');

describe('keyboard route to the node context menu', () => {
  it('registers Shift+F10 and the menu key on the optional handler', () => {
    expect(panelKeyboard).toContain('onOpenContextMenu?: () => void;');
    expect(panelKeyboard).toContain(
      "useKeyboardShortcut('F10', () => handlersRef.current.onOpenContextMenu?.(), { shift: true, preventDefault: true });",
    );
    expect(panelKeyboard).toContain(
      "useKeyboardShortcut('ContextMenu', () => handlersRef.current.onOpenContextMenu?.(), { preventDefault: true });",
    );
  });

  it('documents both keys in the shortcut list so the help panel can render them', () => {
    expect(panelKeyboard).toContain("{ key: 'F10', descKey: 'shortcut.contextMenu', shift: true, preventDefault: true },");
    expect(panelKeyboard).toContain("{ key: 'ContextMenu', descKey: 'shortcut.contextMenuKey', preventDefault: true },");
    // The help panel renders the shared list, so a new entry is visible without touching it.
    expect(keyboardHelp).toContain('KEYBOARD_SHORTCUTS');
  });

  it('resolves the selected node and its rendered position before opening the menu', () => {
    expect(graphPanel).toContain('onOpenContextMenu: () => {');
    expect(graphPanel).toContain('if (!selectedNodeId) return;');
    expect(graphPanel).toContain('const position = renderer.rendererRef.current?.getNodeRenderedPosition(selectedNodeId);');
    expect(graphPanel).toContain('if (!position) return;');
    expect(graphPanel).toContain('setContextMenu({ nodeId: selectedNodeId, position });');
  });

  it('exposes the position lookup on the renderer interface and implements it with a node guard', () => {
    expect(iRenderer).toContain('getNodeRenderedPosition(nodeId: string): { x: number; y: number } | null;');
    expect(cytoscapeRenderer).toContain('getNodeRenderedPosition(nodeId: string): { x: number; y: number } | null {');
    expect(cytoscapeRenderer).toContain('if (!node || node.empty() || !node.isNode()) return null;');
    expect(cytoscapeRenderer).toContain('return { x: pos.x, y: pos.y };');
  });

  it('does not register the menu on a bare F10', () => {
    // Shift is what distinguishes the menu shortcut from any future bare-F10 binding.
    expect(panelKeyboard).not.toContain("useKeyboardShortcut('F10', () => handlersRef.current.onOpenContextMenu?.(), { preventDefault: true });");
  });

  it('has both dictionary keys in zh and en', () => {
    for (const key of ["'shortcut.contextMenu'", "'shortcut.contextMenuKey'"]) {
      expect(zh).toContain(key);
      expect(en).toContain(key);
    }
  });

  it('keeps the pointer route wired from cxttap all the way to the renderer hook', () => {
    // Regression guard for BUG-R12-01: the renderer snapshots its options once at construction and
    // only forwards onNodeContextTap when the option is present, while InteractionController keeps
    // binding cxttap regardless. Dropping the forwarding line in useGraphRenderer therefore turns
    // right-click into a silent no-op for every real user, and component tests keep passing because
    // they inject the callback by hand.
    expect(interactionController).toContain('this.callbacks.onNodeContextTap?.(node.id(), { x: pos.x, y: pos.y });');
    expect(cytoscapeRenderer).toContain(
      '...(this.options.onNodeContextTap ? { onNodeContextTap: this.options.onNodeContextTap } : {}),',
    );
    expect(useGraphRendererSource).toContain(
      'onNodeContextTap: (nodeId: string, pos: { x: number; y: number }) =>',
    );
    expect(useGraphRendererSource).toContain('callbacksRef.current.onNodeContextTap?.(nodeId, pos),');
    expect(graphPanel).toContain('onNodeContextTap: (nodeId: string, pos: { x: number; y: number }) => setContextMenu({ nodeId, position: pos })');
  });

  it('lets Escape dismiss the menu instead of leaking to the shell (BUG-R12-02)', () => {
    const contextMenu = readSource('src/client/components/ContextMenu.tsx');
    // Capture phase, so a re-render triggered by another document-level Escape handler cannot
    // remove this listener before its turn in the dispatch.
    expect(contextMenu).toContain("document.addEventListener('keydown', handleKeyDown, true);");
    expect(contextMenu).toContain("document.removeEventListener('keydown', handleKeyDown, true);");
    expect(contextMenu).toContain('e.stopPropagation();');
    // The listener identity must not depend on the inline onClose prop, or it is torn down and
    // re-added on every GraphPanel render.
    expect(contextMenu).toContain('const onCloseRef = useRef(props.onClose);');
    // "Close all overlays" has to include the menu itself.
    const closeAllBlock = graphPanel.slice(graphPanel.indexOf('onCloseAll: () => {'), graphPanel.indexOf('onCloseAll: () => {') + 400);
    expect(closeAllBlock).toContain('setContextMenu(null);');
  });

  it('makes the canvas focusable so the menu can hand focus back to the graph', () => {
    const containerTag = graphPanel.slice(graphPanel.indexOf('<div className="cg-graph-container" ref={renderer.containerRef}'), graphPanel.indexOf('<div className="cg-graph-container" ref={renderer.containerRef}') + 200);
    expect(containerTag).toContain('tabIndex={0}');
    expect(graphPanel).toContain('renderer.containerRef.current?.focus();');
  });

  it('keeps panel shortcuts out of the host composer (BUG-R12-04)', () => {
    const keyboardShortcut = readSource('src/client/hooks/useKeyboardShortcut.ts');
    // The DSH composer is a contenteditable div, so an INPUT/TEXTAREA-only guard still let
    // Shift+F10 open the node menu and steal focus while the user was typing.
    expect(keyboardShortcut).toContain('target?.isContentEditable');
    // Escape and '/' stay exempt from the guard: they must still reach the panel.
    expect(keyboardShortcut).toContain("const isEscape = e.key === 'Escape';");
    expect(keyboardShortcut).toContain("const isSlash = e.key === '/';");
  });
});
