import { onCleanup, onMount, createEffect, createSignal } from 'solid-js';
import { initNetVim, VimAPI, PRELUDE_PLUGINS, FileSystem } from '@net-vim/core';
// @ts-ignore
import lspAdapterSource from '../lib/netvim-adapter.tsx?raw';
import type { BridgeFS } from '../lib/bridge-fs';

interface NetVimEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker?: any;
  bridgeFS?: BridgeFS | null;
  lspReady?: boolean;
  lspTypesVersion?: () => number;
}

export default function NetVimEditor(props: NetVimEditorProps) {
  let editorParent: HTMLDivElement | undefined;
  const [vimApi, setVimApi] = createSignal<VimAPI | undefined>();
  const [hasSetupLSP, setHasSetupLSP] = createSignal(false);
  const [currentFSMode, setCurrentFSMode] = createSignal<'opfs' | 'bridge'>('opfs');
  let disposeFn: (() => void) | undefined;
  let isInternalChange = false;
  let lspLoadPromise: Promise<boolean> | null = null;
  let initialLspRefreshDone = false;
  const pendingBufferLoads = new Map<string, Set<() => void>>();

  const normalizeEditorPath = (path: string) => path.replace(/^\/+/, '');
  const waitForBufferLoad = (path: string) => new Promise<void>((resolve) => {
    const normalizedPath = normalizeEditorPath(path);
    const existing = pendingBufferLoads.get(normalizedPath);
    if (existing) {
      existing.add(resolve);
      return;
    }
    pendingBufferLoads.set(normalizedPath, new Set([resolve]));
  });

  const flushBufferLoadWaiters = (path: string) => {
    const normalizedPath = normalizeEditorPath(path);
    const waiters = pendingBufferLoads.get(normalizedPath);
    if (!waiters) return;
    pendingBufferLoads.delete(normalizedPath);
    waiters.forEach(resolve => resolve());
  };

  const openFile = async (api: VimAPI, path: string) => {
    isInternalChange = true;
    try {
      const bufferLoad = waitForBufferLoad(path);
      api.executeCommand(`e ${path}`);
      await bufferLoad;
    } finally {
      isInternalChange = false;
    }
  };

  const createOPFSFileSystem = (): FileSystem => ({
    readFile: async (path: string) => {
      if (path.startsWith('.config/')) return null;
      try {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter(p => p.length > 0);
        let current = root;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i]);
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
        const file = await fileHandle.getFile();
        return await file.text();
      } catch (e) {
        return null;
      }
    },
    writeFile: async (path: string, content: string) => {
      if (path.startsWith('.config/')) return;
      try {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter(p => p.length > 0);
        let current = root;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i], { create: true });
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(content);
        await writable.close();
      } catch (e) {
        console.error('FS Write Error:', e);
      }
    },
    listDirectory: async (path: string) => {
      if (path.startsWith('.config/')) return [];
      try {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter(p => p.length > 0);
        let current = root;
        for (const part of parts) {
          current = await current.getDirectoryHandle(part);
        }
        const entries: string[] = [];
        for await (const [name, handle] of (current as any).entries()) {
          entries.push(handle.kind === 'directory' ? `${name}/` : name);
        }
        return entries;
      } catch (e) {
        return [];
      }
    },
    isDirectory: async (path: string) => {
      if (path === '' || path === '.' || path === './') return true;
      if (path.startsWith('.config/')) return false;
      try {
        const root = await navigator.storage.getDirectory();
        const parts = path.split('/').filter(p => p.length > 0);
        let current = root;
        for (const part of parts) {
          current = await current.getDirectoryHandle(part);
        }
        return true;
      } catch (e) {
        return false;
      }
    }
  });

  const createBridgeFileSystem = (bridgeFS: BridgeFS): FileSystem => ({
    readFile: async (path: string) => {
      if (path.startsWith('.config/')) return null;
      return await bridgeFS.readFile(path);
    },
    writeFile: async (path: string, content: string) => {
      if (path.startsWith('.config/')) return;
      await bridgeFS.writeFile(path, content);
    },
    listDirectory: async (path: string) => {
      if (path.startsWith('.config/')) return [];
      return await bridgeFS.listDirectory(path);
    },
    isDirectory: async (path: string) => {
      if (path === '' || path === '.' || path === './') return true;
      if (path.startsWith('.config/')) return false;
      return await bridgeFS.isDirectory(path);
    }
  });

  onMount(async () => {
    if (!editorParent) return;

    const useBridgeFS = !!props.bridgeFS;
    setCurrentFSMode(useBridgeFS ? 'bridge' : 'opfs');

    const fileSystem = useBridgeFS 
      ? createBridgeFileSystem(props.bridgeFS!)
      : createOPFSFileSystem();

    const { vim, dispose } = await initNetVim(editorParent, {
      fileSystem
    });
    const api = vim.getAPI();
    setVimApi(api);
    disposeFn = dispose;

    api.on('BufferLoaded', (data: { path: string }) => {
      if (data?.path) {
        flushBufferLoadWaiters(data.path);
      }
    });

    // Manually load all prelude plugins except ts-lsp
    for (const [name, source] of Object.entries(PRELUDE_PLUGINS)) {
      if (!name.includes('ts-lsp') && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
        await api.loadPluginFromSource(name, source as string);
      }
    }

    // Load LSP plugin if available (wait for lspReady to ensure proper initialization order)
    if (props.lspReady && props.lspWorker) {
      const didLoad = await loadLspPlugin(api);
      if (didLoad) {
        await refreshAfterLspAttach(api, props.fileName);
      }
    }

    // Initial file load - do this AFTER LSP is loaded
    if (props.fileName) {
      await openFile(api, props.fileName);
    }

    api.on('TextChanged', () => {
      const api_inst = vimApi();
      if (isInternalChange || !api_inst) return;
      const content = api_inst.getBuffer().join('\n');
      props.onCodeChange(content);
    });
  });

  // Helper function to load LSP plugin
  const loadLspPlugin = async (api: any) => {
    if (!props.lspReady || !props.lspWorker) return false;
    if (hasSetupLSP()) return false;
    if (lspLoadPromise) return lspLoadPromise;

    const pluginName = `lsp-adapter`;
    (window as any).__LSP_WORKER__ = props.lspWorker;
    lspLoadPromise = (async () => {
      const success = await api.loadPluginFromSource(pluginName, lspAdapterSource);
      if (success) {
        setHasSetupLSP(true);
      }
      return !!success;
    })();

    try {
      return await lspLoadPromise;
    } finally {
      lspLoadPromise = null;
    }
  };

  const refreshAfterLspAttach = async (api: VimAPI, path?: string) => {
    if (!path || initialLspRefreshDone) return;
    initialLspRefreshDone = true;
    await openFile(api, path);
  };

  createEffect(() => {
    // Handle lspReady becoming true (ensures proper initialization order)
    const lspReady = props.lspReady;
    const lspWorker = props.lspWorker;
    const api = vimApi();
    if (lspReady && lspWorker && api && !hasSetupLSP()) {
      void (async () => {
        const currentPath = api.getCurrentFilePath();
        const didLoad = await loadLspPlugin(api);

        // If the buffer was opened before the LSP adapter finished attaching,
        // reopen it once so diagnostics and type state are recomputed with the
        // fully initialized worker.
        const targetPath = currentPath || props.fileName;
        if (didLoad && targetPath) {
          await refreshAfterLspAttach(api, targetPath);
        }
      })();
    }
  });

  createEffect(() => {
    // Handle fileName change
    const fileName = props.fileName;
    const api = vimApi();
    if (api && fileName) {
      if (api.getCurrentFilePath() !== fileName) {
        void openFile(api, fileName);
      }
    }
  });

  createEffect(() => {
    // Re-sync with LSP when types version changes
    const lspTypesVersion = props.lspTypesVersion?.();
    const api = vimApi();
    const lspWorker = props.lspWorker;
    if (lspTypesVersion && api && lspWorker && hasSetupLSP()) {
      const currentPath = api.getCurrentFilePath();
      if (currentPath) {
        void (async () => {
          const absolutePath = normalizeEditorPath(currentPath);
          const bufferLines = api.getBuffer();
          const code = bufferLines.join('\n');
          await lspWorker.instance.updateFile({ path: absolutePath, code });
          // Re-open the file to trigger re-analysis
          await openFile(api, currentPath);
        })();
      }
    }
  });

  createEffect(() => {
    const bridgeFS = props.bridgeFS;
    const api = vimApi();
    
    if (api && props.fileName) {
      const targetMode = bridgeFS ? 'bridge' : 'opfs';
      const currentMode = currentFSMode();
      
      if (targetMode !== currentMode) {
        setCurrentFSMode(targetMode);
        void openFile(api, props.fileName);
      }
    }
  });

  createEffect(() => {
    const api = vimApi();
    const code = props.code;
    
    if (api && props.fileName) {
      const currentPath = api.getCurrentFilePath();
      if (currentPath === props.fileName) {
        const currentContent = api.getBuffer().join('\n');
        if (currentContent !== code && !isInternalChange) {
          void openFile(api, props.fileName);
        }
      }
    }
  });

  onCleanup(() => {
    disposeFn?.();
  });

  return <div ref={editorParent} class="h-full w-full overflow-hidden bg-black" />;
}
