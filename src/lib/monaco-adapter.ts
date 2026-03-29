import * as Comlink from 'comlink';

const MEMBER_COMPLETION_KINDS = new Set(['property', 'method']);

export function setupMonacoLSP(monaco: any, lspWorker: any, fileName: string) {
  // Disable default TypeScript validation to avoid double-reporting and conflicts
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });

  // Disable Monaco's built-in TS completion provider so suggestions come only
  // from the shared LSP worker instead of being merged with Monaco defaults.
  monaco.languages.typescript.typescriptDefaults.setModeConfiguration({
    completionItems: false,
    diagnostics: true,
    hovers: false,
    documentHighlights: false,
    definitions: false,
    references: false,
    documentSymbols: false,
    rename: false,
    signatureHelp: false,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false,
  });



  const language = 'typescript';

  // Register Hover Provider
  const hoverProvider = monaco.languages.registerHoverProvider(language, {
    provideHover: async (model: any, position: any) => {
      // Only provide hover for the file this adapter was set up for
      const modelPath = model.uri.path;
      const normalizedPath = modelPath.startsWith('/') ? modelPath : '/' + modelPath;
      
      const offset = model.getOffsetAt(position);
      const hover = await lspWorker.instance.getHover({ path: normalizedPath, pos: offset });
      
      if (!hover || !hover.quickInfo) return null;

      const contents = [
        { value: `\`\`\`typescript\n${hover.quickInfo.displayParts.map((p: any) => p.text).join('')}\n\`\`\`` }
      ];

      if (hover.quickInfo.documentation) {
        contents.push({ value: hover.quickInfo.documentation.map((d: any) => d.text).join('') });
      }

      const start = model.getPositionAt(hover.start);
      const end = model.getPositionAt(hover.end);

      return {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        contents: contents
      };
    }
  });

  // Register Completion Provider
  const completionProvider = monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', '"', "'", '/', '@', '<'],
    // High priority to ensure our LSP provider is used
    priority: 'high',
    provideCompletionItems: async (model: any, position: any, context: any) => {
      // Only provide completions when:
      // 1. Explicitly invoked (Ctrl+Space) - triggerKind 1
      // 2. Triggered by a character like '.', '/', '@' 
      const isExplicit = context.triggerKind === 1;
      const hasTriggerChar = context.triggerKind === 2 && context.triggerCharacter;
      const lineContent = model.getLineContent(position.lineNumber);
      const textBefore = lineContent.substring(0, position.column - 1);
      const isCompletionOnDot = textBefore.endsWith('.') || context.triggerCharacter === '.';

      if (!isExplicit && !hasTriggerChar) {
        if (!isCompletionOnDot && !textBefore.endsWith('>') && textBefore.length < 2) {
          return null;
        }
      }

      // Debug: log what's being triggered
      if (context.triggerCharacter === '.') {
        console.log('Dot completion triggered', { 
          offset: model.getOffsetAt(position),
          line: position.lineNumber,
          column: position.column
        });
      }

      try {
        const modelPath = model.uri.path;
        const normalizedPath = modelPath.startsWith('/') ? modelPath : '/' + modelPath;

        const offset = model.getOffsetAt(position);
        
        if (!lspWorker.instance) {
          console.warn('LSP worker not ready');
          return null;
        }
        
        await lspWorker.instance.updateFile({
          path: normalizedPath,
          code: model.getValue(),
        });

        const result = await lspWorker.instance.getAutocompletion({
          path: normalizedPath,
          context: {
            pos: offset,
            explicit: context.triggerKind === 1, // Invoke
            triggerCharacter: context.triggerCharacter
          }
        });


        
        if (!result) return null;
        const memberOptions = isCompletionOnDot
          ? result.options.filter((item: any) => item.type && MEMBER_COMPLETION_KINDS.has(item.type))
          : result.options;
        const optionsToShow = isCompletionOnDot && memberOptions.length > 0 ? memberOptions : result.options;

      return {
        suggestions: optionsToShow.map((opt: any) => {
          let kind = monaco.languages.CompletionItemKind.Variable;
          
          switch (opt.type) {
            case 'class': kind = monaco.languages.CompletionItemKind.Class; break;
            case 'constant': kind = monaco.languages.CompletionItemKind.Constant; break;
            case 'enum': kind = monaco.languages.CompletionItemKind.Enum; break;
            case 'function': kind = monaco.languages.CompletionItemKind.Function; break;
            case 'interface': kind = monaco.languages.CompletionItemKind.Interface; break;
            case 'method': kind = monaco.languages.CompletionItemKind.Method; break;
            case 'namespace': kind = monaco.languages.CompletionItemKind.Module; break;
            case 'property': kind = monaco.languages.CompletionItemKind.Property; break;
            case 'variable': kind = monaco.languages.CompletionItemKind.Variable; break;
            case 'type': kind = monaco.languages.CompletionItemKind.TypeParameter; break;
          }

          const range = {
            startLineNumber: position.lineNumber,
            startColumn: model.getPositionAt(result.from).column,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          };

          return {
            label: opt.label,
            kind: kind,
            insertText: opt.label,
            documentation: opt.documentation?.map((d: any) => d.text).join(''),
            detail: opt.displayParts?.map((p: any) => p.text).join(''),
            range: range
          };
        })
      };
      } catch (error) {
        console.error('Completion error:', error);
        return null;
      }
    }
  });

  return {
    dispose: () => {
      hoverProvider.dispose();
      completionProvider.dispose();
    }
  };
}

export async function updateDiagnostics(monaco: any, lspWorker: any, model: any) {
  if (!model) return;
  
  const modelPath = model.uri.path;
  const normalizedPath = modelPath.startsWith('/') ? modelPath : '/' + modelPath;
  
  const lints = await lspWorker.instance.getLints({ path: normalizedPath });
  const markers = lints.map((lint: any) => {
    const start = model.getPositionAt(lint.from);
    const end = model.getPositionAt(lint.to);
    
    return {
      severity: lint.severity === 'error' ? monaco.MarkerSeverity.Error :
                lint.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                monaco.MarkerSeverity.Info,
      message: lint.message,
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });

  monaco.editor.setModelMarkers(model, 'typescript', markers);
}
