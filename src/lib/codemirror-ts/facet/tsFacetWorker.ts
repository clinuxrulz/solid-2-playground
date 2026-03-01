// @ts-nocheck
import { Facet, combineConfig } from "@codemirror/state";
/**
 * Use this facet if you intend to run your TypeScript
 * virtual environment within a web worker.
 *
 * This is how the ts-related extensions are
 * configured: this facet sets the path of the file
 * and the environment to use, and the rest of
 * the extensions, like tsLint and tsAutocomplete,
 * pull those settings automatically from editor state.
 */
export const tsFacetWorker = Facet.define({
    combine(configs) {
        return combineConfig(configs, {});
    },
});
//# sourceMappingURL=tsFacetWorker.map