import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

interface PreviewProps {
  code: string;
  importMap?: string;
  compiledFiles?: Record<string, { code: string, imports: string[], hotImports: string[] }>;
  entryFile?: string;
  compilerWorker?: Worker | null;
}

const HMR_RUNTIME = `
  window.onerror = (m) => window.parent.postMessage({ type: 'error', message: m }, '*');
  window.onunhandledrejection = (e) => window.parent.postMessage({ type: 'error', message: e.reason?.message || e.reason }, '*');

  window.$hmr = {
    dispose: null,
    cache: window.$hmr?.cache || new Map(),
    registry: window.$hmr?.registry || new Map(), // logicalPath -> blobUrl
    listeners: window.$hmr?.listeners || new Map(), // logicalPath -> Set<callback>
    setDispose(fn) { this.dispose = fn; },
    notify(path, url) {
      this.registry.set(path, url);
      const callbacks = this.listeners.get(path);
      if (callbacks) callbacks.forEach(cb => cb(url));
    }
  };

  window.addEventListener('message', async (e) => {
    if (e.data.type === 'HMR_UPDATE') {
      const { entryUrl, urlMap, needsShim } = e.data;
      
      // Update registry and notify hot accessors
      for (const [path, url] of Object.entries(urlMap)) {
        window.$hmr.notify(path, url);
      }

      if (entryUrl) {
        try {
          if (window.$hmr.dispose) {
            window.$hmr.dispose();
            window.$hmr.dispose = null;
          }
          const root = document.getElementById('root');
          if (root) root.innerHTML = '';
          await import(entryUrl);
          window.parent.postMessage({ type: 'hmr-success' }, '*');
        } catch (err) {
          window.parent.postMessage({ type: 'error', message: err.stack || err.message }, '*');
        }
      }
    }
  });
`;

const HMR_API_CODE = `
  import { createSignal, onCleanup } from 'solid-js';
  const hmr = window.$hmr;
  export function hmrSignal(id, init) {
    if (!hmr.cache.has(id)) hmr.cache.set(id, createSignal(init));
    return hmr.cache.get(id);
  }
  export function onHMRDispose(fn) { hmr.setDispose(fn); }
  
  export function hot(path) {
    const [module, setModule] = createSignal(hmr.cache.get('hot:' + path) || null);
    const update = async (url) => {
      try {
        const mod = await import(url);
        hmr.cache.set('hot:' + path, mod);
        setModule(mod);
      } catch (err) {
        window.parent.postMessage({ type: 'error', message: 'HMR Error importing ' + path + ': ' + (err.stack || err.message) }, '*');
      }
    };
    
    // Initial load
    const currentUrl = hmr.registry.get(path);
    if (currentUrl) update(currentUrl);
    
    // Listen for updates
    if (!hmr.listeners.has(path)) hmr.listeners.set(path, new Set());
    const cbs = hmr.listeners.get(path);
    cbs.add(update);
    onCleanup(() => cbs.delete(update));
    
    return module;
  }
`;

function resolvePath(base: string, relative: string): string {
  if (!relative.startsWith('.')) return relative;
  const parts = base.split('/').filter(Boolean);
  parts.pop();
  relative.split('/').filter(Boolean).forEach(p => {
    if (p === '..') parts.pop(); else if (p !== '.') parts.push(p);
  });
  return parts.join('/');
}

function findInCompiled(path: string, compiled: Record<string, any>): string | null {
  const norm = path.replace(/^\/+/, '');
  const variants = [norm, norm + '.tsx', norm + '.ts', norm + '.jsx', norm + '.js'];
  for (const v of variants) if (compiled[v]) return v;
  return null;
}

