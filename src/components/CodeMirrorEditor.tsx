import { onCleanup, onMount, createEffect } from 'solid-js';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';
import {
  tsFacet,
  tsSync,
  tsLinterWorker,
  tsAutocomplete,
  tsHover,
} from '../lib/codemirror-ts';
import { autocompletion } from '@codemirror/autocomplete';

interface EditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  fileName: string;
  lspWorker: any;
}

export default function Editor(props: EditorProps) {
  let editorParent: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  const getExtensions = () => {
    const extensions = [
      basicSetup,
      javascript({ typescript: true, jsx: true }),
      oneDark,
      EditorView.updateListener.of((v) => {
        if (v.docChanged) {
          props.onCodeChange(v.state.doc.toString());
        }
      }),
    ];

    if (props.lspWorker && (props.fileName.endsWith('.ts') || props.fileName.endsWith('.tsx'))) {
      extensions.push(
        tsFacet.of({
          worker: props.lspWorker.instance,
          path: props.fileName,
        }),
        tsSync(),
        tsLinterWorker(),
        autocompletion({ override: [tsAutocomplete()] }),
        tsHover(),
      );
    }

    return extensions;
  };

  onMount(() => {
    const startState = EditorState.create({
      doc: props.code,
      extensions: getExtensions(),
    });

    view = new EditorView({
      state: startState,
      parent: editorParent,
    });
  });

  createEffect(() => {
    // Reconfigure extensions if worker or fileName changes
    if (view) {
      view.setState(EditorState.create({
        doc: view.state.doc.toString(),
        extensions: getExtensions(),
      }));
    }
  });

  createEffect(() => {
    // Update doc if it changed externally (e.g. file switch)
    if (view && props.code !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.code },
      });
    }
  });

  onCleanup(() => {
    view?.destroy();
  });

  return <div ref={editorParent} class="h-full w-full" />;
}
