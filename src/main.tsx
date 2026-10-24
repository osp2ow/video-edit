import { Root } from './App';
const root = (ReactDOM as any).createRoot(document.getElementById('root'));
const start = () => root.render(<Root />);
// 캔버스에 그릴 글꼴을 먼저 받아두고 시작 (실패해도 진행)
const fonts = (document as any).fonts;
if (fonts?.load) {
  Promise.race([
    Promise.all([fonts.load('600 32px "IBM Plex Sans KR"'), fonts.load('500 12px "IBM Plex Mono"')]),
    new Promise(r => setTimeout(r, 1500)),
  ]).catch(() => {}).then(start);
} else start();
