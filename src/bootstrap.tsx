import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// For local development only - render to DOM
const rootElement = document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);

  // Wrap rendering in error boundary to catch any initialization errors
  try {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Error rendering plugin:", error);
    root.render(
      <div style={{ color: "red", padding: "20px" }}>
        Error loading plugin. Please check console for details.
      </div>
    );
  }
}

// Clean export for Module Federation
// This is the component that will be imported by the host
export default App;
