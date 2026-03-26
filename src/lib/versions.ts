export interface VersionInfo {
  version: string;
  solidJs: string;
  solidWeb: string;
}

const JSDELIVR_REGISTRY = 'https://data.jsdelivr.com/v1/package/npm/solid-js';

const RECOMMENDED_VERSIONS = [
  '2.0.0',
  '2.0.0-beta.4',
  '2.0.0-beta.3',
  '2.0.0-beta.2',
  '2.0.0-beta.1',
  '2.0.0-beta.0',
  '2.0.0-alpha.1',
  '1.9.11',
  '1.9.10',
  '1.9.9',
  '1.9.8',
  '1.9.7',
  '1.9.6',
  '1.9.5',
  '1.9.4',
  '1.9.3',
  '1.9.2',
  '1.9.1',
  '1.9.0',
  '1.8.5',
  '1.8.4',
  '1.8.3',
  '1.8.2',
  '1.8.1',
  '1.8.0',
  '1.7.11',
  '1.7.10',
  '1.7.9',
  '1.7.8',
  '1.7.7',
  '1.7.6',
];

export async function fetchSolidVersions(): Promise<string[]> {
  try {
    const response = await fetch(JSDELIVR_REGISTRY);
    
    if (!response.ok) {
      throw new Error(`jsdelivr error: ${response.status}`);
    }
    
    const data = await response.json();
    const versions = data.versions || [];
    
    const sortedVersions = versions.sort((a: string, b: string) => {
      const parse = (v: string) => {
        const clean = v.replace(/-beta\.\d+/, '').replace(/-alpha\.\d+/, '').replace(/-rc\.\d+/, '').replace(/-experimental\.\d+/, '');
        const parts = clean.split('.').map(Number);
        return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
      };
      return parse(b) - parse(a);
    });
    
    return sortedVersions;
  } catch (error) {
    console.warn('Failed to fetch versions from jsdelivr, using defaults:', error);
    return RECOMMENDED_VERSIONS;
  }
}

export async function fetchSolidBetaVersions(): Promise<string[]> {
  try {
    const response = await fetch(JSDELIVR_REGISTRY);
    
    if (!response.ok) {
      throw new Error(`jsdelivr error: ${response.status}`);
    }
    
    const data = await response.json();
    const versions = data.versions || [];
    
    const betaVersions = versions
      .filter((v: string) => v.includes('beta') || v.includes('alpha') || v.includes('rc'))
      .sort((a: string, b: string) => {
        const parse = (v: string) => {
          const pre = v.match(/-(beta|alpha|rc)\.(\d+)/);
          if (pre) {
            const preType = pre[1] === 'beta' ? 2 : pre[1] === 'alpha' ? 1 : 3;
            return (parseInt(pre[2]) || 0) + preType * 1000;
          }
          return 0;
        };
        return parse(b) - parse(a);
      });
    
    return betaVersions;
  } catch (error) {
    console.warn('Failed to fetch beta versions:', error);
    return RECOMMENDED_VERSIONS.filter(v => v.includes('beta') || v.includes('alpha'));
  }
}

export async function fetchAllSolidVersionsFromNpm(): Promise<string[]> {
  try {
    const response = await fetch(JSDELIVR_REGISTRY);
    
    if (!response.ok) {
      throw new Error(`jsdelivr error: ${response.status}`);
    }
    
    const data = await response.json();
    const versions = data.versions || [];
    
    const sorted = versions.sort((a: string, b: string) => {
      const parse = (v: string) => {
        const clean = v.replace(/-beta\.\d+/, '').replace(/-alpha\.\d+/, '').replace(/-rc\.\d+/, '').replace(/-experimental\.\d+/, '');
        const parts = clean.split('.').map(Number);
        let score = parts[0] * 1000000 + parts[1] * 1000 + parts[2];
        
        if (v.includes('beta')) score += 10000000;
        if (v.includes('alpha')) score += 5000000;
        if (v.includes('rc')) score += 8000000;
        if (v.includes('experimental')) score += 9000000;
        
        const match = v.match(/-beta\.(\d+)/);
        if (match) score += parseInt(match[1]);
        
        return score;
      };
      return parse(b) - parse(a);
    });
    
    return sorted;
  } catch (error) {
    console.warn('Failed to fetch all versions from jsdelivr:', error);
    return RECOMMENDED_VERSIONS;
  }
}

