
// @ts-ignore
import { transform } from '@babel/standalone';
import ts from 'typescript';

let solidPreset: any = null;
let presetLoadFailed = false;

const VERSION_MAP: Record<string, string> = {
  '2.0.0-beta.2': '2.0.0-beta.4',
};

const SOLID_V1_PRESET_VERSION = '1.9.12';

const MISSING_EXPORTS_SHIM = `
if (typeof globalThis !== 'undefined' && !globalThis._solidShimmed) {
  globalThis._solidShimmed = true;
  const origImport = globalThis.__import__;
  globalThis.__import__ = function(mod, ...args) {
    if (mod === 'solid-js' || mod?.startsWith('solid-js/')) {
      try {
        const m = origImport ? origImport(mod, ...args) : (origImport && origImport.call && origImport(mod)) || {};
        if (!m.enforceLoadingBoundary) {
          m.enforceLoadingBoundary = () => {};
        }
        return m;
      } catch (e) {
        return {};
      }
    }
    return origImport ? origImport(mod, ...args) : {};
  };
}
`;

function getCompatiblePresetVersion(solidVersion: string): string {
  if (VERSION_MAP[solidVersion]) {
    return VERSION_MAP[solidVersion];
  }
  if (!isVersion2OrHigher(solidVersion)) {
    return SOLID_V1_PRESET_VERSION;
  }
  return solidVersion;
}

function needsShim(solidVersion: string): boolean {
  return solidVersion === '2.0.0-beta.2';
}

function isVersion2OrHigher(version: string): boolean {
  const clean = version.replace(/-beta\.\d+/, '').replace(/-alpha\.\d+/, '').replace(/-rc\.\d+/, '');
  const parts = clean.split('.').map(Number);
  return parts[0] >= 2;
}

async function loadPreset(version: string) {
  if (presetLoadFailed) {
    throw new Error('Failed to load babel-preset-solid from esm.sh');
  }
  
  if (solidPreset) return solidPreset;
  
  const presetVersion = getCompatiblePresetVersion(version);
  
  try {
    const module = await import(/* @vite-ignore */ `https://esm.sh/babel-preset-solid@${presetVersion}?deps&external=@babel/core,@babel/plugin-transform-react-jsx,babel-plugin-solid`);
    solidPreset = module.default || module;
    
    if (typeof solidPreset !== 'function' && solidPreset?.default) {
      solidPreset = solidPreset.default;
    }
    
    return solidPreset;
  } catch (err) {
    presetLoadFailed = true;
    throw new Error('Failed to load babel-preset-solid from esm.sh: ' + (err as Error).message);
  }
}

function extractImports(code: string, fileName: string) {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const hotImports: string[] = [];
  
  function getSpecifier(node: ts.Node): string | null {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const text = getSpecifier(node.moduleSpecifier);
        if (text) imports.push(text);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0];
        if (specifier) {
          const text = getSpecifier(specifier);
          if (text) imports.push(text);
        }
      } else {
        let isHot = false;
        if (ts.isIdentifier(node.expression) && node.expression.text === 'hot') {
          isHot = true;
        } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hot') {
          isHot = true;
        }

        if (isHot) {
          const specifier = node.arguments[0];
          if (specifier) {
            const text = getSpecifier(specifier);
            if (text) hotImports.push(text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return { imports, hotImports };
}

function transformImports(code: string, fileName: string, mapping: Record<string, string>, hotMapping: Record<string, string>): string {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  
  function getSpecifier(node: ts.Node): string | null {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
  }

  const transformer = (context: ts.TransformationContext) => {
    return (rootNode: ts.SourceFile) => {
      const visit = (node: ts.Node): ts.Node => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) {
            const specifier = getSpecifier(node.moduleSpecifier);
            if (specifier && mapping[specifier]) {
              const newSpecifier = ts.factory.createStringLiteral(mapping[specifier]);
              if (ts.isImportDeclaration(node)) {
                return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, newSpecifier, node.attributes);
              } else {
                return ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, newSpecifier, node.attributes);
              }
            }
          }
        }
        if (ts.isCallExpression(node)) {
          const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
          let isHot = false;
          if (ts.isIdentifier(node.expression) && node.expression.text === 'hot') {
            isHot = true;
          } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hot') {
            isHot = true;
          }
          
          if (isImport || isHot) {
            const specifier = node.arguments[0];
            if (specifier) {
              const text = getSpecifier(specifier);
              if (text) {
                const map = isHot ? hotMapping : mapping;
                if (map[text]) {
                  return ts.factory.updateCallExpression(
                    node,
                    node.expression,
                    node.typeArguments,
                    [ts.factory.createStringLiteral(map[text])]
                  );
                }
              }
            }
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(rootNode, visit) as ts.SourceFile;
    };
  };

  const result = ts.transform(sourceFile, [transformer]);
  const printer = ts.createPrinter();
  return printer.printFile(result.transformed[0]);
}

