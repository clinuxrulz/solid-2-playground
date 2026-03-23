import { createSignal, onMount, createEffect, onCleanup, For, Show } from 'solid-js';
import Resizable from '@corvu/resizable';
import Editor from './components/Editor';
import Preview from './components/Preview';
import { readFile as opfsReadFile, writeFile as opfsWriteFile, listFiles as opfsListFiles, deleteFile as opfsDeleteFile } from './lib/opfs';
import { createBridgeFS, BridgeFS, BridgeConfig } from './lib/bridge-fs';
import JSZip from 'jszip';
import * as Comlink from 'comlink';
import { getInitialEditorType, EditorType } from './lib/device';
import { registerSW } from 'virtual:pwa-register';

const DEFAULT_IMPORT_MAP = {
  "imports": {
    "solid-js": "https://esm.sh/solid-js@2.0.0-beta.2?dev",
    "@solidjs/web": "https://esm.sh/@solidjs/web@2.0.0-beta.2?dev&external=solid-js"
  }
};

const DEFAULT_FILES = {
  'main.tsx': `import { render } from '@solidjs/web';
import { createSignal } from 'solid-js';

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <button onClick={() => setCount(count() + 1)}>
      Count: {count()}
    </button>
  );
}

render(() => <App />, document.getElementById('root')!);
`,
};

