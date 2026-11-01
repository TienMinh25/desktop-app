import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

function App() {
  return (
    <main>
      <h1>Desktop Coding Harness</h1>
      <p>Electron and React are running.</p>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)