// @ts-nocheck
import type { CompletionContext } from "@codemirror/autocomplete";
import type { VirtualTypeScriptEnvironment } from "@typescript/vfs";
import * as ts from "typescript";
import type { RawCompletion, RawCompletionItem } from "../types";
import { DEFAULT_CODEMIRROR_TYPE_ICONS } from "./icons";
import { matchBefore } from "./matchBefore";

const TS_COMPLETE_BLOCKLIST: string[] = [
  "warning",
];

export async function getAutocompletion({
  env,
  path,
  context,
}: {
  env: VirtualTypeScriptEnvironment;
  path: string;
  /**
   * Allow this to be a subset of the full CompletionContext
   * object, because the raw object isn't serializable.
   */
  context: Pick<CompletionContext, "pos" | "explicit">;
}): Promise<RawCompletion | null> {
  const { pos, explicit } = context;
  const rawContents = env.getSourceFile(path)?.getFullText();

  if (!rawContents) return null;

  // If there's space behind the cursor, don't try and autocomplete.
  // https://codemirror.net/examples/autocompletion/
  let word = matchBefore(rawContents, pos, /\w*/);
  if (!word?.text) {
    word = matchBefore(rawContents, pos, /\./);
  }

  if (!word?.text && !explicit) return null;

  const completionInfo = env.languageService.getCompletionsAtPosition(
    path,
    pos,
    {
      includeCompletionsForModuleExports: true,
      includeCompletionsForImportStatements: true,
    },
    undefined,
  );

  // TODO: build ATA support for a 'loading' state
  // while types are being fetched
  if (!completionInfo) return null;

  const options = completionInfo.entries
    .filter((entry) => !TS_COMPLETE_BLOCKLIST.includes(entry.kind))
    .map((entry): RawCompletionItem => {
      let type = entry.kind ? String(entry.kind) : undefined;

      if (type === "member") type = "property";

      if (type && !DEFAULT_CODEMIRROR_TYPE_ICONS.has(type)) {
        type = undefined;
      }

      return {
        label: entry.name,
        type,
        // Carry over these properties so we can fetch details later
        source: entry.source,
        data: entry.data,
        hasAction: entry.hasAction,
      };
    });

  return {
    from: word ? (word.text === "." ? word.to : word.from) : pos,
    options,
  };
}

export async function getCompletionDetails({
  env,
  path,
  pos,
  name,
  source,
  data,
}: {
  env: VirtualTypeScriptEnvironment;
  path: string;
  pos: number;
  name: string;
  source?: string;
  data?: ts.CompletionEntryData;
}): Promise<RawCompletionItem | null> {
  const details = env.languageService.getCompletionEntryDetails(
    path,
    pos,
    name,
    undefined,
    source,
    undefined,
    data,
  );

  if (!details) return null;

  return {
    label: name,
    codeActions: details.codeActions,
    displayParts: details.displayParts ?? [],
    documentation: details.documentation,
    tags: details.tags,
  };
}
