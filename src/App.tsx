import { createSignal, onMount, createEffect, onCleanup, For, Show } from 'solid-js';
import Resizable from '@corvu/resizable';
import Editor from './components/Editor';
import Preview from './components/Preview';
import { readFile, writeFile, listFiles, deleteFile } from './lib/opfs';
import * as Comlink from 'comlink';

const DEFAULT_IMPORT_MAP = {
  "imports": {
    "solid-js": "https://esm.sh/solid-js@2.0.0-experimental.15",
    "solid-js/web": "https://esm.sh/@solidjs/web@2.0.0-experimental.15"
  }
};

const DEFAULT_FILES = {
  'main.tsx': `import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <button onClick={() => setCount(count() + 1)}>
      Count: {count()}
    </button>
  );
}

render(() => <App />, document.getElementById('root'));
`,
  'utils.ts': `export const greet = (name: string) => \`Hello, \${name}!\`;`
};

export default function App() {
  const [files, setFiles] = createSignal<string[]>([]);
  const [activeFile, setActiveFile] = createSignal('main.tsx');
  const [code, setCode] = createSignal('');
  const [compiledCode, setCompiledCode] = createSignal('');
  const [isCompiling, setIsCompiling] = createSignal(false);
  const [activeView, setActiveView] = createSignal<'code' | 'preview'>('code');
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [importMap, setImportMap] = createSignal(JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
  const [lspWorker, setLspWorker] = createSignal<any>(null);

  let compilerWorker: Worker | undefined;
  let lspWorkerInstance: Worker | undefined;

  onMount(async () => {
    // Initialize compiler worker
    compilerWorker = new Worker(new URL('./workers/compiler.ts', import.meta.url), {
      type: 'module',
    });

    compilerWorker.onmessage = (e) => {
      setIsCompiling(false);
      if (e.data.code) {
        setCompiledCode(e.data.code);
      } else if (e.data.error) {
        console.error('Compilation Error:', e.data.error);
      }
    };

    // Initialize LSP worker
    console.log("Starting LSP worker...");
    lspWorkerInstance = new Worker(new URL('./workers/lsp.worker.ts', import.meta.url), {
      type: 'module',
    });
    const worker = Comlink.wrap<any>(lspWorkerInstance);
    console.log("LSP worker wrapped, initializing...");
    await worker.initialize();
    console.log("LSP worker initialized, setting signal.");
    setLspWorker({ instance: worker });

    // Load initial files or create them if empty
    const existingFiles = await listFiles();
    if (existingFiles.length === 0) {
      for (const [name, content] of Object.entries(DEFAULT_FILES)) {
        await writeFile(name, content);
        await worker.updateFile({ path: name, code: content });
      }
      await writeFile('import-map.json', JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
      setFiles(Object.keys(DEFAULT_FILES));
      setActiveFile('main.tsx');
    } else {
      setFiles(existingFiles.filter(f => f !== 'import-map.json'));
      // Sync all existing files to LSP worker
      for (const file of existingFiles) {
        if (file !== 'import-map.json') {
          const content = await readFile(file);
          if (content !== null) {
            await worker.updateFile({ path: file, code: content });
          }
        }
      }

      if (!existingFiles.includes(activeFile())) {
        const firstFile = existingFiles.find(f => f !== 'import-map.json');
        setActiveFile(firstFile || 'main.tsx');
      }
      const savedImportMap = await readFile('import-map.json');
      if (savedImportMap) {
        setImportMap(savedImportMap);
      } else {
        await writeFile('import-map.json', JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
      }
    }

    // Load active file
    if (activeFile()) {
      const savedCode = await readFile(activeFile());
      if (savedCode !== null) {
        setCode(savedCode);
      }
    }
  });

  onCleanup(() => {
    compilerWorker?.terminate();
    lspWorkerInstance?.terminate();
  });

  // Debounced compilation and LSP sync
  let debounceTimeout: any;
  createEffect(() => {
    const currentCode = code();
    const fileName = activeFile();
    const currentFiles = files();
    const worker = lspWorker()?.instance;
    
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
      if (fileName === 'import-map.json') {
        try {
          JSON.parse(currentCode);
          setImportMap(currentCode);
          writeFile(fileName, currentCode);
        } catch (e) {
          writeFile(fileName, currentCode);
        }
        return;
      }

      if (fileName && currentFiles.includes(fileName)) {
        if (compilerWorker && (fileName.endsWith('.tsx') || fileName.endsWith('.ts'))) {
          setIsCompiling(true);
          compilerWorker.postMessage({ code: currentCode, fileName: fileName });
        }
        
        // Sync to LSP worker
        if (worker && (fileName.endsWith('.tsx') || fileName.endsWith('.ts'))) {
          await worker.updateFile({ path: fileName, code: currentCode });
        }

        // Save to OPFS
        writeFile(fileName, currentCode);
      }
    }, 500);
  });

  const handleFileSwitch = async (name: string, saveCurrent = true) => {
    // Save current file first
    if (saveCurrent && activeFile() && (files().includes(activeFile()) || activeFile() === 'import-map.json')) {
      await writeFile(activeFile(), code());
      const worker = lspWorker()?.instance;
      if (worker && (activeFile().endsWith('.tsx') || activeFile().endsWith('.ts'))) {
        await worker.updateFile({ path: activeFile(), code: code() });
      }
    }
    
    // Load new file
    const content = await readFile(name);
    if (content !== null) {
      setActiveFile(name);
      setCode(content);
    }
  };

  const createNewFile = async () => {
    const name = prompt('File name:');
    if (name && !files().includes(name) && name !== 'import-map.json') {
      await writeFile(name, '');
      const worker = lspWorker()?.instance;
      if (worker && (name.endsWith('.tsx') || name.endsWith('.ts'))) {
        await worker.updateFile({ path: name, code: '' });
      }
      setFiles([...files(), name]);
      handleFileSwitch(name);
    }
  };

  const handleDeleteFile = async (name: string, e: Event) => {
    e.stopPropagation();
    if (confirm(`Delete ${name}?`)) {
      const isDeletingActive = activeFile() === name;
      const newFiles = files().filter(f => f !== name);
      
      if (isDeletingActive) {
        if (newFiles.length > 0) {
          await handleFileSwitch(newFiles[0], false);
        } else {
          setActiveFile('');
          setCode('');
        }
      }
      
      await deleteFile(name);
      const worker = lspWorker()?.instance;
      if (worker && (name.endsWith('.tsx') || name.endsWith('.ts'))) {
        await worker.deleteFile(name);
      }
      setFiles(newFiles);
    }
  };

  return (
    <div class="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] font-sans overflow-hidden">
      {/* Top Bar */}
      <header class="flex items-center justify-between h-12 px-4 border-b border-[#333333] bg-[#252526] shrink-0">
        <div class="flex items-center space-x-3 overflow-hidden">
          <div class="flex items-center space-x-2 shrink-0">
            <svg class="w-5 h-5 text-[#76b3e1]" viewBox="0 0 166 155" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M163 35L15 137C11.6667 139 3.4 141.4 1 133L1 5C1 1.66667 3.4 1 11 1L155 1C158.333 1 163 3.4 163 11V35Z" fill="currentColor"/>
            </svg>
            <h1 class="text-[13px] font-bold tracking-tight text-[#f3f3f3] hidden sm:block">SOLID 2.0 PLAYGROUND</h1>
          </div>
          <nav class="flex space-x-3 text-[12px] overflow-hidden whitespace-nowrap">
            <button class="hover:text-white shrink-0">Share</button>
            <button class="hover:text-white shrink-0">Export</button>
          </nav>
        </div>
        
        <div class="flex items-center space-x-2">
          {/* Mobile View Toggle */}
          <div class="flex md:hidden bg-[#333333] rounded p-0.5">
            <button 
              onClick={() => setActiveView('code')}
              class={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${activeView() === 'code' ? 'bg-[#007acc] text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Code
            </button>
            <button 
              onClick={() => setActiveView('preview')}
              class={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${activeView() === 'preview' ? 'bg-[#007acc] text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Preview
            </button>
          </div>

          <div class="hidden sm:flex items-center space-x-2">
            <Show when={isCompiling()}>
              <span class="text-[11px] text-yellow-500">Compiling...</span>
            </Show>
            <div class="px-2 py-0.5 rounded bg-[#333333] text-[11px] text-gray-400">
              Solid 2.0
            </div>
          </div>
        </div>
      </header>

      {/* File Tabs */}
      <div class="flex items-center h-9 bg-[#252526] border-b border-[#333333] overflow-hidden shrink-0">
        <div class="flex-1 flex overflow-x-auto no-scrollbar items-center h-full">
          <For each={files()}>
            {(file) => (
              <div
                onClick={() => handleFileSwitch(file)}
                class={`group flex items-center h-full px-3 text-[12px] cursor-pointer border-r border-[#333333] whitespace-nowrap transition-colors ${activeFile() === file ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]' : 'text-gray-500 hover:bg-[#2a2d2e]'}`}
              >
                <span>{file}</span>
                <button
                  onClick={(e) => handleDeleteFile(file, e)}
                  class="ml-2 opacity-0 group-hover:opacity-100 hover:text-red-400 text-sm"
                >
                  ×
                </button>
              </div>
            )}
          </For>
          {/* Import Map Tab */}
          <div
            onClick={() => handleFileSwitch('import-map.json')}
            class={`group flex items-center h-full px-3 text-[12px] cursor-pointer border-r border-[#333333] whitespace-nowrap transition-colors ${activeFile() === 'import-map.json' ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]' : 'text-[#76b3e1] opacity-70 hover:opacity-100 hover:bg-[#2a2d2e]'}`}
          >
            <span class="flex items-center">
              <svg class="w-3 h-3 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 9l5 5 5-5M12 3v11" />
              </svg>
              Import Map
            </span>
          </div>
        </div>
        <div class="flex items-center px-2 space-x-2 border-l border-[#333333] h-full bg-[#252526]">
          <button 
            onClick={createNewFile} 
            class="p-1 hover:text-white text-gray-500 text-lg transition-colors"
            title="New File"
          >+</button>
          <button 
            onClick={async () => {
              if (confirm('Reset to defaults?')) {
                const allFiles = await listFiles();
                for (const f of allFiles) await deleteFile(f);
                for (const [name, content] of Object.entries(DEFAULT_FILES)) {
                  await writeFile(name, content);
                  const worker = lspWorker()?.instance;
                  if (worker && (name.endsWith('.tsx') || name.endsWith('.ts'))) {
                    await worker.updateFile({ path: name, code: content });
                  }
                }
                await writeFile('import-map.json', JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
                setFiles(Object.keys(DEFAULT_FILES));
                await handleFileSwitch('main.tsx', false);
                setImportMap(JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
              }
            }}
            class="text-[11px] text-gray-500 hover:text-red-400 transition-colors px-1"
          >
            Reset
          </button>
        </div>
      </div>

      <Resizable class="flex-1 flex overflow-hidden">
        {/* Editor Panel */}
        <Resizable.Panel 
          initialSize={0.5} 
          minSize={0.2}
          class={`flex-1 flex-col bg-[#1e1e1e] ${activeView() === 'code' ? 'flex' : 'hidden md:flex'}`}
        >
          <div class="flex-1 overflow-hidden relative flex flex-col">
            <Show when={activeFile()} fallback={<div class="p-4 text-gray-500 flex-1 flex items-center justify-center">Select a file</div>}>
              <Editor
                code={code()}
                onCodeChange={setCode}
                fileName={activeFile()}
                lspWorker={lspWorker()}
              />
            </Show>
            {/* Mobile Compiling Indicator */}
            <Show when={isCompiling()}>
              <div class="md:hidden absolute bottom-4 right-4 bg-[#007acc] text-white px-2 py-1 rounded text-[10px] shadow-lg">
                Compiling...
              </div>
            </Show>
          </div>
        </Resizable.Panel>

        {/* Resizer Handle */}
        <Resizable.Handle 
          class="hidden md:flex w-1 bg-[#333333] hover:bg-[#007acc] transition-colors cursor-col-resize shrink-0 h-full items-center justify-center group z-10"
          title="Drag to resize"
        >
          <div class="w-1 h-8 bg-[#444444] rounded-full group-hover:bg-[#007acc] transition-colors" />
        </Resizable.Handle>

        {/* Preview Panel */}
        <Resizable.Panel 
          initialSize={0.5} 
          minSize={0.2}
          class={`flex-1 flex-col bg-white border-l border-[#333333] ${activeView() === 'preview' ? 'flex' : 'hidden md:flex'}`}
        >
          <div class="flex-1 overflow-hidden relative flex flex-col">
            <Preview code={compiledCode()} importMap={importMap()} />
          </div>
        </Resizable.Panel>
      </Resizable>

      {/* Footer */}
      <footer class="h-6 bg-[#007acc] flex items-center px-2 text-[11px] text-white space-x-4 shrink-0">
        <div class="flex items-center space-x-1">
          <span class="opacity-70">Ready</span>
        </div>
        <div class="hidden sm:block opacity-50">|</div>
        <div class="hidden sm:block opacity-70">UTF-8</div>
      </footer>
    </div>
  );
}
