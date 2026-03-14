import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

interface PreviewProps {
  code: string;
  importMap?: string;
  compiledFiles?: Record<string, string>;
  entryFile?: string;
}

export default function Preview(props: PreviewProps) {
  let iframeRef: HTMLIFrameElement | undefined;
  let iframeUrl: string | null = null;
  let moduleUrls: string[] = [];
  const [error, setError] = createSignal<string | null>(null);

  const revokeModuleUrls = () => {
    for (const url of moduleUrls) {
      URL.revokeObjectURL(url);
    }
    moduleUrls = [];
  };

  const updateIframe = () => {
    if (!iframeRef) return;
    const doc = iframeRef.contentDocument;
    if (!doc) return;

    const defaultImportMap = {
      "imports": {
        "solid-js": "https://esm.sh/solid-js@2.0.0-beta.2?dev",
        "@solidjs/web": "https://esm.sh/@solidjs/web@2.0.0-beta.2?dev&external=solid-js"
      }
    };

    let importMapObj = { ...defaultImportMap } as any;
    if (props.importMap) {
      try {
        const parsed = JSON.parse(props.importMap);
        if (parsed?.imports && typeof parsed.imports === 'object') {
          importMapObj.imports = {
            ...defaultImportMap.imports,
            ...parsed.imports,
          };
        }
      } catch (e) {
        console.warn('Invalid import map JSON, using defaults', e);
      }
    }

    if (props.compiledFiles) {
      revokeModuleUrls();
      for (const [moduleKey, moduleCode] of Object.entries(props.compiledFiles)) {
        const moduleBlob = new Blob([moduleCode], { type: 'application/javascript' });
        const moduleUrl = URL.createObjectURL(moduleBlob);
        moduleUrls.push(moduleUrl);
        importMapObj.imports[moduleKey] = moduleUrl;
      }
    }

    const entry = props.entryFile || '';
    const moduleScript = (props.compiledFiles && props.entryFile && props.compiledFiles[props.entryFile])
      ? `import '${entry}';`
      : props.code;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <script type="importmap">
            ${JSON.stringify(importMapObj)}
          </script>
          <style>
            body { font-family: sans-serif; margin: 0; }
            #root { min-height: 100vh; }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script>
            window.onerror = function(message, source, lineno, colno, error) {
              window.parent.postMessage({ type: 'error', message: message }, '*');
            };
            window.onunhandledrejection = function(event) {
              window.parent.postMessage({ type: 'error', message: event.reason?.message || event.reason }, '*');
            };
          </script>
          <script type="module">
            ${props.code}
          </script>
        </body>
      </html>
    `;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    if (iframeUrl) {
      URL.revokeObjectURL(iframeUrl);
    }
    iframeUrl = url;

    iframeRef.src = url;
  };

  createEffect(() => {
    updateIframe();
  });

  onCleanup(() => {
    if (iframeUrl) {
      URL.revokeObjectURL(iframeUrl);
      iframeUrl = null;
    }
    revokeModuleUrls();
  });

  // Listen for errors from the iframe
  onMount(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'error') {
        setError(e.data.message);
      } else {
        setError(null);
      }
    };
    window.addEventListener('message', handleMessage);
    onCleanup(() => window.removeEventListener('message', handleMessage));
  });

  return (
    <div class="h-full w-full relative">
      <iframe
        ref={iframeRef}
        class="h-full w-full border-0 bg-white"
        title="preview"
      />
      {error() && (
        <div class="absolute bottom-0 left-0 right-0 bg-red-500 text-white p-2 text-xs">
          {error()}
        </div>
      )}
    </div>
  );
}
