import { onCleanup, onMount, createEffect } from 'solid-js';
import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { Compartment, EditorState } from '@codemirror/state';
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
  lspWorker?: any;
  lspReady?: boolean;
  lspTypesVersion?: () => number;
}

export default function Editor(props: EditorProps) {
  let editorParent: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const lspCompartment = new Compartment();

  const getLspExtensions = () => {
    if (!props.lspReady || !props.lspWorker || (!props.fileName.endsWith('.ts') && !props.fileName.endsWith('.tsx'))) {
      return [];
    }

    return [
      tsFacet.of({
        worker: props.lspWorker.instance,
        path: props.fileName,
      }),
      tsSync(),
      tsLinterWorker(),
      autocompletion({ override: [tsAutocomplete()] }),
      tsHover(),
    ];
  };

  const getExtensions = () => {
    return [
      basicSetup,
      javascript({ typescript: true, jsx: true }),
      oneDark,
      EditorView.updateListener.of((v) => {
        if (v.docChanged) {
          props.onCodeChange(v.state.doc.toString());
        }
      }),
      lspCompartment.of(getLspExtensions()),
    ];
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
    // Reconfigure LSP-driven extensions without replacing the whole editor state.
    const lspTypesVersion = props.lspTypesVersion?.();
    const lspWorker = props.lspWorker;
    const lspReady = props.lspReady;
    const fileName = props.fileName;
    // Access these to track as dependencies
    void lspTypesVersion;
    void lspWorker;
    void lspReady;
    void fileName;
    if (view) {
      view.dispatch({
        effects: lspCompartment.reconfigure(getLspExtensions()),
      });
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
