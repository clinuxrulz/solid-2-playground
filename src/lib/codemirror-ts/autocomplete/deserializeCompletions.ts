// @ts-nocheck
import { insertCompletionText, pickedCompletion, } from "@codemirror/autocomplete";
import { defaultAutocompleteRenderer } from "./renderAutocomplete";

export function deserializeCompletions(raw, opts) {
    if (!raw)
        return raw;
    return {
        from: raw.from,
        options: raw.options.map((o) => deserializeCompletion(o, opts)),
    };
}

function deserializeCompletion(raw, opts) {
    const { label, type, hasAction, source, data } = raw;
    
    // We cache the details once fetched
    let detailsPromise = null;
    const getDetails = () => {
        if (!detailsPromise && opts.worker) {
            detailsPromise = opts.worker.getCompletionDetails({
                path: opts.path,
                pos: opts.pos,
                name: label,
                source,
                data
            });
        }
        return detailsPromise;
    };

    return {
        label,
        type,
        apply: (view, completion, from, to) => {
            if (hasAction || source) {
                // For auto-imports, we must fetch details to get code actions
                getDetails().then(details => {
                    if (details?.codeActions) {
                        codeActionToApplyFunction(details.codeActions)(view, completion, from, to);
                    } else {
                        view.dispatch({
                            ...insertCompletionText(view.state, completion.label, from, to),
                            annotations: pickedCompletion.of(completion),
                        });
                    }
                }).catch(() => {
                    view.dispatch({
                        ...insertCompletionText(view.state, completion.label, from, to),
                        annotations: pickedCompletion.of(completion),
                    });
                });
            } else {
                view.dispatch({
                    ...insertCompletionText(view.state, completion.label, from, to),
                    annotations: pickedCompletion.of(completion),
                });
            }
        },
        info: (completion) => {
            const detailsResult = getDetails();
            if (!detailsResult) {
                const renderer = (opts?.renderAutocomplete ?? defaultAutocompleteRenderer)(raw);
                const rendered = typeof renderer === 'function' ? renderer() : renderer;
                return rendered?.dom || rendered;
            }
            return detailsResult.then(details => {
                const renderer = (opts?.renderAutocomplete ?? defaultAutocompleteRenderer)(details || raw);
                const rendered = typeof renderer === 'function' ? renderer() : renderer;
                return rendered?.dom || rendered;
            });
        },
    };
}

/**
 * The default for CodeMirror completions is that when you hit Tab or the other trigger,
 * it will replace the current 'word' (partially-written text) with the label of the completion.
 * TypeScript provides codeActions that let you import new modules when you accept
 * a completion. This checks whether we have any codeActions, and if we do,
 * lets you import them automatically.
 */
export function codeActionToApplyFunction(codeActions) {
    return (view, completion, from, to) => {
        const insTransaction = {
            ...insertCompletionText(view.state, completion.label, from, to),
            annotations: pickedCompletion.of(completion),
        };
        const actionTransactions = [];
        
        for (const action of codeActions) {
            for (const change of action.changes) {
                for (const textChange of change.textChanges) {
                    actionTransactions.push({
                        changes: [
                            {
                                from: textChange.span.start,
                                to: textChange.span.start + textChange.span.length,
                                insert: textChange.newText,
                            },
                        ],
                        annotations: pickedCompletion.of(completion),
                    });
                }
            }
        }
        view.dispatch(...[insTransaction, ...actionTransactions]);
    };
}
