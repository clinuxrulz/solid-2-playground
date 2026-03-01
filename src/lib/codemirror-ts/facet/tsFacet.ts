// @ts-nocheck
import { Facet } from "@codemirror/state";

/**
 * Use this facet if you intend to run your TypeScript
 * virtual environment within a web worker.
 */
export const tsFacet = Facet.define({
    combine(configs) {
        return configs.length ? configs[configs.length - 1] : null;
    },
});
//# sourceMappingURL=tsFacet.map