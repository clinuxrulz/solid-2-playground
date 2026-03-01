// @ts-nocheck
/**
 * Default, barebones tooltip renderer. Generates
 * structure of a div, containing a series of
 * span elements with the typescript `kind` as
 * classes.
 */
export const defaultRenderer = (info) => {
    const div = document.createElement("div");
    if (info.quickInfo?.displayParts) {
        div.appendChild(renderDisplayParts(info.quickInfo.displayParts));
    }
    return { dom: div };
};
export const renderDisplayParts = (displayParts) => {
    const div = document.createElement("div");
    for (const part of displayParts) {
        const span = div.appendChild(document.createElement("span"));
        span.className = `quick-info-${part.kind}`;
        span.innerText = part.text;
    }
    return div;
};
//# sourceMappingURL=renderTooltip.map