import { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Alert,
  Snackbar,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface Material {
  name: string;
  fraction: number;
  volume: number;
}

interface Classification {
  id: string;
  name: string;
  system: string;
}

interface Element {
  id: string;
  category: string;
  level: string;
  area: number;
  is_structural: boolean;
  is_external: boolean;
  ebkph: string;
  materials: Material[];
  classification?: Classification;
}

interface QTOMessage {
  project: string;
  filename: string;
  timestamp: string;
  file_id: string;
  elements: Element[];
}

// URL for WebSocket connection
const WEBSOCKET_URL =
  import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

const KafkaConsole = () => {
  const [messages, setMessages] = useState<QTOMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Function to connect to WebSocket server
    const connectToWebSocket = () => {
      setLoading(true);

      try {
        console.log(`Connecting to WebSocket server at ${WEBSOCKET_URL}...`);
        const ws = new WebSocket(WEBSOCKET_URL);
        wsRef.current = ws;

        // Handle WebSocket open event
        ws.onopen = () => {
          console.log("WebSocket connection established");
          setLoading(false);
          setConnected(true);
          setError(null);
        };

        // Handle WebSocket messages
        ws.onmessage = (event) => {
          try {
            const data = event.data;
            // Check if this is a connection status message
            if (typeof data === "string") {
              const parsedData = JSON.parse(data);

              // Check if this is a connection status message
              if (parsedData.type === "connection") {
                console.log(`Connection status: ${parsedData.status}`);
                return;
              }

              // Otherwise, assume it's a QTO message
              console.log("Received Kafka message via WebSocket", parsedData);
              setMessages((prev) => [parsedData, ...prev].slice(0, 5)); // Keep only 5 most recent messages
            }
          } catch (err) {
            console.error("Error parsing WebSocket message:", err);
            setError("Failed to parse message from server");
          }
        };

        // Handle WebSocket errors
        ws.onerror = (event) => {
          console.error("WebSocket error:", event);
          setError("WebSocket connection error");
          setConnected(false);
          setLoading(false);
        };

        // Handle WebSocket close
        ws.onclose = (event) => {
          console.log("WebSocket connection closed", event.code, event.reason);
          setConnected(false);
          setLoading(false);

          // Try to reconnect after a delay
          if (!event.wasClean) {
            setError("Connection closed unexpectedly. Reconnecting...");
            setTimeout(() => {
              if (wsRef.current?.readyState === WebSocket.CLOSED) {
                connectToWebSocket();
              }
            }, 3000);
          }
        };

        return () => {
          // Clean up WebSocket on component unmount
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close();
          }
        };
      } catch (err) {
        console.error("Failed to connect to WebSocket server:", err);
        setError("Failed to connect to WebSocket server");
        setLoading(false);

        // Try to reconnect after a delay
        setTimeout(() => {
          connectToWebSocket();
        }, 5000);

        return () => {}; // Return empty cleanup function
      }
    };

    // Connect to WebSocket
    const cleanup = connectToWebSocket();

    // Clean up on component unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      cleanup();
    };
  }, []);

  // Handle closing error snackbar
  const handleCloseError = () => {
    setError(null);
  };

  return (
    <Paper elevation={3} sx={{ p: 2, mb: 3, mt: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          Kafka Messages (QTO Elements)
        </Typography>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
          }}
        >
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: connected ? "success.main" : "error.main",
              mr: 1,
            }}
          />
          <Typography variant="body2" color="textSecondary">
            {loading
              ? "Connecting..."
              : connected
              ? "Connected"
              : "Disconnected"}
          </Typography>
          {loading && <CircularProgress size={16} sx={{ ml: 1 }} />}
        </Box>
      </Box>

      {messages.length === 0 && !loading && connected && (
        <Typography variant="body2" color="textSecondary" sx={{ py: 2 }}>
          Waiting for messages...
        </Typography>
      )}

      {messages.map((message, index) => (
        <Accordion key={index} sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ flexGrow: 1 }}>
              {message.project} - {message.elements.length} elements
            </Typography>
            <Typography variant="caption" color="textSecondary" sx={{ mr: 2 }}>
              {new Date(message.timestamp).toLocaleString()}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>File:</strong> {message.filename}
              </Typography>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Elements by Category:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                {Object.entries(
                  message.elements.reduce((acc, element) => {
                    acc[element.category] = (acc[element.category] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>)
                ).map(([category, count]) => (
                  <Chip
                    key={category}
                    label={`${category}: ${count}`}
                    size="small"
                    variant="outlined"
                  />
                ))}
              </Box>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Elements by Classification:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                {Object.entries(
                  message.elements.reduce((acc, element) => {
                    if (element.classification) {
                      const id = element.classification.id;
                      acc[id] = (acc[id] || 0) + 1;
                    }
                    return acc;
                  }, {} as Record<string, number>)
                ).map(([id, count]) => (
                  <Chip
                    key={id}
                    label={`${id}: ${count}`}
                    size="small"
                    variant="outlined"
                    color="primary"
                  />
                ))}
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>
      ))}

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={handleCloseError}
      >
        <Alert
          onClose={handleCloseError}
          severity="error"
          sx={{ width: "100%" }}
        >
          {error}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default KafkaConsole;
