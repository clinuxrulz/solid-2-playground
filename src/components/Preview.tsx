import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

interface PreviewProps {
  code: string;
  importMap?: string;
}

export default function Preview(props: PreviewProps) {
  let iframeRef: HTMLIFrameElement | undefined;
  const [error, setError] = createSignal<string | null>(null);

  const updateIframe = () => {
    if (!iframeRef) return;
    const doc = iframeRef.contentDocument;
    if (!doc) return;

    const defaultImportMap = {
      "imports": {
        "solid-js": "https://esm.sh/solid-js@2.0.0-beta.2?dev",
        "@solid-js/web": "https://esm.sh/@solidjs/web@2.0.0-beta.2?dev&external=solid-js"
      }
    };

    let importMapContent = props.importMap;
    if (!importMapContent) {
      importMapContent = JSON.stringify(defaultImportMap);
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <script type="importmap">
            ${importMapContent}
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
    iframeRef.src = url;
    
    // Cleanup the previous URL
    const oldUrl = iframeRef.dataset.url;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    iframeRef.dataset.url = url;
  };

  createEffect(() => {
    updateIframe();
  });

  onCleanup(() => {
    if (iframeRef?.dataset.url) {
      URL.revokeObjectURL(iframeRef.dataset.url);
    }
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
