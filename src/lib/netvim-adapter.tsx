
// @ts-nocheck
/**
 * This is a Net-Vim plugin. It will be transpiled by Net-Vim's internal Babel
 * and injected with the correct 'h' and 'Fragment' functions for TUI rendering.
 */
export default {
  metadata: {
    name: 'shared-lsp-adapter',
    description: 'Bridges the apps shared LSP worker to Net-Vim'
  },
  setup: async (api: any) => {
    // Get the shared worker from the global scope
    const lspWorker = (window as any).__LSP_WORKER__;
    if (!lspWorker) {
      api.log('LSP-Adapter Error: Global __LSP_WORKER__ not found');
      return;
    }
    const worker = lspWorker.instance;
    if (typeof worker.ready === 'function') {
      await worker.ready();
    }

    let lints: any[] = [];
    let debounceTimer: any = null;
    const classificationsMap = new Map<string, any>();

    const getColorForClassification = (type: number) => {
      switch (type) {
        case 1: return '#6a9955'; // comment
        case 3: return '#569cd6'; // keyword
        case 4: return '#b5cea8'; // numericLiteral
        case 6: return '#ce9178'; // stringLiteral
        case 7: return '#d16969'; // regularExpressionLiteral
        case 10: return '#d4d4d4'; // punctuation
        case 11: // className
        case 12: // enumName
        case 13: // interfaceName
        case 14: // moduleName
        case 15: // typeParameterName
        case 16: return '#4ec9b0'; // typeAliasName
        case 2: // identifier
        case 17: // parameterName
        case 22: return '#9cdcfe'; // jsxAttribute
        case 18: return '#608b4e'; // docCommentTagName
        case 19: // jsxOpenTagName
        case 20: // jsxCloseTagName
        case 21: return '#569cd6'; // jsxSelfClosingTagName
        case 24: return '#ce9178'; // jsxAttributeStringLiteralValue
        case 25: return '#b5cea8'; // bigIntLiteral
        default: return '#ffffff';
      }
    };

    const updateClassifications = async (path: string, content: string) => {
      if (!path || !(path.endsWith('.ts') || path.endsWith('.tsx'))) return;
      const absolutePath = path.startsWith('/') ? path : '/' + path;
      try {
        const classifications = await worker.getClassifications(absolutePath, 0, content.length);
        if (classifications) {
          classificationsMap.set(absolutePath, classifications);
          api.rerender();
        }
      } catch (e) {
        api.log('LSP: Error updating classifications: ' + e.message);
      }
    };

    const updateLints = async (path: string) => {
      if (!path) return;
      const absolutePath = path.startsWith('/') ? path : '/' + path;
      try {
        lints = await worker.getLints({ path: absolutePath });
        api.rerender();
      } catch (e) {
        api.log('LSP: Error updating lints: ' + e.message);
      }
    };

    const getLintsForLine = (lineIdx: number) => {
      const buffer = api.getBuffer();
      let lineStart = 0;
      for (let i = 0; i < lineIdx; i++) lineStart += (buffer[i]?.length || 0) + 1;
      const lineEnd = lineStart + (buffer[lineIdx]?.length || 0);
      return lints.filter(l => {
        const lFrom = l.from ?? 0;
        const lTo = l.to ?? lFrom;
        return lFrom <= lineEnd && lTo >= lineStart;
      });
    };

    api.registerCommand('showDiagnostics', () => {
      const cursor = api.getCursor();
      const lineLints = getLintsForLine(cursor.y);
      if (lineLints.length > 0) {
        const messages = lineLints.map((l: any) => l.message).join('\n');
        api.showHover(messages, cursor.x, cursor.y);
        setTimeout(() => api.hideHover(), 5000);
      }
    });

    api.registerCommand('hover', async () => {
      const path = api.getCurrentFilePath();
      if (!path) return;
      const cursor = api.getCursor();
      const bufferLines = api.getBuffer();
      let pos = 0;
      for (let i = 0; i < cursor.y; i++) {
        pos += (bufferLines[i]?.length || 0) + 1;
      }
      pos += cursor.x;
      
      const absolutePath = path.startsWith('/') ? path : '/' + path;
      const hover = await worker.getHover({ path: absolutePath, pos });
      if (hover && hover.quickInfo) {
        const content = hover.quickInfo.displayParts.map((p: any) => p.text).join('');
        api.showHover(content, cursor.x, cursor.y);
        setTimeout(() => api.hideHover(), 3000);
      }
    });

    api.registerGutter({
      name: 'lsp-lint',
      width: 2,
      priority: 50,
      render: ({ lineIndex }: any) => {
        const idx = typeof lineIndex === 'function' ? lineIndex() : lineIndex;
        const lineLints = getLintsForLine(idx);
        const hasError = lineLints.some((l: any) => l.severity === 'error');
        const hasWarning = lineLints.some((l: any) => l.severity === 'warning');

        if (hasError) return <tui-text content=" E" color="#ff0000" />;
        if (hasWarning) return <tui-text content=" W" color="#ffa500" />;
        return <tui-text content="  " />;
      }
    });

    api.registerLineRenderer({
      name: 'lsp-highlighter',
      priority: 10,
      render: ({ lineIndex, lineContent, leftCol, viewportWidth, currentFilePath, visualStart, mode, cursor }: any) => {
        const path = typeof currentFilePath === 'function' ? currentFilePath() : currentFilePath;
        if (!path || !(path.endsWith('.ts') || path.endsWith('.tsx'))) return null;

        const content = typeof lineContent === 'function' ? lineContent() : lineContent;
        const startCol = typeof leftCol === 'function' ? leftCol() : leftCol;
        const width = typeof viewportWidth === 'function' ? viewportWidth() : viewportWidth;
        const idx = typeof lineIndex === 'function' ? lineIndex() : lineIndex;

        const start = typeof visualStart === 'function' ? visualStart() : visualStart;
        const currentMode = typeof mode === 'function' ? mode() : mode;
        const currentCursor = typeof cursor === 'function' ? cursor() : cursor;

        let highlightStart = -1;
        let highlightEnd = -1;

        if (start && currentMode === 'Visual') {
          const minLine = Math.min(start.y, currentCursor.y);
          const maxLine = Math.max(start.y, currentCursor.y);

          if (idx >= minLine && idx <= maxLine) {
            if (minLine === maxLine) {
              highlightStart = Math.min(start.x, currentCursor.x);
              highlightEnd = Math.max(start.x, currentCursor.x) + 1;
            } else if (idx === minLine) {
              highlightStart = (start.y === minLine) ? start.x : currentCursor.x;
              highlightEnd = content.length;
            } else if (idx === maxLine) {
              highlightStart = 0;
              highlightEnd = (start.y === maxLine) ? start.x : currentCursor.x;
              highlightEnd += 1;
            } else {
              highlightStart = 0;
              highlightEnd = content.length;
            }
          }
        }

        const absolutePath = path.startsWith('/') ? path : '/' + path;
        const classifications = classificationsMap.get(absolutePath);
        
        const selectionColor = '#004b72';
        const tokens = [];

        const addToken = (x: number, tokenContent: string, color: string) => {
          for (let i = 0; i < tokenContent.length; i++) {
            const col = x + i;
            // Add startCol to handle horizontal scroll and word wrap
            const logicalCol = startCol + col;
            const isHighlighted = logicalCol >= highlightStart && logicalCol < highlightEnd;
            
            let j = i + 1;
            while (j < tokenContent.length) {
              const nextLogicalCol = startCol + x + j;
              const nextIsHighlighted = nextLogicalCol >= highlightStart && nextLogicalCol < highlightEnd;
              if (nextIsHighlighted !== isHighlighted) break;
              j++;
            }
            
            const part = tokenContent.slice(i, j);
            tokens.push({
              x: col,
              content: part,
              color,
              bg_color: isHighlighted ? selectionColor : undefined
            });
            i = j - 1;
          }
        };

        if (!classifications) {
          addToken(0, content.slice(startCol, startCol + width), '#ffffff');
          return tokens.map(t => <tui-text x={t.x} content={t.content} color={t.color} bg_color={t.bg_color} />);
        }

        const bufferLines = api.getBuffer();
        let lineStartOffset = 0;
        for (let i = 0; i < idx; i++) {
          lineStartOffset += (bufferLines[i]?.length || 0) + 1;
        }
        const lineEndOffset = lineStartOffset + content.length;

        const relevantSpans: any[] = [];
        const { syntactic, semantic } = classifications;

        const addSpans = (spans: number[], isSemantic: boolean) => {
          if (!spans) return;
          for (let i = 0; i < spans.length; i += 3) {
            const startOffset = spans[i];
            const length = spans[i + 1];
            const type = spans[i + 2];
            if (startOffset + length > lineStartOffset && startOffset < lineEndOffset) {
              relevantSpans.push({ start: startOffset, length, type, isSemantic });
            }
          }
        };

        addSpans(syntactic, false);
        addSpans(semantic, true);
        relevantSpans.sort((a, b) => a.start - b.start || b.length - a.length || (a.isSemantic ? -1 : 1));

        let currentPos = lineStartOffset;
        const visibleEndCol = startCol + width;

        for (const span of relevantSpans) {
          if (span.start < currentPos) continue;
          if (span.start > currentPos) {
            const gapStart = Math.max(startCol, currentPos - lineStartOffset);
            const gapEnd = Math.min(visibleEndCol, span.start - lineStartOffset);
            if (gapEnd > gapStart) {
              addToken(gapStart - startCol, content.slice(gapStart, gapEnd), '#ffffff');
            }
          }
          const spanStart = Math.max(startCol, span.start - lineStartOffset);
          const spanEnd = Math.min(visibleEndCol, span.start + span.length - lineStartOffset);
          if (spanEnd > spanStart) {
            addToken(spanStart - startCol, content.slice(spanStart, spanEnd), getColorForClassification(span.type));
          }
          currentPos = span.start + span.length;
        }

        if (currentPos < lineEndOffset) {
          const gapStart = Math.max(startCol, currentPos - lineStartOffset);
          const gapEnd = Math.min(visibleEndCol, content.length);
          if (gapEnd > gapStart) {
            addToken(gapStart - startCol, content.slice(gapStart, gapEnd), '#ffffff');
          }
        }

        return tokens.map(t => <tui-text x={t.x} content={t.content} color={t.color} bg_color={t.bg_color} />);
      }
    });

    // Completion
    let originalCompletions: any[] = [];
    let completionTriggerPos: { x: number, y: number } | null = null;

    const showFilteredCompletions = () => {
      if (!completionTriggerPos) return;
      const cursor = api.getCursor();
      if (cursor.y !== completionTriggerPos.y || cursor.x < completionTriggerPos.x) {
        api.hideCompletions();
        originalCompletions = [];
        completionTriggerPos = null;
        return;
      }
      const line = api.getBuffer()[cursor.y];
      const filterText = line.slice(completionTriggerPos.x, cursor.x).toLowerCase();
      const filtered = originalCompletions.filter(item => item.label.toLowerCase().includes(filterText));

      if (filtered.length > 0) {
        api.showCompletions(filtered.map(f => ({ label: f.label })), (item: any) => {
          const currentBuffer = api.getBuffer();
          const currentLine = currentBuffer[cursor.y];
          const newLine = currentLine.slice(0, completionTriggerPos.x) + item.label + currentLine.slice(cursor.x);
          currentBuffer[cursor.y] = newLine;
          api.setBuffer(currentBuffer);
          api.setCursor(completionTriggerPos.x + item.label.length, cursor.y);
          originalCompletions = [];
          completionTriggerPos = null;
        });
      } else {
        api.hideCompletions();
      }
    };

    const triggerCompletions = async () => {
      if (api.getMode() !== 'Insert') return;
      const cursor = api.getCursor();
      const bufferLines = api.getBuffer();
      const line = bufferLines[cursor.y] || "";
      const path = api.getCurrentFilePath();
      if (!path) return;
      let triggerX = cursor.x;
      if (line[cursor.x - 1] === '.') triggerX = cursor.x;
      else {
        while (triggerX > 0 && /[a-zA-Z0-9_$]/.test(line[triggerX - 1])) triggerX--;
      }
      let pos = 0;
      for (let i = 0; i < cursor.y; i++) pos += (bufferLines[i]?.length || 0) + 1;
      pos += cursor.x;
      const absolutePath = path.startsWith('/') ? path : '/' + path;
      const result = await worker.getAutocompletion({ path: absolutePath, context: { pos, explicit: true } });
      if (result && result.options && result.options.length > 0) {
        originalCompletions = result.options;
        completionTriggerPos = { x: triggerX, y: cursor.y };
        showFilteredCompletions();
      } else {
        api.hideCompletions();
        originalCompletions = [];
        completionTriggerPos = null;
      }
    };

    api.on('BufferLoaded', async (data: any) => {
      if (data.path.endsWith('.ts') || data.path.endsWith('.tsx')) {
        const absolutePath = data.path.startsWith('/') ? data.path : '/' + data.path;
        await worker.updateFile({ path: absolutePath, code: data.content });
        await updateLints(absolutePath);
        await updateClassifications(absolutePath, data.content);
      }
    });

    api.on('KeyDown', async (data: any) => {
      if (data.key === ' ' && data.ctrl) await triggerCompletions();
      if (data.key === 'Escape') {
        originalCompletions = [];
        completionTriggerPos = null;
        api.hideCompletions();
      }
    });

    api.on('TextChanged', async () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const bufferLines = api.getBuffer();
        const path = api.getCurrentFilePath();
        if (path && (path.endsWith('.ts') || path.endsWith('.tsx'))) {
          const absolutePath = path.startsWith('/') ? path : '/' + path;
          await worker.updateFile({ path: absolutePath, code: bufferLines.join('\n') });
          await updateLints(absolutePath);
          await updateClassifications(absolutePath, bufferLines.join('\n'));
          if (api.getMode() === 'Insert') {
            const cursor = api.getCursor();
            const line = bufferLines[cursor.y];
            if (line && line[cursor.x - 1] === '.') await triggerCompletions();
            else if (completionTriggerPos) showFilteredCompletions();
          }
        }
      }, 300);
    });

    const initialPath = api.getCurrentFilePath();
    const initialContent = api.getBuffer().join('\n');
    if (initialPath) {
      const absolutePath = initialPath.startsWith('/') ? initialPath : '/' + initialPath;
      await worker.updateFile({ path: absolutePath, code: initialContent });
      await updateLints(absolutePath);
      await updateClassifications(absolutePath, initialContent);
    }
  }
};
