import { Route, Routes } from "react-router-dom";
import MainPage from "./components/MainPage";
import { ThemeProvider } from "@emotion/react";
import theme from "./theme";

function App() {
  return (
    <ThemeProvider theme={theme}>
      <Routes>
        <Route path="/" element={<MainPage />} />
      </Routes>
    </ThemeProvider>
  );
}

export default App;
