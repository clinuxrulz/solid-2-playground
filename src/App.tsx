import { createSignal, onMount, createEffect, onCleanup, For, Show } from 'solid-js';
import Resizable from '@corvu/resizable';
import Editor from './components/Editor';
import Preview from './components/Preview';
import { readFile, writeFile, listFiles, deleteFile } from './lib/opfs';
import JSZip from 'jszip';
import * as Comlink from 'comlink';
import { getInitialEditorType, EditorType } from './lib/device';

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
  const [compiledFiles, setCompiledFiles] = createSignal<Record<string, string>>({});
  const [isCompiling, setIsCompiling] = createSignal(false);
  const [activeView, setActiveView] = createSignal<'code' | 'preview'>('code');
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [isMenuOpen, setIsMenuOpen] = createSignal(false);
  const [editorType, setEditorType] = createSignal<EditorType>(getInitialEditorType());
  const [importMap, setImportMap] = createSignal(JSON.stringify(DEFAULT_IMPORT_MAP, null, 2));

  const handleEditorChange = (type: EditorType) => {
    setEditorType(type);
    localStorage.setItem('preferred-editor', type);
  };
  const [lastExportName, setLastExportName] = createSignal('solid-playground-opfs.zip');
  const [lspWorker, setLspWorker] = createSignal<any>(null);
  let importInput: HTMLInputElement | undefined;

  let compilerWorker: Worker | undefined;
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

  const resolveModuleSpecifier = (importer: string, specifier: string, knownFiles: Set<string>) => {
    const importerPath = normalizeFilePath(importer);
    const importerDir = importerPath.replace(/\/[^/]*$/, '');

    const resolveCandidate = (candidate: string) => {
      candidate = candidate.replace(/\\/g, '/');
      candidate = normalizePathSegments(candidate);

      const tryVariants = [candidate];
      if (!/\.[a-zA-Z0-9]+$/.test(candidate)) {
        tryVariants.push(`${candidate}.tsx`, `${candidate}.ts`, `${candidate}.jsx`, `${candidate}.js`);
      }

      for (const variant of tryVariants) {
        if (knownFiles.has(variant)) return variant;
      }

      return null;
    };

    if (specifier.startsWith('/')) {
      return resolveCandidate(specifier);
    }

    if (specifier.startsWith('.')) {
      const candidate = importerDir + '/' + specifier;
      return resolveCandidate(candidate);
    }

    // Bare local imports like `file2.ts` (no ./) should be treated as same-directory module names
    const candidateFromImporter = importerDir + '/' + specifier;
    const found = resolveCandidate(candidateFromImporter);
    if (found) return found;

    // Also allow root-ish bare names if exactly listed
    const bareCandidate = '/' + specifier;
    return resolveCandidate(bareCandidate);
  };

  const rewriteFileImports = (importer: string, content: string, knownFiles: Set<string>) => {
    let result = content.replace(/(import\s+(?:[\s\S]*?\s+from\s*)?['"])(.+?)(['"])/g, (match, prefix, spec, suffix) => {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveModuleSpecifier(importer, spec, knownFiles);
        if (resolved) {
          const compilerFriendlyPath = resolved.replace(/^\/+/, '');
          return `${prefix}${compilerFriendlyPath}${suffix}`;
        }
      }
      return match;
    });

    result = result.replace(/import\(\s*['"](.+?)['"]\s*\)/g, (match, spec) => {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveModuleSpecifier(importer, spec, knownFiles);
        if (resolved) {
          const compilerFriendlyPath = resolved.replace(/^\/+/, '');
          return `import('${compilerFriendlyPath}')`;
        }
      }
      return match;
    });

    return result;
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
    // Initialize compiler worker
    compilerWorker = new Worker(new URL('./workers/compiler.ts', import.meta.url), {
      type: 'module',
    });

    compilerWorker.onmessage = (e) => {
      setIsCompiling(false);
      if (e.data.compiledFiles) {
        setCompiledFiles(e.data.compiledFiles);
        
        const entryPath = e.data.entry || activeFile();
        const noSlashEntry = entryPath.replace(/^\/+/, '');
        const slashedEntry = normalizeFilePath(entryPath);
        
        if (e.data.compiledFiles[noSlashEntry]) {
          setCompiledCode(e.data.compiledFiles[noSlashEntry]);
        } else if (e.data.compiledFiles[slashedEntry]) {
          setCompiledCode(e.data.compiledFiles[slashedEntry]);
        }
      } else if (e.data.code) {
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

          const tsFiles = currentFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
          const knownFiles = new Set(tsFiles.map((f) => normalizeFilePath(f)));
          const sourceFiles: Record<string, string> = {};

          for (const file of tsFiles) {
            const normalized = normalizeFilePath(file);
            const rawContent = file === fileName ? currentCode : (await readFile(file)) || '';
            const compilerKey = normalized.replace(/^\/+/, '');
            sourceFiles[compilerKey] = rewriteFileImports(normalized, rawContent, knownFiles);
          }

          compilerWorker.postMessage({ 
            files: sourceFiles, 
            entry: 'main.tsx'
          });
        }
        
        // Sync to LSP worker
        if (worker && (fileName.endsWith('.tsx') || fileName.endsWith('.ts'))) {
          await worker.updateFile({ path: normalizeFilePath(fileName), code: currentCode });
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
      <header class="flex items-center justify-between h-[calc(3rem+env(safe-area-inset-top))] px-4 pt-[env(safe-area-inset-top)] border-b border-[#333333] bg-[#252526] shrink-0 relative">
        <div class="flex items-center space-x-3 overflow-hidden">
          <div class="flex items-center space-x-2 shrink-0">
            <svg class="w-5 h-5 text-[#76b3e1]" viewBox="0 0 166 155" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M163 35L15 137C11.6667 139 3.4 141.4 1 133L1 5C1 1.66667 3.4 1 11 1L155 1C158.333 1 163 3.4 163 11V35Z" fill="currentColor"/>
            </svg>
            <h1 class="text-[13px] font-bold tracking-tight text-[#f3f3f3] hidden sm:block">SOLID 2.0 PLAYGROUND</h1>
          </div>
          <nav class="hidden sm:flex space-x-3 text-[12px] overflow-hidden whitespace-nowrap">
            <button class="hover:text-white shrink-0">Share</button>
            <button onClick={exportOPFS} class="hover:text-white shrink-0">Export</button>
            <button onClick={triggerImport} class="hover:text-white shrink-0">Import</button>
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
            entryFile="/main.tsx"
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
