import { onCleanup, onMount, createEffect, createSignal } from 'solid-js';
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

export default function MonacoEditor(props: MonacoEditorProps) {
  let editorParent: HTMLDivElement | undefined;
  const [editor, setEditor] = createSignal<any>(null);

  onMount(async () => {
    const monaco = await loadMonaco();
    
    if (!editorParent) return;

    // Setup LSP Bridge, which will provide all TS intelligence
    if (props.lspWorker && !lspAdapter) {
      lspAdapter = setupMonacoLSP(monaco, props.lspWorker, props.fileName);
    }

    // Create models for all files to ensure they exist in Monaco's VFS
    if (props.lspWorker) {
      const fsMap = await props.lspWorker.instance.getFsMap();
      for (const [path, content] of fsMap) {
        const normalizedPath = ensureSlash(path);
        const modelUri = monaco.Uri.file(normalizedPath);
        // Create a model if it doesn't exist. This is for cross-file imports & hover.
        if (!monaco.editor.getModel(modelUri)) {
          monaco.editor.createModel(content, getLanguage(path), modelUri);
        }
      }
    }

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
  });

  createEffect(() => {
    const currentEditor = editor();
    const currentFileName = props.fileName;
    const currentCode = props.code;
    const lsp = props.lspWorker;
    
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

        // Trigger diagnostics update
        if (lsp) {
          updateDiagnostics(monaco, lsp, model);
        }
      });
    }
  });

  createEffect(() => {
    const lsp = props.lspWorker;
    const files = props.allFiles;
    const currentFileName = props.fileName;
    
    if (lsp && files.length > 0) {
      loadMonaco().then(async (monaco) => {
        const fsMap = await lsp.instance.getFsMap();
        for (const [path, content] of fsMap) {
          if (!path.startsWith('/node_modules/') && !path.startsWith('/lib/')) {
            if (path !== currentFileName) {
              const modelUri = monaco.Uri.file(ensureSlash(path));
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
