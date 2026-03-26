import { onCleanup, onMount, createEffect, createSignal, createMemo } from 'solid-js';
import { setupMonacoLSP, updateDiagnostics } from '../lib/monaco-adapter';

// Load monaco from CDN
const MONACO_VERSION = '0.52.2';
const MONACO_URL = `https://esm.sh/monaco-editor@${MONACO_VERSION}`;

interface MonacoEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker?: any;
  allFiles: string[];
  lspReady?: boolean;
  lspTypesVersion?: () => number;
}

declare global {
  interface Window {
    monaco: any;
  }
}

let monacoPromise: Promise<any> | null = null;
let lspAdapter: { dispose: () => void } | null = null;

async function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  
  monacoPromise = (async () => {
    const monaco = await import(/* @vite-ignore */ MONACO_URL);
    return monaco;
  })();
  
  return monacoPromise;
}

function getLanguage(fileName: string): string {
  if (fileName.endsWith('.tsx') || fileName.endsWith('.ts')) return 'typescript';
  if (fileName.endsWith('.json')) return 'json';
  if (fileName.endsWith('.html')) return 'html';
  if (fileName.endsWith('.css')) return 'css';
  return 'javascript';
}

const ensureSlash = (path: string) => path.startsWith('/') ? path : '/' + path;

function debounce<T extends (...args: any[]) => void>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return function(this: any, ...args: Parameters<T>) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

export default function MonacoEditor(props: MonacoEditorProps) {
  let editorParent: HTMLDivElement | undefined;
  const [editor, setEditor] = createSignal<any>(null);
  const [lspInitialized, setLspInitialized] = createSignal(false);

  const syncModelToLsp = async (model: any, lsp: any) => {
    if (!model || !lsp) return;

    const modelPath = model.uri.path;
    const normalizedPath = ensureSlash(modelPath);

    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) {
      return;
    }

    await lsp.instance.updateFile({
      path: normalizedPath,
      code: model.getValue(),
    });
  };

  const initializeEditor = async () => {
    const monaco = await loadMonaco();
    
    if (!editorParent) return;

    const lang = getLanguage(props.fileName);
    const modelUri = monaco.Uri.file(ensureSlash(props.fileName));
    let model = monaco.editor.getModel(modelUri);
    
    if (!model) {
      model = monaco.editor.createModel(props.code, lang, modelUri);
    } else if (model.getValue() !== props.code) {
      model.setValue(props.code);
    }

    const newEditor = monaco.editor.create(editorParent, {
      model: model,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      scrollBeyondLastLine: false,
      tabSize: 2,
      quickSuggestions: true,
    });

    newEditor.onDidChangeModelContent(() => {
      props.onCodeChange(newEditor.getValue());
    });

    setEditor(newEditor);
  };

  const initializeLSP = async () => {
    if (!props.lspReady || !props.lspWorker || lspInitialized()) return;
    
    const monaco = await loadMonaco();
    const lsp = props.lspWorker;
    
    if (!lspAdapter) {
      lspAdapter = setupMonacoLSP(monaco, lsp, props.fileName);
    }

    const fsMap = await lsp.instance.getFsMap();
    for (const [path, content] of fsMap) {
      const normalizedPath = ensureSlash(path);
      const modelUri = monaco.Uri.file(normalizedPath);
      if (!monaco.editor.getModel(modelUri)) {
        monaco.editor.createModel(content, getLanguage(path), modelUri);
      }
    }

    const currentEditor = editor();
    if (currentEditor) {
      const model = currentEditor.getModel();
      if (model) {
        await syncModelToLsp(model, lsp);
        await updateDiagnostics(monaco, lsp, model);
      }
    }

    setLspInitialized(true);
  };

  onMount(async () => {
    await initializeEditor();
  });

  createEffect(() => {
    if (props.lspReady) {
      initializeLSP();
    }
  });

  createEffect(() => {
    const lspTypesVersion = props.lspTypesVersion?.();
    if (lspTypesVersion && lspInitialized()) {
      const lsp = props.lspWorker;
      const currentEditor = editor();
      if (lsp && currentEditor) {
        const model = currentEditor.getModel();
        if (model) {
          loadMonaco().then(monaco => {
            syncModelToLsp(model, lsp).then(() => {
              updateDiagnostics(monaco, lsp, model);
            });
          });
        }
      }
    }
  });

  createEffect(() => {
    const currentEditor = editor();
    const currentFileName = props.fileName;
    const currentCode = props.code;
    const lspReady = props.lspReady;
    
    const debouncedUpdateDiagnostics = createMemo(() => debounce(updateDiagnostics, 300));
    
    if (currentEditor) {
      loadMonaco().then(monaco => {
        const lang = getLanguage(currentFileName);
        const modelUri = monaco.Uri.file(ensureSlash(currentFileName));
        
        let model = monaco.editor.getModel(modelUri);
        if (!model) {
          model = monaco.editor.createModel(currentCode, lang, modelUri);
        } else if (model.getValue() !== currentCode) {
          model.setValue(currentCode);
        }

        if (currentEditor.getModel() !== model) {
          monaco.editor.setModelLanguage(model, lang);
          currentEditor.setModel(model);
        }

        if (lspReady && props.lspWorker) {
          void syncModelToLsp(model, props.lspWorker).then(() => {
            debouncedUpdateDiagnostics()(monaco, props.lspWorker, model);
          });
        }
      });
    }
  });

  createEffect(() => {
    const lsp = props.lspWorker;
    const files = props.allFiles;
    const currentFileName = props.fileName;
    const lspReady = props.lspReady;
    
    if (lspReady && lsp && files.length > 0) {
      loadMonaco().then(async (monaco) => {
        const fsMap = await lsp.instance.getFsMap();
        for (const [path, content] of fsMap) {
          if (!path.startsWith('/node_modules/') && !path.startsWith('/lib/')) {
            const normalizedPath = path.startsWith('/') ? path : '/' + path;
            if (normalizedPath !== '/' + currentFileName) {
              const modelUri = monaco.Uri.file(normalizedPath);
              let model = monaco.editor.getModel(modelUri);
              if (!model) {
                monaco.editor.createModel(content, getLanguage(path), modelUri);
              } else if (model.getValue() !== content) {
                model.setValue(content);
              }
            }
          }
        }
      });
    }
  });

  onCleanup(() => {
    if (lspAdapter) {
      lspAdapter.dispose();
      lspAdapter = null;
    }
    editor()?.dispose();
  });

  return <div ref={editorParent} class="h-full w-full" />;
}
