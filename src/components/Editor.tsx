import { createSignal, Show, lazy, Suspense } from 'solid-js';
import CodeMirrorEditor from './CodeMirrorEditor';
import { getInitialEditorType, EditorType } from '../lib/device';

const MonacoEditor = lazy(() => import('./MonacoEditor'));

interface EditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker: any;
}

export default function Editor(props: EditorProps) {
  const [editorType, setEditorType] = createSignal<EditorType>(getInitialEditorType());

  const handleEditorChange = (e: Event) => {
    const type = (e.target as HTMLSelectElement).value as EditorType;
    setEditorType(type);
    localStorage.setItem('preferred-editor', type);
  };

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="flex items-center justify-end px-2 py-1 bg-[#2d2d2d] border-b border-[#333333] shrink-0">
        <label class="text-[10px] text-gray-400 mr-2 uppercase font-medium">Editor:</label>
        <select 
          value={editorType()} 
          onInput={handleEditorChange}
          class="bg-[#3c3c3c] text-white text-[11px] px-1 py-0.5 rounded border border-[#444444] focus:outline-none focus:border-[#007acc]"
        >
          <option value="monaco">Monaco</option>
          <option value="codemirror">CodeMirror</option>
        </select>
      </div>
      <div class="flex-1 overflow-hidden relative">
        <Show 
          when={editorType() === 'monaco'} 
          fallback={
            <CodeMirrorEditor 
              code={props.code} 
              onCodeChange={props.onCodeChange} 
              fileName={props.fileName} 
              lspWorker={props.lspWorker} 
            />
          }
        >
          <Suspense fallback={<div class="p-4 text-gray-400">Loading Monaco...</div>}>
            <MonacoEditor 
              code={props.code} 
              onCodeChange={props.onCodeChange} 
              fileName={props.fileName} 
            />
          </Suspense>
        </Show>
      </div>
    </div>
  );
}
