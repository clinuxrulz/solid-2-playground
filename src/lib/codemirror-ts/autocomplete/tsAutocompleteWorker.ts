// @ts-nocheck
import { tsFacetWorker } from "../index";
import { deserializeCompletions } from "./deserializeCompletions";
/**
 * Create a `CompletionSource` that queries
 * the TypeScript environment in a web worker.
 */
export function tsAutocompleteWorker(opts = {}) {
    return async (context) => {
        const config = context.state.facet(tsFacetWorker);
        if (!config?.worker)
            return null;
        const completion = deserializeCompletions(await config.worker.getAutocompletion({
            path: config.path,
            // Reduce this object so that it's serializable.
            context: {
                pos: context.pos,
                explicit: context.explicit,
            },
        }), opts);
        return completion;
    };
}
//# sourceMappingURL=tsAutocompleteWorker.map