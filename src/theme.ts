import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    primary: {
      main: "#0D0599",
      light: "#3F3DB5",
      dark: "#080366",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#98CDFA",
      light: "#B8DFFF",
      dark: "#75A9D6",
      contrastText: "#000000",
    },
    error: {
      main: "#DA1E28",
      light: "#FA4D56",
      dark: "#750E13",
      contrastText: "#FFFFFF",
    },
    warning: {
      main: "#F1C21B",
      light: "#FDDC69",
      dark: "#B28600",
      contrastText: "#000000",
    },
    info: {
      main: "#0043CE",
      light: "#4589FF",
      dark: "#002D9C",
      contrastText: "#FFFFFF",
    },
    success: {
      main: "#24A148",
      light: "#42BE65",
      dark: "#0E8D3C",
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#F5F7F9",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#333333",
      secondary: "#555555",
      disabled: "#A8A8A8",
    },
  },
  typography: {
    fontFamily: '"Roboto", "Arial", sans-serif',
    h1: {
      fontWeight: 600,
    },
    h2: {
      fontSize: "2rem",
      fontWeight: 500,
      color: "#333333",
    },
    h3: {
      fontSize: "2.75rem",
      fontWeight: "lighter",
    },
    h4: {
      fontWeight: 600,
    },
    h5: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
    subtitle1: {
      fontWeight: 500,
    },
    button: {
      fontWeight: 500,
      textTransform: "none",
    },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          padding: "8px 16px",
          boxShadow: "none",
          textTransform: "none",
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.1)",
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.05)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: 12,
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: "12px 16px",
        },
        head: {
          fontWeight: 600,
          backgroundColor: "#F4F4F4",
        },
      },
    },
    MuiTypography: {
      styleOverrides: {
        h2: {
          color: "#333333",
        },
      },
    },
  },
});

export default theme;
