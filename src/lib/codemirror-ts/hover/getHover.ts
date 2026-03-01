// @ts-nocheck
export function getHover({ env, path, pos, }) {
    const sourcePos = pos;
    if (sourcePos === null)
        return null;
    try {
        const quickInfo = env.languageService.getQuickInfoAtPosition(path, sourcePos);
        if (!quickInfo)
            return null;
        const start = quickInfo.textSpan.start;
        const typeDef = env.languageService.getTypeDefinitionAtPosition(path, sourcePos) ??
            env.languageService.getDefinitionAtPosition(path, sourcePos);
        return {
            start,
            end: start + quickInfo.textSpan.length,
            typeDef,
            quickInfo,
        };
    }
    catch (e) {
        // biome-ignore lint/suspicious/noConsole: we want to tell users about this
        console.error(e);
        return null;
    }
}
//# sourceMappingURL=getHover.map