
// @ts-ignore
import { transform } from '@babel/standalone';
// @ts-ignore
import solidPreset from 'babel-preset-solid';

const actualPreset = (solidPreset as any).default || solidPreset;

self.onmessage = async (e) => {
  if (e.data.files) {
    const { files, entry } = e.data;
    const compiledFiles: Record<string, string> = {};
    try {
      for (const [fileName, code] of Object.entries(files as Record<string, string>)) {
        console.log('Compiling:', fileName);
        const result = transform(code, {
          presets: [
            ['typescript', { isTSX: true, allExtensions: true }],
            [actualPreset, { 
              moduleName: '@solid-js/web',
              generate: 'dom', 
              hydratable: false 
            }],
          ],
          filename: fileName,
        });
        compiledFiles[fileName] = result.code || '';
      }
      console.log('Compilation successful');
      self.postMessage({ compiledFiles, entry });
    } catch (err: any) {
      console.error('Babel Transform Error:', err);
      self.postMessage({ error: err.message });
    }
    return;
  }

  const { code, fileName } = e.data;
  console.log('Compiling:', fileName);
  try {
    const result = transform(code, {
      presets: [
        ['typescript', { isTSX: true, allExtensions: true }],
        [actualPreset, { 
          moduleName: '@solid-js/web',
          generate: 'dom', 
          hydratable: false 
        }],
      ],
      filename: fileName,
    });
    console.log('Compilation successful');
    self.postMessage({ code: result.code });
  } catch (err: any) {
    console.error('Babel Transform Error:', err);
    self.postMessage({ error: err.message });
  }
};

