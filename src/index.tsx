/* @refresh reload */
import { render } from 'solid-js/web';
import './index.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

if (import.meta.env.PROD || (import.meta.env.DEV && (window as any).ENABLE_PWA_DEV)) {
  registerSW({ immediate: true });
}

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id is wrong?',
  );
}

render(() => <App />, root!);
