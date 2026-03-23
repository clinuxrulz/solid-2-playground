import { onCleanup, onMount, createEffect, createSignal } from 'solid-js';
import { initNetVim, VimAPI, PRELUDE_PLUGINS, FileSystem } from '@net-vim/core';
// @ts-ignore
import lspAdapterSource from '../lib/netvim-adapter.tsx?raw';
import type { BridgeFS } from '../lib/bridge-fs';

interface NetVimEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker: any;
  bridgeFS?: BridgeFS | null;
}

export default function NetVimEditor(props: NetVimEditorProps) {
  let editorParent: HTMLDivElement | undefined;
  const [vimApi, setVimApi] = createSignal<VimAPI | undefined>();
  const [hasSetupLSP, setHasSetupLSP] = createSignal(false);
  const [currentFSMode, setCurrentFSMode] = createSignal<'opfs' | 'bridge'>('opfs');
  let disposeFn: (() => void) | undefined;
  let isInternalChange = false;

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

    // Manually load all prelude plugins except ts-lsp
    for (const [name, source] of Object.entries(PRELUDE_PLUGINS)) {
      if (!name.includes('ts-lsp') && (name.endsWith(".ts") || name.endsWith(".tsx"))) {
        await api.loadPluginFromSource(name, source as string);
      }
    }

    // Initial file load
    if (props.fileName) {
      api.executeCommand(`e ${props.fileName}`);
    }

    api.on('TextChanged', () => {
      const api_inst = vimApi();
      if (isInternalChange || !api_inst) return;
      const content = api_inst.getBuffer().join('\n');
      props.onCodeChange(content);
    });
  });

  createEffect(() => {
    const api = vimApi();
    if (props.lspWorker && api && !hasSetupLSP()) {
      const pluginName = `lsp-adapter-${Date.now()}`;
      console.log(`NetVimEditor: Loading LSP plugin as ${pluginName}...`);
      // Expose worker globally so the plugin can find it
      (window as any).__LSP_WORKER__ = props.lspWorker;
      
      api.loadPluginFromSource(pluginName, lspAdapterSource).then(success => {
        if (success) {
          console.log('NetVimEditor: LSP plugin loaded successfully');
          setHasSetupLSP(true);
        } else {
          console.error('NetVimEditor: Failed to load LSP plugin');
        }
      });
    }
  });

  createEffect(() => {
    // Handle fileName change
    const fileName = props.fileName;
    const api = vimApi();
    if (api && fileName) {
      if (api.getCurrentFilePath() !== fileName) {
        api.executeCommand(`e ${fileName}`);
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
        isInternalChange = true;
        api.executeCommand(`e ${props.fileName}`);
        setTimeout(() => { isInternalChange = false; }, 100);
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
          isInternalChange = true;
          api.executeCommand(`e ${props.fileName}`);
          setTimeout(() => { isInternalChange = false; }, 100);
        }
      }
    }
  });

  onCleanup(() => {
    disposeFn?.();
  });

  return <div ref={editorParent} class="h-full w-full overflow-hidden bg-black" />;
}