export async function fetchAllSolidVersions(): Promise<string[]> {
  // Try to fetch all versions directly from jsdelivr (more reliable)
  const jsdelivrVersions = await fetchAllSolidVersionsFromNpm();
  
  // If we got a good number of versions, use those
  if (jsdelivrVersions.length > 10) {
    return jsdelivrVersions;
  }
  
  // Fallback to combining search results
  const [stable, beta] = await Promise.all([
    fetchSolidVersions(),
    fetchSolidBetaVersions(),
  ]);
  
  const combined = new Set([...beta, ...stable]);
  
  const sorted = Array.from(combined).sort((a, b) => {
    const parse = (v: string) => {
      const clean = v.replace(/-beta\.\d+/, '').replace(/-alpha\.\d+/, '').replace(/-rc\.\d+/, '').replace(/-experimental\.\d+/, '');
      const parts = clean.split('.').map(Number);
      let score = parts[0] * 1000000 + parts[1] * 1000 + parts[2];
      
      if (v.includes('beta')) score += 10000000;
      if (v.includes('alpha')) score += 5000000;
      if (v.includes('rc')) score += 8000000;
      if (v.includes('experimental')) score += 9000000;
      
      const match = v.match(/-beta\.(\d+)/);
      if (match) score += parseInt(match[1]);
      
      return score;
    };
    return parse(b) - parse(a);
  });
  
  return sorted;
}

export function formatVersion(version: string): string {
  if (version.includes('beta')) return `Beta ${version.match(/beta\.\d+/)?.[0] || version}`;
  if (version.includes('alpha')) return `Alpha ${version.match(/alpha\.\d+/)?.[0] || version}`;
  if (version.includes('rc')) return `RC ${version.match(/rc\.\d+/)?.[0] || version}`;
  return version;
}

export function getVersionCategory(version: string): 'stable' | 'beta' | 'alpha' | 'rc' | 'experimental' | 'legacy' {
  if (version.startsWith('2.')) {
    if (version.includes('beta')) return 'beta';
    if (version.includes('alpha')) return 'alpha';
    if (version.includes('rc')) return 'rc';
    if (version.includes('experimental')) return 'experimental';
    return 'stable';
  }
  if (version.includes('beta') || version.includes('alpha') || version.includes('rc') || version.includes('experimental')) {
    return 'legacy';
  }
  return 'legacy';
}

export function isPrerelease(version: string): boolean {
  return version.includes('beta') || version.includes('alpha') || version.includes('rc');
}

export function shouldShowVersion(version: string, showLegacy: boolean): boolean {
  // Filter out versions < 1.0.0 (e.g., 0.26.5)
  const cleanVersion = version.replace(/-beta\.\d+/, '').replace(/-alpha\.\d+/, '').replace(/-rc\.\d+/, '').replace(/-experimental\.\d+/, '');
  const major = parseInt(cleanVersion.split('.')[0]);
  if (major < 1) {
    return false;
  }

  const category = getVersionCategory(version);
  // Legacy prerelease (beta/alpha/rc) versions are never shown for < 2.x
  if (category === 'legacy' && isPrerelease(version)) {
    return false;
  }
  // Legacy stable versions (1.x stable) are always shown
  if (category === 'legacy') {
    return true;
  }
  // Experimental versions are not shown (too unstable for most users)
  if (category === 'experimental') {
    return false;
  }
  return true;
}

export function isVersion2OrHigher(version: string): boolean {
  const clean = version.replace(/-beta\.\d+/, '').replace(/-alpha\.\d+/, '').replace(/-rc\.\d+/, '').replace(/-experimental\.\d+/, '');
  const parts = clean.split('.').map(Number);
  return parts[0] >= 2;
}

export function getImportUrls(version: string): { solidJs: string; solidWeb: string } {
  const solidJs = `https://esm.sh/solid-js@${version}?dev`;
  const solidWeb = isVersion2OrHigher(version)
    ? `https://esm.sh/@solidjs/web@${version}?dev&external=solid-js`
    : `https://esm.sh/solid-js@${version}/web?dev&external=solid-js`;
  return { solidJs, solidWeb };
}

export function getImportMapEntries(version: string): Record<string, string> {
  const urls = getImportUrls(version);
  const imports: Record<string, string> = {
    'solid-js': urls.solidJs,
  };

  if (isVersion2OrHigher(version)) {
    imports['@solidjs/web'] = urls.solidWeb;
    return imports;
  }

  imports['solid-js/web'] = urls.solidWeb;
  imports['solid-js/store'] = `https://esm.sh/solid-js@${version}/store?dev&external=solid-js`;
  return imports;
}
