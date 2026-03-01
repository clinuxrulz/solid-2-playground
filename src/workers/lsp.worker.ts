import {
  createSystem,
  createVirtualTypeScriptEnvironment,
  VirtualTypeScriptEnvironment,
} from "@typescript/vfs";
import * as Comlink from "comlink";
import { createWorker } from "../lib/codemirror-ts/worker";

// Standard TypeScript library definitions
const tsLibs = import.meta.glob("../../node_modules/typescript/lib/lib*.d.ts", {
  as: "raw",
  eager: true,
});

// SolidJS 2.0 type definitions
const solidjsLibs = import.meta.glob("../../node_modules/solid-js-2/**/*.d.ts", {
  as: "raw",
  eager: true,
});

// SolidJS Web 2.0 type definitions
const solidjsWebLibs = import.meta.glob("../../node_modules/@solidjs/web-2/**/*.d.ts", {
  as: "raw",
  eager: true,
});

const fsMap = new Map<string, string>();
const libFiles: string[] = [];

// Populate standard libs
for (const [path, content] of Object.entries(tsLibs)) {
  const fileName = path.split("/").pop()!;
  const virtualPath = `/node_modules/typescript/lib/${fileName}`;
  fsMap.set(virtualPath, content as string);
  fsMap.set(`/lib/${fileName}`, content as string);
  fsMap.set(`/${fileName}`, content as string);
  libFiles.push(virtualPath);
}

// Populate SolidJS libs
for (const [path, content] of Object.entries(solidjsLibs)) {
  const virtualPath = path.replace("../../node_modules/solid-js-2/", "/node_modules/solid-js/");
  fsMap.set(virtualPath, content as string);
}

// Add a package.json for solid-js
fsMap.set("/node_modules/solid-js/package.json", JSON.stringify({
  name: "solid-js",
  version: "2.0.0-experimental.15",
  types: "./types/index.d.ts",
}));

// Populate SolidJS Web libs
for (const [path, content] of Object.entries(solidjsWebLibs)) {
  const virtualPath = path.replace("../../node_modules/@solidjs/web-2/", "/node_modules/@solidjs/web/");
  fsMap.set(virtualPath, content as string);
}

// Add a package.json for @solidjs/web
fsMap.set("/node_modules/@solidjs/web/package.json", JSON.stringify({
  name: "@solidjs/web",
  version: "2.0.0-experimental.15",
  types: "./types/index.d.ts",
}));

let ts: any = null;

async function ensureTs() {
  if (!ts) {
    ts = await import(/* @vite-ignore */ "https://esm.sh/typescript@5.7.2");
  }
  return ts;
}

function createWorkerWrapper(
  fn: () => Promise<VirtualTypeScriptEnvironment>,
): any {
  let env: VirtualTypeScriptEnvironment | undefined;
  let result: any;

  return {
    async initialize() {
      const tsInstance = await ensureTs();
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
      return result.updateFile(params);
    },
    async getLints(params: any) {
      if (!result) return [];
      return result.getLints(params);
    },
    async getAutocompletion(params: any) {
      if (!result) return null;
      return result.getAutocompletion(params);
    },
    async getHover(params: any) {
      if (!result) return null;
      return result.getHover(params);
    },
    async deleteFile(path: string) {
      return env?.deleteFile(path);
    },
    async getVersion() {
      await ensureTs();
      return ts.version;
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
        "solid-js/web": ["/node_modules/@solidjs/web/types/index.d.ts"],
      }
    };
    // Adding standard libraries to rootFiles to ensure they are loaded
    return createVirtualTypeScriptEnvironment(system, libFiles, tsInstance, compilerOptions);
  }),
);
