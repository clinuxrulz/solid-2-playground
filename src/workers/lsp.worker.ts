import {
  createSystem,
  createVirtualTypeScriptEnvironment,
  VirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import { setupTypeAcquisition } from "@typescript/ata";
import * as Comlink from "comlink";
import { createWorker } from "../lib/codemirror-ts/worker";

// Standard TypeScript library definitions
const tsLibs = import.meta.glob("../../node_modules/typescript/lib/lib*.d.ts", {
  query: "?raw", import: "default",
  eager: true,
});

// SolidJS 2.0 type definitions
const solidjsLibs = import.meta.glob("../../node_modules/solid-js-2/**/*.d.ts", {
  query: "?raw", import: "default",
  eager: true,
});

// SolidJS Web 2.0 type definitions
const solidjsWebLibs = import.meta.glob("../../node_modules/@solidjs/web-2/**/*.d.ts", {
  query: "?raw", import: "default",
  eager: true,
});

// SolidJS Signals 2.0 type definitions
const solidjsSignalsLibs = import.meta.glob("../../node_modules/@solidjs/signals/**/*.d.ts", {
  query: "?raw", import: "default",
  eager: true,
});

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

// 1. Populate standard libs
for (const [path, content] of Object.entries(tsLibs)) {
  const fileName = path.split("/").pop()!;
  const virtualPath = `/node_modules/typescript/lib/${fileName}`;
  fsMap.set(virtualPath, content as string);
  libFiles.push(virtualPath);
}

// 2. Populate SolidJS 2.0 libs
for (const [path, content] of Object.entries(solidjsLibs)) {
  const virtualPath = path.replace("../../node_modules/solid-js-2/", "/node_modules/solid-js/");
  fsMap.set(virtualPath, content as string);
}
fsMap.set("/node_modules/solid-js/package.json", JSON.stringify({
  name: "solid-js",
  version: "2.0.0-beta.2",
  types: "./types/index.d.ts",
}));

// 3. Populate @solidjs/web 2.0 libs
for (const [path, content] of Object.entries(solidjsWebLibs)) {
  const virtualPath = path.replace("../../node_modules/@solidjs/web-2/", "/node_modules/@solidjs/web/");
  fsMap.set(virtualPath, content as string);
}
fsMap.set("/node_modules/@solidjs/web/package.json", JSON.stringify({
  name: "@solidjs/web",
  version: "2.0.0-beta.2",
  types: "./types/index.d.ts",
}));

// 4. Populate SolidJS Signals libs
for (const [path, content] of Object.entries(solidjsSignalsLibs)) {
  const virtualPath = path.replace("../../node_modules/", "/node_modules/");
  fsMap.set(virtualPath, content as string);
}
fsMap.set("/node_modules/@solidjs/signals/package.json", JSON.stringify({
  name: "@solidjs/signals",
  version: "0.12.0",
  types: "./dist/types/index.d.ts",
}));

// 5. Add playground:hmr types
fsMap.set("/node_modules/playground:hmr.d.ts", playgroundHmrTypes);

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
  
  // Modules ATA is strictly forbidden from touching
  const forbiddenModules = ["solid-js", "@solidjs/web", "@solidjs/signals"];

  return {
    async initialize() {
      const tsInstance = await ensureTs();

      // Setup ATA with strict filters
      ataRunner = setupTypeAcquisition({
        projectName: "solid-2-playground",
        typescript: tsInstance,
        delegate: {
          receivedFile(code, path) {
            // CRITICAL: If ATA tries to download anything related to Solid, block it.
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
    },

    async updateFile(params: any) {
      if (!result) return;
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
    },

    // Standard LSP methods...
    async getLints(params: any) { return result?.getLints(params) || []; },
    async getAutocompletion(params: any) { return result?.getAutocompletion(params) || null; },
    async getHover(params: any) { return result?.getHover(params) || null; },
    async deleteFile(path: string) { return env?.deleteFile(path); },
    async ping() { return "pong"; },
    async getFsMap() { return Array.from(fsMap.entries()); },
    async getVersion() {
      await ensureTs();
      return ts.version;
    },
    async getClassifications(path: string, start: number, length: number) {
      if (!env) return null;
      return {
        syntactic: env.languageService.getEncodedSyntacticClassifications(path, { start, length }).spans,
        semantic: env.languageService.getEncodedSemanticClassifications(path, { start, length }).spans,
      };
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
        "solid-js/*": ["/node_modules/solid-js/types/*", "/node_modules/solid-js/*"],
        "@solidjs/web": ["/node_modules/@solidjs/web/types/index.d.ts"],
        "@solidjs/web/*": ["/node_modules/@solidjs/web/types/*", "/node_modules/@solidjs/web/*"],
        "@solidjs/signals": ["/node_modules/@solidjs/signals/dist/types/index.d.ts"],
        "@solidjs/signals/*": ["/node_modules/@solidjs/signals/dist/types/*", "/node_modules/@solidjs/signals/*"],
        "playground:hmr": ["/node_modules/playground:hmr.d.ts"]
      },
      // Force TS to stay within our virtual node_modules
      typeRoots: ["/node_modules"],
      strict: true,
      skipLibCheck: true,
    };

    return createVirtualTypeScriptEnvironment(system, libFiles, tsInstance, compilerOptions);
  }),
);
