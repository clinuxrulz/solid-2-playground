import { Show, lazy, Suspense } from 'solid-js';
import CodeMirrorEditor from './CodeMirrorEditor';
import { EditorType } from '../lib/device';

const MonacoEditor = lazy(() => import('./MonacoEditor'));
const NetVimEditor = lazy(() => import('./NetVimEditor'));

interface EditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker: any;
  allFiles: string[];
  editorType: EditorType;
  onEditorTypeChange: (type: EditorType) => void;
}

export default function Editor(props: EditorProps) {
  const handleEditorChange = (e: Event) => {
    const type = (e.target as HTMLSelectElement).value as EditorType;
    props.onEditorTypeChange(type);
  };

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="hidden md:flex items-center justify-end px-2 py-1 bg-[#2d2d2d] border-b border-[#333333] shrink-0">
        <label class="text-[10px] text-gray-400 mr-2 uppercase font-medium">Editor:</label>
        <select 
          value={props.editorType} 
          onInput={handleEditorChange}
          class="bg-[#3c3c3c] text-white text-[11px] px-1 py-0.5 rounded border border-[#444444] focus:outline-none focus:border-[#007acc]"
        >
          <option value="monaco">Monaco</option>
          <option value="codemirror">CodeMirror</option>
          <option value="net-vim">net-vim</option>
        </select>
      </div>
      <div class="flex-1 overflow-hidden relative">
        <Show 
          when={props.editorType === 'monaco'} 
          fallback={
            <Show when={props.editorType === 'net-vim'} fallback={
              <CodeMirrorEditor 
                code={props.code} 
                onCodeChange={props.onCodeChange} 
                fileName={props.fileName} 
                lspWorker={props.lspWorker} 
              />
            }>
               <Suspense fallback={<div class="p-4 text-gray-400">Loading Net-Vim...</div>}>
                <NetVimEditor 
                  code={props.code} 
                  onCodeChange={props.onCodeChange} 
                  fileName={props.fileName} 
                  lspWorker={props.lspWorker} 
                />
              </Suspense>
            </Show>
          }
        >
          <Suspense fallback={<div class="p-4 text-gray-400">Loading Monaco...</div>}>
            <MonacoEditor 
              code={props.code} 
              onCodeChange={props.onCodeChange} 
              fileName={props.fileName} 
              lspWorker={props.lspWorker}
              allFiles={props.allFiles}
            />
          </Suspense>
        </Show>
      </div>
    </div>
  );
}
