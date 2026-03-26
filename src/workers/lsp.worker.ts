import {
  createSystem,
  createVirtualTypeScriptEnvironment,
  VirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import { setupTypeAcquisition } from "@typescript/ata";
import * as Comlink from "comlink";
import { createWorker } from "../lib/codemirror-ts/worker";

const playgroundHmrTypes = `
declare module 'playground:hmr' {
  import type { Accessor } from 'solid-js';
  export function hmrSignal<T>(id: string, init: T): Accessor<T>;
  export function onHMRDispose(fn: () => void): void;
  export function hot<T = any>(path: string): Accessor<T | null>;
}
`;

const fsMap = new Map<string, string>();
const libFiles: string[] = [];
const DEFAULT_IMPORT_MAP = {
  'solid-js': 'https://esm.sh/solid-js@2.0.0-beta.4?dev',
  '@solidjs/web': 'https://esm.sh/@solidjs/web@2.0.0-beta.4?dev&external=solid-js',
};
const MANAGED_TYPE_PREFIXES = [
  '/node_modules/solid-js/',
  '/node_modules/@solidjs/web/',
];
const MANAGED_TYPE_FILES = [
  '/node_modules/solid-js/package.json',
  '/node_modules/@solidjs/web/package.json',
];

function clearManagedTypeFiles() {
  for (const path of Array.from(fsMap.keys())) {
    if (MANAGED_TYPE_FILES.includes(path) || MANAGED_TYPE_PREFIXES.some(prefix => path.startsWith(prefix))) {
      fsMap.delete(path);
    }
  }
}

function extractVersionFromImportUrl(url: string, packageName: string): string | null {
  if (packageName.includes('/')) {
    const basePackage = packageName.split('/')[0];
    const escapedBase = basePackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = url.match(new RegExp(`${escapedBase}@([^/?&]+)`));
    return match?.[1] || null;
  }
  const escapedPackage = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = url.match(new RegExp(`${escapedPackage}@([^?&/]+)`));
  return match?.[1] || null;
}

function parseEsmPackageVersion(url: string): { pkgName: string; version: string } | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('esm.sh')) return null;
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const match = pathname.match(/^(.+?)@([^/]+)$/);
    if (!match) return null;
    return { pkgName: match[1], version: match[2] };
  } catch {
    return null;
  }
}

async function fetchPackageJson(registry: string, pkg: string, version: string): Promise<any | null> {
  try {
    const response = await fetch(`${registry}/${pkg}@${version}/package.json`);
    if (response.ok) return await response.json();
  } catch {}
  return null;
}

async function fetchTypeFile(registry: string, pkg: string, version: string, path: string): Promise<string | null> {
  const url = path.startsWith('/') 
    ? `${registry}/${pkg}@${version}${path}`
    : `${registry}/${pkg}@${version}/${path}`;
    
  const isJsDelivr = registry.includes('cdn.jsdelivr.net');

  try {
    // Only jsdelivr supports ?raw to avoid processing
    const fetchUrl = isJsDelivr ? url + '?raw' : url;
    const response = await fetch(fetchUrl);
    if (response.ok) return await response.text();
  } catch {}
  
  // Fallback for jsdelivr without ?raw if needed
  if (isJsDelivr) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
    } catch {}
  }
  
  return null;
}

