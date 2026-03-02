import * as Comlink from 'comlink';

export function setupMonacoLSP(monaco: any, lspWorker: any, fileName: string) {
  // Disable default TypeScript validation to avoid double-reporting and conflicts
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
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
    provideCompletionItems: async (model: any, position: any, context: any) => {
      const modelPath = model.uri.path;
      const normalizedPath = modelPath.startsWith('/') ? modelPath : '/' + modelPath;

      const offset = model.getOffsetAt(position);
      const result = await lspWorker.instance.getAutocompletion({
        path: normalizedPath,
        context: {
          pos: offset,
          explicit: context.triggerKind === 1 // Invoke
        }
      });

      if (!result) return null;

      return {
        suggestions: result.options.map((opt: any) => {
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
