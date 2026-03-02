export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  
  // Basic mobile detection
  return /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
}

export type EditorType = 'monaco' | 'codemirror';

export function getInitialEditorType(): EditorType {
  const saved = localStorage.getItem('preferred-editor');
  if (saved === 'monaco' || saved === 'codemirror') return saved as EditorType;
  return isMobile() ? 'codemirror' : 'monaco';
}
