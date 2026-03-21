export interface BridgeFS {
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
  listDirectory: (path: string) => Promise<string[]>;
  isDirectory: (path: string) => Promise<boolean>;
}

export interface BridgeConfig {
  host: string;
  port: string;
  key: string;
  baseUrl: string;
}

export function createBridgeFS(config: BridgeConfig): BridgeFS {
  const headers = {
    'X-Bridge-Key': config.key
  };

  return {
    readFile: async (path: string) => {
      try {
        const response = await fetch(`${config.baseUrl}/cat?path=${encodeURIComponent(path)}`, { headers });
        if (response.status === 404) return null;
        if (response.status === 401) { console.error("Bridge Error: Unauthorized (Invalid Key)"); return null; }
        if (!response.ok) return null;
        return await response.text();
      } catch (err: any) {
        if (err.name !== 'TypeError') {
          console.error('BridgeFS readFile error: ' + err.message);
        }
        return null;
      }
    },
    writeFile: async (path: string, content: string) => {
      try {
        const response = await fetch(`${config.baseUrl}/write?path=${encodeURIComponent(path)}`, {
          method: 'POST',
          body: content,
          headers
        });
        if (response.status === 401) { console.error("Bridge Error: Unauthorized (Invalid Key)"); throw new Error("Unauthorized"); }
        if (!response.ok) throw new Error(await response.text());
      } catch (err: any) {
        console.error('BridgeFS writeFile error: ' + err.message);
        throw err;
      }
    },
    listDirectory: async (path: string) => {
      try {
        const response = await fetch(`${config.baseUrl}/ls?path=${encodeURIComponent(path)}`, { headers });
        if (response.status === 401) { console.error("Bridge Error: Unauthorized (Invalid Key)"); return []; }
        if (!response.ok) throw new Error(await response.text());
        return await response.json();
      } catch (err: any) {
        console.error('BridgeFS listDirectory error: ' + err.message);
        return [];
      }
    },
    isDirectory: async (path: string) => {
      try {
        const response = await fetch(`${config.baseUrl}/is_dir?path=${encodeURIComponent(path)}`, { headers });
        if (response.status === 401) { console.error("Bridge Error: Unauthorized (Invalid Key)"); return false; }
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        return data.is_dir;
      } catch (err: any) {
        console.error('BridgeFS isDirectory error: ' + err.message);
        return false;
      }
    }
  };
}
