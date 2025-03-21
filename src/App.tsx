import { Route, Routes } from "react-router-dom";
import MainPage from "./components/MainPage";
import { ThemeProvider } from "@emotion/react";
import theme from "./theme";
import { KafkaProvider } from "./contexts/KafkaContext";

function App() {
  return (
    <ThemeProvider theme={theme}>
      <KafkaProvider>
        <Routes>
          <Route path="/" element={<MainPage />} />
        </Routes>
      </KafkaProvider>
    </ThemeProvider>
  );
}

export default App;
