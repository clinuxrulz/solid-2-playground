// @ts-nocheck
import { EditorView } from "@codemirror/view";
import { tsFacet } from "../index";
/**
 * The default setting for the goto handler: this will
 * 'go to' code defined in the same file, and select it.
 * Returns true if it handled this case and the code
 * was in the same file.
 */
export function defaultGotoHandler(currentPath, hoverData, view) {
    const definition = hoverData?.typeDef?.at(0);
    if (definition && currentPath === definition.fileName) {
        const tr = view.state.update({
            selection: {
                anchor: definition.textSpan.start,
                head: definition.textSpan.start + definition.textSpan.length,
            },
        });
        view.dispatch(tr);
        return true;
    }
}
/**
 * Supports 'going to' a variable definition by meta or
 * ctrl-clicking on it.
 *
 * @example
 * tsGotoWorker()
 */
export function tsGoto(opts = { gotoHandler: defaultGotoHandler }) {
    return EditorView.domEventHandlers({
        click: (event, view) => {
            const config = view.state.facet(tsFacet);
            if (!config?.worker || !opts.gotoHandler)
                return false;
            // TODO: maybe this should be _just_ meta?
            // I think ctrl should probably be preserved.
            // Need to check what VS Code does
            if (!(event.metaKey || event.ctrlKey))
                return false;
            const pos = view.posAtCoords({
                x: event.clientX,
                y: event.clientY,
            });
            if (pos === null)
                return;
            config.worker
                .getHover({
                path: config.path,
                pos,
            })
                .then((hoverData) => {
                // In reality, we enforced that opts.gotoHandler
                // is non-nullable earlier, but TypeScript knows
                // that in this callback, that theoretically could
                // have changed.
                if (hoverData && opts.gotoHandler) {
                    opts.gotoHandler(config.path, hoverData, view);
                }
            });
            return true;
        },
    });
}
//# sourceMappingURL=tsGoto.map