async function fetchSolidTypesFromESM(importMap: Record<string, string>) {
  const solidUrl = importMap['solid-js'];
  const webUrl = importMap['@solidjs/web'] || importMap['solid-js/web'];
  const storeUrl = importMap['solid-js/store'];
  
  let version = '2.0.0-beta.4';
  let webVersion = version;
  let storeVersion = version;
  
  if (solidUrl) {
    const detectedVersion = extractVersionFromImportUrl(solidUrl, 'solid-js');
    if (detectedVersion) version = detectedVersion;
  }
  
  if (webUrl) {
    let detectedVersion: string | null = null;
    if (webUrl.includes('@solidjs/web')) {
      detectedVersion = extractVersionFromImportUrl(webUrl, '@solidjs/web');
    } else if (webUrl.includes('/web')) {
      detectedVersion = extractVersionFromImportUrl(webUrl, 'solid-js/web');
    }
    if (detectedVersion) webVersion = detectedVersion;
  }

  if (storeUrl) {
    const detectedVersion = extractVersionFromImportUrl(storeUrl, 'solid-js/store');
    if (detectedVersion) storeVersion = detectedVersion;
  }
  
  // Fetch types for other packages in the import map (like three.js)
  for (const [pkgName, url] of Object.entries(importMap)) {
    if (pkgName === 'solid-js' || pkgName === '@solidjs/web' || pkgName === 'solid-js/web' || pkgName === 'solid-js/store' || pkgName === '@solidjs/signals') continue;

    const parsedPackage = parseEsmPackageVersion(url);
    if (parsedPackage) {
      await fetchPackageTypes(parsedPackage.pkgName, parsedPackage.version);
    }
  }
  
  const registries = ['https://cdn.jsdelivr.net/npm', 'https://esm.sh'];
  
  async function fetchWithFallback(pkg: string, ver: string, path: string): Promise<string | null> {
    for (const reg of registries) {
      const content = await fetchTypeFile(reg, pkg, ver, path);
      if (content) return content;
    }
    return null;
  }
  
  // Fetch main index.d.ts
  const mainTypes = await fetchWithFallback('solid-js', version, 'types/index.d.ts');
  if (mainTypes) {
    fsMap.set('/node_modules/solid-js/types/index.d.ts', mainTypes);
    
    // Extract all re-export paths from the main file
    const reExportMatches = mainTypes.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g);
    const typeFiles = new Set<string>(['types/index.d.ts']);
    
    for (const match of reExportMatches) {
      const exportPath = match[1];
      // Convert relative paths like "./jsx.js" to "types/jsx.d.ts"
      if (exportPath.startsWith('./')) {
        const baseName = exportPath.slice(2).replace(/\.js$/, '.d.ts');
        typeFiles.add(`types/${baseName}`);
      }
    }
    
    // Fetch all referenced type files
    for (const typeFile of typeFiles) {
      if (!fsMap.has(`/node_modules/solid-js/${typeFile}`)) {
        const content = await fetchWithFallback('solid-js', version, typeFile);
        if (content) {
          fsMap.set(`/node_modules/solid-js/${typeFile}`, content);
        }
      }
    }
    
    // Also fetch jsx.d.ts explicitly (it's the main JSX types file)
    if (!fsMap.has('/node_modules/solid-js/types/jsx.d.ts')) {
      const jsxTypes = await fetchWithFallback('solid-js', version, 'types/jsx.d.ts');
      if (jsxTypes) {
        fsMap.set('/node_modules/solid-js/types/jsx.d.ts', jsxTypes);
      }
    }
  }
  
  fsMap.set('/node_modules/solid-js/package.json', JSON.stringify({
    name: 'solid-js',
    version,
    types: './types/index.d.ts'
  }));
  
  // Create jsx-runtime package.json so TypeScript can find it
  fsMap.set('/node_modules/solid-js/jsx-runtime/package.json', JSON.stringify({
    name: 'solid-js/jsx-runtime',
    version,
    types: './index.d.ts',
    main: './index.js'
  }));
  
  // Get the JSX types content and use it for jsx-runtime
  const jsxRuntimeContent = fsMap.get('/node_modules/solid-js/types/jsx.d.ts') || '';
  fsMap.set('/node_modules/solid-js/jsx-runtime/index.d.ts', jsxRuntimeContent);

  async function fetchSolidSubpathTypes(subpath: 'web' | 'store', ver: string) {
    const isV1 = !ver.startsWith('2.');
    let content: string | null = null;
    
    if (subpath === 'web' && isV1) {
      const candidatePaths = [
        'web/types/index.d.ts',
        'web/types/client.d.ts',
        'types/web.d.ts',
        'web.d.ts',
        'types/index.d.ts',
      ];
      for (const candidate of candidatePaths) {
        content = await fetchWithFallback('solid-js', ver, candidate);
        if (content) {
          break;
        }
      }
      
      if (content) {
        const basePath = '/node_modules/solid-js/web';
        fsMap.set(`${basePath}/types/index.d.ts`, content);
        fsMap.set(`${basePath}/index.d.ts`, content);
        fsMap.set(`${basePath}/package.json`, JSON.stringify({
          name: 'solid-js/web',
          version: ver,
          types: './types/index.d.ts'
        }));
        
        // Extract and fetch re-exported files
        const reExportMatches = content.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g);
        for (const match of reExportMatches) {
          const exportPath = match[1];
          if (exportPath.startsWith('./')) {
            const baseName = exportPath.slice(2).replace(/\.js$/, '.d.ts');
            const typeFilePath = `web/types/${baseName}`;
            if (!fsMap.has(`${basePath}/types/${baseName}`)) {
              const subContent = await fetchWithFallback('solid-js', ver, typeFilePath);
              if (subContent) {
                fsMap.set(`${basePath}/types/${baseName}`, subContent);
                fsMap.set(`${basePath}/${baseName}`, subContent);
              }
            }
          }
        }
        return;
      }
    }
    
    if (subpath === 'store' && isV1) {
      const candidatePaths = [
        'store/types/index.d.ts',
        'types/store.d.ts',
        'store.d.ts',
        'types/index.d.ts',
      ];
      for (const candidate of candidatePaths) {
        content = await fetchWithFallback('solid-js', ver, candidate);
        if (content) {
          const basePath = '/node_modules/solid-js/store';
          fsMap.set(`${basePath}/types/index.d.ts`, content);
          fsMap.set(`${basePath}/index.d.ts`, content);
          fsMap.set(`${basePath}/package.json`, JSON.stringify({
            name: 'solid-js/store',
            version: ver,
            types: './types/index.d.ts'
          }));
          
          // Extract and fetch re-exported files
          const reExportMatches = content.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g);
          for (const match of reExportMatches) {
            const exportPath = match[1];
            if (exportPath.startsWith('./')) {
              const baseName = exportPath.slice(2).replace(/\.js$/, '.d.ts');
              const typeFilePath = `store/types/${baseName}`;
              if (!fsMap.has(`${basePath}/types/${baseName}`)) {
                const subContent = await fetchWithFallback('solid-js', ver, typeFilePath);
                if (subContent) {
                  fsMap.set(`${basePath}/types/${baseName}`, subContent);
                  fsMap.set(`${basePath}/${baseName}`, subContent);
                }
              }
            }
          }
          return;
        }
      }
    }
    
    const candidatePaths = [
      `${subpath}/types/index.d.ts`,
      `types/${subpath}.d.ts`,
      `${subpath}/index.d.ts`,
    ];

    for (const candidate of candidatePaths) {
      content = await fetchWithFallback('solid-js', ver, candidate);
      if (content) {
        fsMap.set(`/node_modules/solid-js/${subpath}/index.d.ts`, content);
        fsMap.set(`/node_modules/solid-js/${subpath}/package.json`, JSON.stringify({
          name: `solid-js/${subpath}`,
          version: ver,
          types: './index.d.ts'
        }));
        return;
      }
    }
  }

  const isV2 = webVersion.startsWith('2.');
  
  if (!isV2) {
    await fetchSolidSubpathTypes('web', webVersion);
    await fetchSolidSubpathTypes('store', storeVersion);
  }
  
  if (isV2) {
    const webTypes = await fetchWithFallback('@solidjs/web', webVersion, 'types/index.d.ts');
    if (webTypes) {
      fsMap.set('/node_modules/@solidjs/web/types/index.d.ts', webTypes);
      
      const reExportMatches = webTypes.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g);
      const typeFiles = new Set<string>(['types/index.d.ts']);
      
      for (const match of reExportMatches) {
        const exportPath = match[1];
        if (exportPath.startsWith('./')) {
          const baseName = exportPath.slice(2).replace(/\.js$/, '.d.ts');
          typeFiles.add(`types/${baseName}`);
        }
      }
      
      for (const typeFile of typeFiles) {
        if (!fsMap.has(`/node_modules/@solidjs/web/${typeFile}`)) {
          const content = await fetchWithFallback('@solidjs/web', webVersion, typeFile);
          if (content) {
            fsMap.set(`/node_modules/@solidjs/web/${typeFile}`, content);
          }
        }
      }
    }
    
    fsMap.set('/node_modules/@solidjs/web/package.json', JSON.stringify({
      name: '@solidjs/web',
      version: webVersion,
      types: './types/index.d.ts'
    }));
  } else {
    fsMap.delete('/node_modules/@solidjs/web/types/index.d.ts');
    fsMap.delete('/node_modules/@solidjs/web/package.json');
  }
}

