import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";

const StandaloneApp: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/cost-uploader/*" element={<App />} />
        <Route
          path="/*"
          element={
            <div>
              Redirecting... <a href="/cost-uploader">Go to plugin</a>
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default StandaloneApp;
