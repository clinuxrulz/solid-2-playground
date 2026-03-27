// @ts-nocheck
import { tsFacet } from "../index";
import { deserializeCompletions } from "./deserializeCompletions";
/**
 * Create a `CompletionSource` that queries
 * the TypeScript environment in a web worker.
 */
export function tsAutocomplete(opts = {}) {
    return async (context) => {
        const config = context.state.facet(tsFacet);
        if (!config?.worker)
            return null;
        const completion = deserializeCompletions(await config.worker.getAutocompletion({
            path: config.path,
            // Reduce this object so that it's serializable.
            context: {
                pos: context.pos,
                explicit: context.explicit,
            },
        }), {
            ...opts,
            worker: config.worker,
            path: config.path,
            pos: context.pos,
        });
        return completion;
    };
}
//# sourceMappingURL=tsAutocomplete.map