export default function Preview(props: PreviewProps) {
  let iframeRef: HTMLIFrameElement | undefined;
  let iframeUrl: string | null = null;
  let hmrApiUrl: string | null = null;
  let fileCache = new Map<string, { code: string, blobUrl: string }>();
  let isIframeLoaded = false;
  const [error, setError] = createSignal<string | null>(null);

  const initIframe = () => {
    if (!iframeRef) return;
    if (hmrApiUrl) URL.revokeObjectURL(hmrApiUrl);
    hmrApiUrl = URL.createObjectURL(new Blob([HMR_API_CODE], { type: 'application/javascript' }));

    const defaultMap = {
      imports: {
        "solid-js": "https://esm.sh/solid-js@2.0.0-beta.4?dev",
        "@solidjs/web": "https://esm.sh/@solidjs/web@2.0.0-beta.4?dev&external=solid-js",
        "playground:hmr": hmrApiUrl
      }
    };
    let map = { ...defaultMap } as any;
    let useVersion = '2.0.0-beta.4';
    
    if (props.importMap) {
      try {
        const p = JSON.parse(props.importMap);
        if (p?.imports) {
          map.imports = { ...map.imports, ...p.imports };
          const solidUrl = p.imports['solid-js'];
          if (solidUrl) {
            const match = solidUrl.match(/solid-js@([\d.]+(?:-beta\.\d+)?)/);
            if (match) useVersion = match[1];
          }
        }
      } catch (e) {}
    }
    
    if (useVersion === '2.0.0-beta.2') {
      map.imports['solid-js'] = 'https://esm.sh/solid-js@2.0.0-beta.4?dev';
      map.imports['@solidjs/web'] = 'https://esm.sh/@solidjs/web@2.0.0-beta.4?dev&external=solid-js';
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script type="importmap">${JSON.stringify(map)}</script><style>body{font-family:sans-serif;margin:0}#root{min-height:100vh}</style></head><body><div id="root"></div><script>${HMR_RUNTIME}</script></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (iframeUrl) URL.revokeObjectURL(iframeUrl);
    iframeUrl = url;
    iframeRef.src = url;
    isIframeLoaded = false;
    iframeRef.onload = () => { isIframeLoaded = true; if (fileCache.size > 0) sendHMRUpdate(undefined, true); };
  };

  const sendHMRUpdate = (entryFile?: string, forceEntry = false) => {
    if (!iframeRef || !isIframeLoaded) return;
    const urlMap: Record<string, string> = {};
    fileCache.forEach((v, k) => urlMap[k] = v.blobUrl);
    const entry = entryFile || props.entryFile || 'main.tsx';
    const entryUrl = (forceEntry || entryFile) ? fileCache.get(entry)?.blobUrl : undefined;
    iframeRef.contentWindow?.postMessage({ type: 'HMR_UPDATE', entryUrl, urlMap }, '*');
  };

  const performHMR = async () => {
    if (!props.compiledFiles || !props.compilerWorker) return;
    const compiled = props.compiledFiles;
    const worker = props.compilerWorker;

    // 1. Detect Changes
    const changed = new Set<string>();
    for (const [f, d] of Object.entries(compiled)) {
      if (!fileCache.has(f) || fileCache.get(f)!.code !== d.code) changed.add(f);
    }
    if (changed.size === 0 && fileCache.size > 0) return;

    // 2. Dirty Propagation (Stop at hot boundaries)
    const reverseDeps = new Map<string, Set<string>>();
    for (const [f, d] of Object.entries(compiled)) {
      d.imports.forEach(imp => {
        const res = findInCompiled(resolvePath(f, imp), compiled);
        if (res) {
          if (!reverseDeps.has(res)) reverseDeps.set(res, new Set());
          reverseDeps.get(res)!.add(f);
        }
      });
    }

    const dirty = new Set(changed);
    const toVisit = [...changed];
    while (toVisit.length > 0) {
      const f = toVisit.pop()!;
      const rdeps = reverseDeps.get(f);
      if (rdeps) {
        rdeps.forEach(r => {
          if (!dirty.has(r)) {
            // Check if 'r' imports 'f' via hot()
            const data = compiled[r];
            const isHotDep = data.hotImports.some(hi => findInCompiled(resolvePath(r, hi), compiled) === f);
            if (!isHotDep) {
              dirty.add(r);
              toVisit.push(r);
            }
          }
        });
      }
    }

    // 3. Re-transform dirty files
    const newCache = new Map(fileCache);
    const toRevoke: string[] = [];
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visit = (f: string) => {
      if (visited.has(f)) return;
      visited.add(f);
      compiled[f]?.imports.forEach(i => {
        const r = findInCompiled(resolvePath(f, i), compiled);
        if (r) visit(r);
      });
      sorted.push(f);
    };
    Object.keys(compiled).forEach(visit);

    for (const f of sorted) {
      if (!dirty.has(f) && newCache.has(f)) continue;
      const d = compiled[f];
      const mapping: Record<string, string> = {};
      const hotMapping: Record<string, string> = {};
      
      [...d.imports, ...(d.hotImports || [])].forEach(i => {
        const r = findInCompiled(resolvePath(f, i), compiled);
        if (r) {
           const isHot = d.hotImports && d.hotImports.includes(i);
           if (isHot) {
             hotMapping[i] = r;
           } else {
             mapping[i] = (newCache.get(r)?.blobUrl || '');
           }
        }
      });

      const code = await new Promise<string>(res => {
        const h = (e: any) => { if (e.data.type === 'TRANSFORMED' && e.data.fileName === f) { worker.removeEventListener('message', h); res(e.data.code); } };
        worker.addEventListener('message', h);
        worker.postMessage({ type: 'TRANSFORM_IMPORTS', data: { fileName: f, code: d.code, mapping, hotMapping } });
      });

      if (newCache.has(f)) toRevoke.push(newCache.get(f)!.blobUrl);
      newCache.set(f, { code: d.code, blobUrl: URL.createObjectURL(new Blob([code], { type: 'application/javascript' })) });
    }

    fileCache = newCache;
    
    // If 'dirty' includes entry file, full reload, else partial update
    const entry = props.entryFile || 'main.tsx';
    sendHMRUpdate(dirty.has(entry) ? entry : undefined);

    setTimeout(() => toRevoke.forEach(u => URL.revokeObjectURL(u)), 2000);
  };

  createEffect(() => { if (props.importMap) initIframe(); });
  createEffect(() => { if (props.compiledFiles) performHMR(); });
  onCleanup(() => { if (iframeUrl) URL.revokeObjectURL(iframeUrl); if (hmrApiUrl) URL.revokeObjectURL(hmrApiUrl); fileCache.forEach(v => URL.revokeObjectURL(v.blobUrl)); });
  onMount(() => {
    initIframe();
    const h = (e: any) => { if (e.data.type === 'error') setError(e.data.message); else if (e.data.type === 'hmr-success') setError(null); };
    window.addEventListener('message', h);
    onCleanup(() => window.removeEventListener('message', h));
  });

  return (
    <div class="h-full w-full relative">
      <iframe ref={iframeRef} class="h-full w-full border-0 bg-white" title="preview" />
      {error() && <div class="absolute bottom-0 left-0 right-0 bg-red-500 text-white p-2 text-xs overflow-auto max-h-32 shadow-xl z-20"><pre class="whitespace-pre-wrap font-mono">{error()}</pre></div>}
    </div>
  );
}
