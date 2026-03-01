// @ts-nocheck
import { linter } from "@codemirror/lint";
import { tsFacet } from "../facet/tsFacet";
import { getLints } from "./getLints";
import { Annotation } from "@codemirror/state";
/**
 * An annotation that you can send to CodeMirror to cause the code
 * to be re-linted. This could be because you've updated stuff
 * out-of-band in the TypeScript environment.
 *
 * @example
 * view.dispatch({
 *   annotations: [triggerLint.of(true)],
 * });
 */
export const triggerLint = Annotation.define();
/**
 * Binds the TypeScript `lint()` method with TypeScript's
 * semantic and syntactic diagnostics. You can use
 * the `getLints` method for a lower-level interface
 * to the same data.
 */
export function tsLinter({ diagnosticCodesToIgnore, } = {}) {
    return linter(async (view) => {
        const config = view.state.facet(tsFacet);
        return config?.env
            ? getLints({
                ...config,
                diagnosticCodesToIgnore: diagnosticCodesToIgnore || [],
            })
            : [];
    }, {
        needsRefresh: (update) => {
            return update.transactions.some((tr) => tr.annotation(triggerLint));
        },
    });
}
//# sourceMappingURL=tsLinter.map