/**
 * @file main.tsx
 * @description React 애플리케이션 부트스트랩 진입점 (`#root`에 `<App />` 마운트 및 `styles/app.css` 로드).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
