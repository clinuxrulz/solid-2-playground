
// @ts-ignore
import { transform } from '@babel/standalone';
// @ts-ignore
import solidPreset from 'babel-preset-solid';
import ts from 'typescript';

const actualPreset = (solidPreset as any).default || solidPreset;

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
        // Handle hot() calls
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
        // Handle standard imports/exports
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
        // Handle dynamic import() and hot() calls
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

self.onmessage = async (e) => {
  const { type, data } = e.data;
  const messageData = type ? data : e.data;
  const messageType = type || (messageData.files ? 'COMPILE_ALL' : 'COMPILE_SINGLE');

  if (messageType === 'COMPILE_ALL') {
    const { files, entry } = messageData;
    const compiledFiles: Record<string, { code: string, imports: string[], hotImports: string[] }> = {};
    try {
      for (const [fileName, code] of Object.entries(files as Record<string, string>)) {
        const result = transform(code, {
          presets: [
            ['typescript', { isTSX: true, allExtensions: true }],
            [actualPreset, { moduleName: '@solidjs/web', generate: 'dom', hydratable: false }],
          ],
          filename: fileName,
        });
        const compiledCode = result.code || '';
        const { imports, hotImports } = extractImports(compiledCode, fileName);
        compiledFiles[fileName] = { code: compiledCode, imports, hotImports };
      }
      self.postMessage({ type: 'COMPILED_ALL', compiledFiles, entry });
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
