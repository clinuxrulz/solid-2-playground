import { onCleanup, onMount, createEffect, createSignal } from 'solid-js';

// Load monaco from CDN
const MONACO_VERSION = '0.52.2';
const MONACO_URL = `https://esm.sh/monaco-editor@${MONACO_VERSION}`;

interface MonacoEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker?: any;
}

declare global {
  interface Window {
    monaco: any;
  }
}

let monacoPromise: Promise<any> | null = null;

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

export default function MonacoEditor(props: MonacoEditorProps) {
  let editorParent: HTMLDivElement | undefined;
  const [editor, setEditor] = createSignal<any>(null);

  onMount(async () => {
    const monaco = await loadMonaco();
    
    if (!editorParent) return;

    const newEditor = monaco.editor.create(editorParent, {
      value: props.code,
      language: getLanguage(props.fileName),
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      scrollBeyondLastLine: false,
      tabSize: 2,
    });

    newEditor.onDidChangeModelContent(() => {
      props.onCodeChange(newEditor.getValue());
    });

    setEditor(newEditor);
  });

  createEffect(() => {
    const currentEditor = editor();
    if (currentEditor && props.code !== currentEditor.getValue()) {
      currentEditor.setValue(props.code);
    }
  });

  createEffect(() => {
    const currentEditor = editor();
    if (currentEditor) {
      const model = currentEditor.getModel();
      if (model) {
        const lang = getLanguage(props.fileName);
        loadMonaco().then(monaco => {
          monaco.editor.setModelLanguage(model, lang);
        });
      }
    }
  });

  onCleanup(() => {
    editor()?.dispose();
  });

  return <div ref={editorParent} class="h-full w-full" />;
}
