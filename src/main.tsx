import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ConvexProvider, ConvexReactClient } from "convex/react"
import App from "./App"
import "./styles.css"

const url = import.meta.env.VITE_CONVEX_URL as string | undefined

function Missing() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      TaskPilot isn’t connected to its backend yet (VITE_CONVEX_URL is missing). Redeploy from Vercel
      once CONVEX_DEPLOY_KEY is set.
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {url ? (
      <ConvexProvider client={new ConvexReactClient(url)}>
        <App />
      </ConvexProvider>
    ) : (
      <Missing />
    )}
  </StrictMode>,
)