export default function App() {
  const [files, setFiles] = createSignal<string[]>([]);
  const [activeFile, setActiveFile] = createSignal('main.tsx');
  const [code, setCode] = createSignal('');
  const [compiledCode, setCompiledCode] = createSignal('');
  const [compiledFiles, setCompiledFiles] = createSignal<Record<string, { code: string, imports: string[] }>>({});
  const [isCompiling, setIsCompiling] = createSignal(false);
  const [activeView, setActiveView] = createSignal<'code' | 'preview'>('code');
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [isMenuOpen, setIsMenuOpen] = createSignal(false);
  const [editorType, setEditorType] = createSignal<EditorType>(getInitialEditorType());
  const [importMap, setImportMap] = createSignal(JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
  const [needRefresh, setNeedRefresh] = createSignal(false);
  const [updateSW, setUpdateSW] = createSignal<(reloadPage: boolean) => Promise<void> | undefined>();
  const [bridgeConfig, setBridgeConfig] = createSignal<BridgeConfig | null>(null);
  const [bridgeFS, setBridgeFS] = createSignal<BridgeFS | null>(null);
  const [showBridgeModal, setShowBridgeModal] = createSignal(false);
  const [bridgePort, setBridgePort] = createSignal('8080');
  const [bridgeHost, setBridgeHost] = createSignal('127.0.0.1');
  const [bridgeKey, setBridgeKey] = createSignal('');
  const [isConnecting, setIsConnecting] = createSignal(false);
  const [lastSavedCode, setLastSavedCode] = createSignal('');
  const [compilerWorker, setCompilerWorker] = createSignal<Worker | null>(null);

  const handleEditorChange = (type: EditorType) => {
    setEditorType(type);
    localStorage.setItem('preferred-editor', type);
  };
  const [lastExportName, setLastExportName] = createSignal('solid-playground-opfs.zip');
  const [lspWorker, setLspWorker] = createSignal<any>(null);
  let importInput: HTMLInputElement | undefined;

  let lspWorkerInstance: Worker | undefined;

  const normalizeFilePath = (path: string) => {
    let normalized = path.replaceAll('\\\\', '/').replace(/^\/+/, '');
    if (!normalized) return '/';
    return '/' + normalized;
  };

  const normalizePathSegments = (path: string) => {
    const parts = path.split('/');
    const stack: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(part);
      }
    }
    return '/' + stack.join('/');
  };

  const readFile = async (fileName: string): Promise<string | null> => {
    if (bridgeFS()) {
      return bridgeFS()!.readFile(fileName);
    }
    return opfsReadFile(fileName);
  };

  const writeFile = async (fileName: string, content: string) => {
    if (bridgeFS()) {
      return bridgeFS()!.writeFile(fileName, content);
    }
    return opfsWriteFile(fileName, content);
  };

  const listFiles = async (): Promise<string[]> => {
    if (bridgeFS()) {
      return bridgeFS()!.listDirectory('/');
    }
    return opfsListFiles();
  };

  const deleteFile = async (fileName: string) => {
    if (bridgeFS()) {
      await bridgeFS()!.writeFile(fileName, '');
      return;
    }
    return opfsDeleteFile(fileName);
  };

  const connectToBridge = async () => {
    const port = bridgePort().trim() || '8080';
    const host = bridgeHost().trim() || '127.0.0.1';
    const key = bridgeKey().trim();
    
    if (!key) {
      alert('Please enter a security key');
      return;
    }
    
    setIsConnecting(true);
    try {
      const baseUrl = `http://${host}:${port}`;
      const fs = createBridgeFS({ host, port, key, baseUrl });
      
      const testConnection = await fs.listDirectory('/');
      if (testConnection && Array.isArray(testConnection)) {
        setBridgeConfig({ host, port, key, baseUrl });
        setBridgeFS(() => fs);
        setShowBridgeModal(false);
        setBridgeKey('');
        
        const nonImportMapFiles = testConnection.filter(f => f !== 'import-map.json');
        setFiles(nonImportMapFiles);
        
        // Read all files from bridge and sync to LSP/compiler
        const worker = lspWorker()?.instance;
        const fileContents: Record<string, string> = {};
        
        for (const file of nonImportMapFiles) {
          const content = await fs.readFile(file);
          if (content !== null) {
            fileContents[file] = content;
            // Sync to LSP worker
            if (worker && (file.endsWith('.tsx') || file.endsWith('.ts'))) {
              await worker.updateFile({ path: normalizeFilePath(file), code: content });
            }
          }
        }
        
        // Read import-map.json if exists
        const importMapContent = await fs.readFile('import-map.json');
        if (importMapContent !== null) {
          setImportMap(importMapContent);
        }
        
        // Set first file as active and load content
        if (nonImportMapFiles.length > 0) {
          const firstFile = nonImportMapFiles.find(f => f !== 'import-map.json') || nonImportMapFiles[0];
          setActiveFile(firstFile);
          const content = fileContents[firstFile];
          if (content !== undefined) {
            setCode(content);
            setLastSavedCode(content);
          }
        }
        
        // Trigger compilation for all TS/TSX files
        const compiler = compilerWorker();
        if (compiler) {
          const tsFiles = nonImportMapFiles.filter(f => f.endsWith('.tsx') || f.endsWith('.ts'));
          if (tsFiles.length > 0) {
            const sourceFiles: Record<string, string> = {};
            
            for (const file of tsFiles) {
              const normalized = normalizeFilePath(file);
              const rawContent = fileContents[file] || '';
              const compilerKey = normalized.replace(/^\/+/, '');
              sourceFiles[compilerKey] = rawContent;
            }
            
            compiler.postMessage({
              type: 'COMPILE_ALL',
              data: {
                files: sourceFiles,
                entry: 'main.tsx'
              }
            });
          }
        }
      }
    } catch (err) {
      alert('Failed to connect to bridge. Please check the port and key.');
      console.error('Bridge connection error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectFromBridge = () => {
    setBridgeConfig(null);
    setBridgeFS(null);
    setActiveFile('main.tsx');
    setCode('');
    setFiles([]);
    onMount(async () => {
      const existingFiles = await opfsListFiles();
      if (existingFiles.length > 0) {
        setFiles(existingFiles.filter(f => f !== 'import-map.json'));
        const firstFile = existingFiles.find(f => f !== 'import-map.json');
        if (firstFile) {
          setActiveFile(firstFile);
          const content = await opfsReadFile(firstFile);
          setCode(content || '');
        }
      } else {
        for (const [name, content] of Object.entries(DEFAULT_FILES)) {
          await opfsWriteFile(name, content);
        }
        setFiles(Object.keys(DEFAULT_FILES));
        setActiveFile('main.tsx');
        setCode(DEFAULT_FILES['main.tsx']);
      }
    });
  };


  const exportOPFS = async () => {
    try {
      const fileNamePrompt = window.prompt('Export ZIP filename', lastExportName());
      if (!fileNamePrompt) {
        return;
      }
      let fileName = fileNamePrompt.trim();
      if (!fileName) {
        alert('Filename cannot be empty.');
        return;
      }
      if (!fileName.toLowerCase().endsWith('.zip')) {
        fileName += '.zip';
      }
      setLastExportName(fileName);

      const fileNames = await listFiles();
      if (fileNames.length === 0) {
        alert('No files in OPFS to export.');
        return;
      }
      const zip = new JSZip();
      for (const fileName of fileNames) {
        const content = await readFile(fileName);
        if (content !== null) {
          zip.file(fileName, content);
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed', error);
      alert('Failed to export OPFS content as ZIP. Check console for details.');
    }
  };

  const triggerImport = () => {
    importInput?.click();
  };

  const importOPFS = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      const zip = await JSZip.loadAsync(file);
      const existingFiles = await listFiles();
      for (const name of existingFiles) {
        await deleteFile(name);
        const worker = lspWorker()?.instance;
        if (worker && (name.endsWith('.tsx') || name.endsWith('.ts'))) {
          await worker.deleteFile(name);
        }
      }

      const imported: string[] = [];
      for (const [fileName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const content = await entry.async('string');
        await writeFile(fileName, content);
        imported.push(fileName);

        const worker = lspWorker()?.instance;
        if (worker && (fileName.endsWith('.tsx') || fileName.endsWith('.ts'))) {
          await worker.updateFile({ path: normalizeFilePath(fileName), code: content });
        }
      }

      const nonImportMap = imported.filter(f => f !== 'import-map.json');
      setFiles(nonImportMap);

      if (imported.includes('import-map.json')) {
        const importMapContent = await readFile('import-map.json');
        if (importMapContent !== null) {
          setImportMap(importMapContent);
        }
      }

      const preferredFile = nonImportMap.length > 0 ? nonImportMap[0] : 'main.tsx';
      if (preferredFile) {
        setActiveFile(preferredFile);
        const content = await readFile(preferredFile);
        setCode(content || '');
      }

      const importedName = file.name.trim();
      if (importedName) {
        const adjusted = importedName.toLowerCase().endsWith('.zip') ? importedName : `${importedName}.zip`;
        setLastExportName(adjusted);
      }

      input.value = '';
      alert('Import complete.');
    } catch (error) {
      console.error('Import failed', error);
      alert('Failed to import ZIP. Check console for details.');
    }
  };

  onMount(async () => {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal && (import.meta.env.PROD || (import.meta.env.DEV && (window as any).ENABLE_PWA_DEV))) {
      const update = registerSW({
        onNeedRefresh() {
          setNeedRefresh(true);
        },
      });
      setUpdateSW(() => update);
    }

    // Initialize compiler worker
    const workerInstance = new Worker(new URL('./workers/compiler.ts', import.meta.url), {
      type: 'module',
    });
    setCompilerWorker(workerInstance);

    workerInstance.onmessage = (e) => {
      setIsCompiling(false);
      const { type, compiledFiles, code, error, entry } = e.data;
      if (type === 'COMPILED_ALL' && compiledFiles) {
        setCompiledFiles(compiledFiles);
        
        const entryPath = entry || activeFile();
        const noSlashEntry = entryPath.replace(/^\/+/, '');
        const slashedEntry = normalizeFilePath(entryPath);
        
        if (compiledFiles[noSlashEntry]) {
          setCompiledCode(compiledFiles[noSlashEntry].code);
        } else if (compiledFiles[slashedEntry]) {
          setCompiledCode(compiledFiles[slashedEntry].code);
        }
      } else if (type === 'COMPILED_SINGLE' && code) {
        setCompiledCode(code);
      } else if (type === 'ERROR' && error) {
        console.error('Compilation Error:', error);
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
            await worker.updateFile({ path: normalizeFilePath(file), code: content });
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
        setLastSavedCode(savedCode);
      }
    }
  });

  onCleanup(() => {
    compilerWorker()?.terminate();
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
        const compiler = compilerWorker();
        if (compiler && (fileName.endsWith('.tsx') || fileName.endsWith('.ts'))) {
          setIsCompiling(true);

          const tsFiles = currentFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
          const sourceFiles: Record<string, string> = {};

          for (const file of tsFiles) {
            const normalized = normalizeFilePath(file);
            const rawContent = file === fileName ? currentCode : (await readFile(file)) || '';
            const compilerKey = normalized.replace(/^\/+/, '');
            sourceFiles[compilerKey] = rawContent;
          }

          compiler.postMessage({ 
            type: 'COMPILE_ALL',
            data: {
              files: sourceFiles, 
              entry: 'main.tsx'
            }
          });
        }
        
        // Sync to LSP worker
        const lsp = lspWorker()?.instance;
        if (lsp && (fileName.endsWith('.tsx') || fileName.endsWith('.ts'))) {
          await lsp.updateFile({ path: normalizeFilePath(fileName), code: currentCode });
        }

        if (currentCode && currentCode !== lastSavedCode()) {
          writeFile(fileName, currentCode);
          setLastSavedCode(currentCode);
        }
      }
    }, 500);
  });

  const handleFileSwitch = async (name: string, saveCurrent = true) => {
    // Save current file first (only if content changed)
    if (saveCurrent && activeFile() && (files().includes(activeFile()) || activeFile() === 'import-map.json')) {
      const currentCode = code();
      if (currentCode && currentCode !== lastSavedCode()) {
        await writeFile(activeFile(), currentCode);
        setLastSavedCode(currentCode);
      }
      const worker = lspWorker()?.instance;
      if (worker && (activeFile().endsWith('.tsx') || activeFile().endsWith('.ts'))) {
        await worker.updateFile({ path: activeFile(), code: currentCode || '' });
      }
    }
    
    // Load new file
    const content = await readFile(name);
    if (content !== null) {
      setActiveFile(name);
      setCode(content);
      setLastSavedCode(content);
    }
  };

  const createNewFile = async () => {
    const name = prompt('File name:');
    if (name && !files().includes(name) && name !== 'import-map.json') {
      await writeFile(name, '');
      const worker = lspWorker()?.instance;
      if (worker && (name.endsWith('.tsx') || name.endsWith('.ts'))) {
        await worker.updateFile({ path: normalizeFilePath(name), code: '' });
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
        await worker.deleteFile(normalizeFilePath(name));
      }
      setFiles(newFiles);
    }
  };

  const resetToDefaults = async () => {
    if (confirm('Reset to defaults?')) {
      const allFiles = await listFiles();
      for (const f of allFiles) await deleteFile(f);
      for (const [name, content] of Object.entries(DEFAULT_FILES)) {
        await writeFile(name, content);
        const worker = lspWorker()?.instance;
        if (worker && (name.endsWith('.tsx') || name.endsWith('.ts'))) {
          await worker.updateFile({ path: normalizeFilePath(name), code: content });
        }
      }
      await writeFile('import-map.json', JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
      setFiles(Object.keys(DEFAULT_FILES));
      await handleFileSwitch('main.tsx', false);
      setImportMap(JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));
    }
  };

  return (
    <div class="flex flex-col h-full bg-[#1e1e1e] text-[#cccccc] font-sans overflow-hidden">
      {/* Top Bar */}
      <header class="flex items-center justify-between h-[calc(3rem+env(safe-area-inset-top))] px-0 pt-[env(safe-area-inset-top)] border-b border-[#333333] bg-[#252526] shrink-0 relative">
        <div class="flex items-center space-x-3 overflow-hidden">
          <div class="flex items-center space-x-2 shrink-0">
            <Show when={needRefresh()}>
              <button
                class="bg-[#007acc] hover:bg-[#0062a3] text-white text-[11px] px-2 py-0.5 rounded transition-colors"
                onClick={() => updateSW()?.(true)}
              >
                New Version
              </button>
            </Show>
          </div>
          <nav class="hidden sm:flex space-x-3 text-[12px] overflow-hidden whitespace-nowrap">
            <button class="hover:text-white shrink-0">Share</button>
            <button onClick={exportOPFS} class="hover:text-white shrink-0">Export</button>
            <button onClick={triggerImport} class="hover:text-white shrink-0">Import</button>
            <Show when={bridgeConfig()} fallback={<button onClick={() => setShowBridgeModal(true)} class="hover:text-white shrink-0 text-[#76b3e1]">Bridge</button>}>
              <button onClick={disconnectFromBridge} class="hover:text-white shrink-0 text-[#4ec9b0]">Bridge: Connected</button>
            </Show>
          </nav>
          
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen())}
            class="sm:hidden p-1 text-gray-400 hover:text-white transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
          </button>
        </div>

        {/* Mobile Dropdown Menu */}
        <Show when={isMenuOpen()}>
          <div 
            class="sm:hidden absolute top-[calc(3rem+env(safe-area-inset-top))] left-4 right-4 z-[100] bg-[#252526] border border-[#333333] rounded shadow-2xl py-2 mt-1"
            onClick={() => setIsMenuOpen(false)}
          >
            <button class="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[#2a2d2e] transition-colors">Share</button>
            <button onClick={exportOPFS} class="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[#2a2d2e] transition-colors">Export</button>
            <button onClick={triggerImport} class="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[#2a2d2e] transition-colors">Import</button>
            <Show when={bridgeConfig()} fallback={
              <button onClick={() => { setIsMenuOpen(false); setShowBridgeModal(true); }} class="w-full text-left px-4 py-2.5 text-[13px] text-[#76b3e1] hover:bg-[#2a2d2e] transition-colors">Connect to Bridge</button>
            }>
              <button onClick={disconnectFromBridge} class="w-full text-left px-4 py-2.5 text-[13px] text-[#4ec9b0] hover:bg-[#2a2d2e] transition-colors">Bridge: Connected (Tap to disconnect)</button>
            </Show>
            <div class="h-px bg-[#333333] my-1 mx-2" />
            <button onClick={createNewFile} class="w-full text-left px-4 py-2.5 text-[13px] hover:bg-[#2a2d2e] transition-colors">New File</button>
            <button onClick={resetToDefaults} class="w-full text-left px-4 py-2.5 text-[13px] text-red-400 hover:bg-[#2a2d2e] transition-colors">Reset to Defaults</button>
          </div>
          <div 
            class="fixed inset-0 z-[90] sm:hidden" 
            onClick={() => setIsMenuOpen(false)} 
          />
        </Show>
        
        <div class="flex items-center space-x-2">
          {/* Mobile Editor Selector */}
          <select 
            value={editorType()} 
            onInput={(e) => handleEditorChange((e.target as HTMLSelectElement).value as EditorType)}
            class="md:hidden bg-[#333333] text-white text-[11px] px-2 py-1 rounded border border-[#444444] focus:outline-none focus:border-[#007acc]"
          >
            <option value="monaco">Monaco</option>
            <option value="codemirror">CodeMirror</option>
            <option value="net-vim">net-vim</option>
          </select>

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
      <input
        ref={(el) => (importInput = el as HTMLInputElement | undefined)}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={importOPFS}
      />

      {/* Bridge Connection Modal */}
      <Show when={showBridgeModal()}>
        <div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/70">
          <div class="bg-[#252526] border border-[#333333] rounded-lg w-[90%] max-w-md p-6 shadow-2xl">
            <h3 class="text-[16px] font-medium text-white mb-4">Connect to Bridge</h3>
            <p class="text-[12px] text-gray-400 mb-4">
              Connect to a bridge server running on your local machine to access files directly.
              Start the bridge server and use the security key it provides.
            </p>
            <div class="space-y-4">
              <div class="flex gap-4">
                <div class="flex-[2]">
                  <label class="block text-[12px] text-gray-400 mb-1">Host</label>
                  <input
                    type="text"
                    value={bridgeHost()}
                    onInput={(e) => setBridgeHost(e.target.value)}
                    placeholder="127.0.0.1"
                    class="w-full bg-[#1e1e1e] border border-[#444444] rounded px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#007acc]"
                  />
                </div>
                <div class="flex-1">
                  <label class="block text-[12px] text-gray-400 mb-1">Port</label>
                  <input
                    type="text"
                    value={bridgePort()}
                    onInput={(e) => setBridgePort(e.target.value)}
                    placeholder="8080"
                    class="w-full bg-[#1e1e1e] border border-[#444444] rounded px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#007acc]"
                  />
                </div>
              </div>
              <div>
                <label class="block text-[12px] text-gray-400 mb-1">Security Key</label>
                <input
                  type="text"
                  value={bridgeKey()}
                  onInput={(e) => setBridgeKey(e.target.value)}
                  placeholder="Enter the key from the bridge server"
                  class="w-full bg-[#1e1e1e] border border-[#444444] rounded px-3 py-2 text-[13px] text-white focus:outline-none focus:border-[#007acc]"
                />
              </div>
            </div>
            <div class="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => { setShowBridgeModal(false); setBridgeKey(''); }}
                class="px-4 py-2 text-[12px] text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={connectToBridge}
                disabled={isConnecting()}
                class="px-4 py-2 text-[12px] bg-[#007acc] text-white rounded hover:bg-[#0062a3] transition-colors disabled:opacity-50"
              >
                {isConnecting() ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      </Show>

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
        <div class="hidden sm:flex items-center px-2 space-x-2 border-l border-[#333333] h-full bg-[#252526]">
          <button 
            onClick={createNewFile} 
            class="p-1 hover:text-white text-gray-500 text-lg transition-colors"
            title="New File"
          >+</button>
          <button 
            onClick={resetToDefaults}
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
          class={`flex-1 flex-col overflow-hidden bg-[#1e1e1e] ${activeView() === 'code' ? 'flex' : 'hidden md:flex'}`}
        >
          <div class="flex-1 overflow-hidden relative flex flex-col">
            <Show when={activeFile()} fallback={<div class="p-4 text-gray-500 flex-1 flex items-center justify-center">Select a file</div>}>
            <Editor
                code={code()}
                onCodeChange={setCode}
                fileName={activeFile()}
                lspWorker={lspWorker()}
                allFiles={files()}
                editorType={editorType()}
                onEditorTypeChange={handleEditorChange}
                bridgeFS={bridgeFS()}
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
          class={`flex-1 flex-col overflow-hidden bg-white border-l border-[#333333] ${activeView() === 'preview' ? 'flex' : 'hidden md:flex'}`}
        >
          <div class="flex-1 overflow-hidden relative flex flex-col">
            <Preview
            code={compiledCode()}
            importMap={importMap()}
            compiledFiles={compiledFiles()}
            entryFile="main.tsx"
            compilerWorker={compilerWorker()}
          />
          </div>
        </Resizable.Panel>
      </Resizable>

      {/* Footer */}
      <footer class="h-[calc(1.5rem+env(safe-area-inset-bottom))] bg-[#007acc] flex items-center px-2 pb-[env(safe-area-inset-bottom)] text-[11px] text-white space-x-4 shrink-0">
        <div class="flex items-center space-x-1">
          <span class="opacity-70">Ready</span>
        </div>
        <div class="hidden sm:block opacity-50">|</div>
        <div class="hidden sm:block opacity-70">UTF-8</div>
      </footer>
    </div>
  );
}
