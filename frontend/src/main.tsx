import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/synapse-tokens.css'
import "simplebar-react/dist/simplebar.min.css";
import App from './App.tsx'
import ErrorBoundary from "./components/common/ErrorBoundary.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Last resort: catches failures in the providers and layout themselves,
        which sit above the per-route boundary. */}
    <ErrorBoundary scope="Aplikasi">
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <AppWrapper>
              <App />
            </AppWrapper>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
