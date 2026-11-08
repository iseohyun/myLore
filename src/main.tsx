/**
 * @file main.tsx
 * @description React 애플리케이션 부트스트랩 진입점 (`#root`에 `<App />` 마운트, `<RootErrorBoundary />` 보호 및 `styles/app.css` 로드).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mylore-app">
          <div className="settings-dashboard">
            <h2>⚠️ UI 렌더링 오류가 발생했습니다</h2>
            <pre>{this.state.error.stack || this.state.error.message}</pre>
            <button
              className="toolbar-btn primary"
              onClick={() => window.location.reload()}
            >
              🔄 새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
