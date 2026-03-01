// @ts-nocheck
import { linter } from "@codemirror/lint";
import { tsFacet } from "../index";
/**
 * Binds the TypeScript `lint()` method with TypeScript's
 * semantic and syntactic diagnostics. You can use
 * the `getLints` method for a lower-level interface
 * to the same data.
 */
export function tsLinterWorker({ diagnosticCodesToIgnore, } = {}) {
    return linter(async (view) => {
        const config = view.state.facet(tsFacet);
        return config?.worker
            ? config.worker.getLints({
                path: config.path,
                diagnosticCodesToIgnore: diagnosticCodesToIgnore || [],
            })
            : [];
    });
}
//# sourceMappingURL=tsLinterWorker.map