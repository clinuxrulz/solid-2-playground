export async function getFileHandle(fileName: string, create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle(fileName, { create });
}

export async function readFile(fileName: string): Promise<string | null> {
  try {
    const handle = await getFileHandle(fileName);
    const file = await handle.getFile();
    return await file.text();
  } catch (e) {
    return null;
  }
}

export async function writeFile(fileName: string, content: string) {
  const handle = await getFileHandle(fileName, true);
  const writable = await (handle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function listFiles(): Promise<string[]> {
  const root = await navigator.storage.getDirectory();
  const files: string[] = [];
  for await (const entry of (root as any).values()) {
    if (entry.kind === 'file') {
      files.push(entry.name);
    }
  }
  return files;
}

export async function deleteFile(fileName: string) {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(fileName);
}
