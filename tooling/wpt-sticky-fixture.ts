import { createWptCssFixture } from "./wpt-css-fixture";
import sources from "./wpt-sticky-sources.json";
export const createWptStickyFixture = (root: string) => createWptCssFixture(root, sources);