async function fetchPackageTypes(pkgName: string, version: string) {
  const registries = ['https://cdn.jsdelivr.net/npm', 'https://esm.sh'];
  
  // Try to fetch package.json first to find types entry
  for (const reg of registries) {
    try {
      const pkgJsonUrl = `${reg}/${pkgName}@${version}/package.json`;
      const response = await fetch(pkgJsonUrl);
      if (response.ok) {
        const pkgJson = await response.json();
        const types = pkgJson.types || pkgJson.typings;
        
        if (types) {
          // Fetch the main types file
          const typesPath = types.startsWith('./') ? types.slice(2) : types;
          for (const reg of registries) {
            const typesUrl = `${reg}/${pkgName}@${version}/${typesPath}`;
            const typesResponse = await fetch(typesUrl);
            if (typesResponse.ok) {
              const typesContent = await typesResponse.text();
              const nodeModulesPath = `/node_modules/${pkgName}`;
              fsMap.set(`${nodeModulesPath}/package.json`, JSON.stringify(pkgJson));
              fsMap.set(`${nodeModulesPath}/${typesPath}`, typesContent);
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn(`LSP: Failed to fetch types for ${pkgName}:`, e);
    }
  }
}

const tsLibs = import.meta.glob("../../node_modules/typescript/lib/lib*.d.ts", {
  query: "?raw", import: "default",
  eager: true,
});

const solidjsSignalsLibs = import.meta.glob("../../node_modules/@solidjs/signals/**/*.d.ts", {
  query: "?raw", import: "default",
  eager: true,
});

for (const [path, content] of Object.entries(tsLibs)) {
  const fileName = path.split("/").pop()!;
  const virtualPath = `/node_modules/typescript/lib/${fileName}`;
  fsMap.set(virtualPath, content as string);
  libFiles.push(virtualPath);
}

for (const [path, content] of Object.entries(solidjsSignalsLibs)) {
  const virtualPath = path.replace("../../node_modules/", "/node_modules/");
  fsMap.set(virtualPath, content as string);
}
fsMap.set('/node_modules/@solidjs/signals/package.json', JSON.stringify({
  name: '@solidjs/signals',
  version: '0.12.0',
  types: './dist/types/index.d.ts',
}));

fsMap.set('/node_modules/playground:hmr.d.ts', playgroundHmrTypes);

let ts: any = null;
async function ensureTs() {
  if (!ts) {
    // @ts-ignore
    ts = await import(/* @vite-ignore */ "https://esm.sh/typescript@5.7.2");
  }
  return ts;
}

function createWorkerWrapper(fn: () => Promise<VirtualTypeScriptEnvironment>): any {
  let env: VirtualTypeScriptEnvironment | undefined;
  let result: any;
  let ataRunner: ((sourceFile: string) => Promise<void>) | undefined;
  let readyPromise: Promise<void> = Promise.resolve();
  let importMapSyncPromise: Promise<void> = Promise.resolve();
  
  const forbiddenModules = ["solid-js", "@solidjs/web", "@solidjs/signals"];

  const syncImportMapTypes = async (importMap: Record<string, string>) => {
    clearManagedTypeFiles();
    await fetchSolidTypesFromESM(importMap);

    if (!env) {
      return;
    }

    const filesToUpdate = [...MANAGED_TYPE_FILES, ...Array.from(fsMap.keys()).filter(key => MANAGED_TYPE_PREFIXES.some(prefix => key.startsWith(prefix)))];
    
    for (const path of filesToUpdate) {
      const content = fsMap.get(path);
      if (content) {
        env.createFile(path, content);
      }
    }
  };

  return {
    async initialize(customImportMap?: Record<string, string>) {
      readyPromise = (async () => {
        const importMap = customImportMap || DEFAULT_IMPORT_MAP;
        await syncImportMapTypes(importMap);
        
        const tsInstance = await ensureTs();

        ataRunner = setupTypeAcquisition({
          projectName: "solid-2-playground",
          typescript: tsInstance,
          logger: console,
          delegate: {
            receivedFile(code, path) {
              if (forbiddenModules.some(m => path.includes(m))) return;
              if (!fsMap.has(path)) {
                fsMap.set(path, code);
                env?.createFile(path, code);
              }
            },
            finished(files) {
              files.forEach((code, path) => {
                if (forbiddenModules.some(m => path.includes(m))) return;
                if (!fsMap.has(path)) {
                  fsMap.set(path, code);
                  env?.createFile(path, code);
                }
              });
            },
            errorMessage: (userFacingMessage, error) => {
              console.warn('ATA error:', userFacingMessage, error);
            },
          },
        });

        const envPromise = fn();
        result = createWorker(
          (async () => {
            env = await envPromise;
            return { env };
          })(),
        );
        await result.initialize();
      })();

      await readyPromise;
    },

    async updateFile(params: any) {
      await readyPromise;

      if (!env || !result) {
        console.warn('LSP: updateFile called before initialization');
        return;
      }
      
      try {
        const response = await result.updateFile(params);
        
        // Only run ATA if we have a runner and code
        if (ataRunner && params?.code) {
          try {
            await ataRunner(params.code);
          } catch (error) {
            console.warn("ATA run failed", error);
          }
        }
        
        return response;
      } catch (error) {
        console.error('LSP: updateFile error:', error);
        return;
      }
    },

    async getLints(params: any) {
      await readyPromise;
      return result?.getLints(params) || [];
    },
    async getAutocompletion(params: any) {
      await readyPromise;
      return result?.getAutocompletion(params) || null;
    },
    async getCompletionDetails(params: any) {
      await readyPromise;
      return result?.getCompletionDetails(params) || null;
    },
    async getHover(params: any) {
      await readyPromise;
      return result?.getHover(params) || null;
    },
    async deleteFile(path: string) {
      await readyPromise;
      return env?.deleteFile(path);
    },
    async ping() { return "pong"; },
    async getFsMap() {
      await readyPromise;
      return Array.from(fsMap.entries());
    },
    async ready() { await readyPromise; },
    async getVersion() {
      await ensureTs();
      return ts.version;
    },
    async getClassifications(path: string, start: number, length: number) {
      await readyPromise;
      if (!env) return null;
      try {
        return {
          syntactic: env.languageService.getEncodedSyntacticClassifications(path, { start, length }).spans,
          semantic: env.languageService.getEncodedSemanticClassifications(path, { start, length }).spans,
        };
      } catch (error) {
        console.error('LSP: getClassifications error:', error);
        return null;
      }
    },
    async updateImportMap(newImportMap: Record<string, string>) {
      await readyPromise;
      importMapSyncPromise = importMapSyncPromise.then(() => syncImportMapTypes(newImportMap));
      await importMapSyncPromise;
    }
  };
}

Comlink.expose(
  createWorkerWrapper(async function () {
    const tsInstance = await ensureTs();
    const system = createSystem(fsMap);
    
    const compilerOptions = {
      target: tsInstance.ScriptTarget.ESNext,
      module: tsInstance.ModuleKind.ESNext,
      moduleResolution: tsInstance.ModuleResolutionKind.Bundler,
      jsx: tsInstance.JsxEmit.Preserve,
      jsxImportSource: "solid-js",
      lib: ["esnext", "dom"],
      allowNonTsExtensions: true,
      baseUrl: "/",
      paths: {
        "solid-js": ["/node_modules/solid-js/types/index.d.ts"],
        "solid-js/*": ["/node_modules/solid-js/*", "/node_modules/solid-js/types/*"],
        "solid-js/web": ["/node_modules/solid-js/web/index.d.ts"],
        "solid-js/store": ["/node_modules/solid-js/store/index.d.ts"],
        "solid-js/jsx-runtime": ["/node_modules/solid-js/types/jsx.d.ts"],
        "solid-js/jsx-runtime/*": ["/node_modules/solid-js/types/jsx-runtime/*"],
        "@solidjs/web": ["/node_modules/@solidjs/web/types/index.d.ts"],
        "@solidjs/web/*": ["/node_modules/@solidjs/web/*", "/node_modules/@solidjs/web/types/*"],
        "@solidjs/signals": ["/node_modules/@solidjs/signals/dist/types/index.d.ts"],
        "@solidjs/signals/*": ["/node_modules/@solidjs/signals/dist/types/*", "/node_modules/@solidjs/signals/*"],
        "playground:hmr": ["/node_modules/playground:hmr.d.ts"]
      },
      typeRoots: ["/node_modules"],
      strict: true,
      skipLibCheck: true,
    };

    return createVirtualTypeScriptEnvironment(system, libFiles, tsInstance, compilerOptions);
  }),
);