function extractVersionFromImportMap(importMap: string): { solidVersion: string; presetVersion: string; needsShim: boolean; moduleName: string } {
  try {
    const map = JSON.parse(importMap);
    const solidUrl = map.imports?.['solid-js'];
    if (solidUrl) {
      const match = solidUrl.match(/solid-js@([\d.]+(?:-beta\.\d+)?)/);
      if (match) {
        const solidVersion = match[1];
        const presetVersion = getCompatiblePresetVersion(solidVersion);
        return {
          solidVersion,
          presetVersion,
          needsShim: needsShim(solidVersion),
          moduleName: isVersion2OrHigher(solidVersion) ? '@solidjs/web' : 'solid-js/web',
        };
      }
    }
  } catch {}
  return { solidVersion: '2.0.0-beta.4', presetVersion: '2.0.0-beta.4', needsShim: false, moduleName: '@solidjs/web' };
}

self.onmessage = async (e) => {
  const { type, data } = e.data;
  const messageData = type ? data : e.data;
  const messageType = type || (messageData.files ? 'COMPILE_ALL' : 'COMPILE_SINGLE');

  if (messageType === 'SET_IMPORT_MAP') {
    const { importMap } = messageData;
    const { presetVersion, solidVersion, needsShim: shim } = extractVersionFromImportMap(importMap);
    try {
      solidPreset = null;
      presetLoadFailed = false;
      await loadPreset(presetVersion);
      self.postMessage({ type: 'PRESET_LOADED', version: presetVersion, solidVersion, shim });
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
    return;
  }

  if (messageType === 'COMPILE_ALL') {
    const { files, entry, importMap } = messageData;
    const compiledFiles: Record<string, { code: string, imports: string[], hotImports: string[] }> = {};
    
    let preset = solidPreset;
    let needsShim = false;
    let moduleName = '@solidjs/web';
    if (!preset) {
      const versionInfo = importMap ? extractVersionFromImportMap(importMap) : { presetVersion: '2.0.0-beta.4', solidVersion: '2.0.0-beta.4', needsShim: false, moduleName: '@solidjs/web' };
      preset = await loadPreset(versionInfo.presetVersion);
      needsShim = versionInfo.needsShim;
      moduleName = versionInfo.moduleName;
    } else if (importMap) {
      moduleName = extractVersionFromImportMap(importMap).moduleName;
    }
    
    const actualPreset = preset?.default || preset;
    
    try {
      for (const [fileName, code] of Object.entries(files as Record<string, string>)) {
        let compiledCode = '';
        try {
          const result = transform(code, {
            presets: [
              ['typescript', { isTSX: true, allExtensions: true }],
              [actualPreset, { moduleName, generate: 'dom', hydratable: false }],
            ],
            filename: fileName,
          });
          compiledCode = result.code || '';
        } catch (transformErr: any) {
          self.postMessage({ type: 'ERROR', error: `Transform error in ${fileName}: ${transformErr.message}` });
          continue;
        }
        const { imports, hotImports } = extractImports(compiledCode, fileName);
        compiledFiles[fileName] = { code: compiledCode, imports, hotImports };
      }
      self.postMessage({ type: 'COMPILED_ALL', compiledFiles, entry, needsShim });
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
    return;
  }

  if (messageType === 'TRANSFORM_IMPORTS') {
    const { fileName, code, mapping, hotMapping } = messageData;
    try {
      const transformedCode = transformImports(code, fileName, mapping, hotMapping || {});
      self.postMessage({ type: 'TRANSFORMED', fileName, code: transformedCode });
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  }
};
