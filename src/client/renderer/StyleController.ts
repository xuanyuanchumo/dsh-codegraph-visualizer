import type { Core } from 'cytoscape';
import type { ThemeType } from './IRenderer.ts';
import { buildStylesheet } from './styles/ThemeStylesheet.ts';

export class StyleController {
  private cy: Core;
  private theme: ThemeType;

  constructor(cy: Core, theme: ThemeType) {
    this.cy = cy;
    this.theme = theme;
  }

  getStylesheet(): cytoscape.StylesheetJson {
    const nodeCount = this.cy.nodes().length;
    return buildStylesheet(this.theme, nodeCount);
  }

  updateTheme(theme: ThemeType): void {
    this.theme = theme;
    this.cy.style().fromJson(this.getStylesheet()).update();
  }

  getTheme(): ThemeType {
    return this.theme;
  }
}