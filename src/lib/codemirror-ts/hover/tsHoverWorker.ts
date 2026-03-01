// @ts-nocheck
import { hoverTooltip } from "@codemirror/view";
import { tsFacetWorker } from "../index";
import { defaultRenderer } from "./renderTooltip";
/**
 * This binds the CodeMirror `hoverTooltip` method
 * with a code that pulls types and documentation
 * from the TypeScript environment.
 */
export function tsHoverWorker({ renderTooltip = defaultRenderer, } = {}) {
    return hoverTooltip(async (view, pos) => {
        const config = view.state.facet(tsFacetWorker);
        if (!config?.worker)
            return null;
        const hoverData = await config.worker.getHover({
            path: config.path,
            pos,
        });
        if (!hoverData)
            return null;
        return {
            pos: hoverData.start,
            end: hoverData.end,
            create: () => renderTooltip(hoverData, view),
        };
    });
}
//# sourceMappingURL=tsHoverWorker.map