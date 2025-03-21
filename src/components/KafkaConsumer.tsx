import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Snackbar,
  Alert,
} from "@mui/material";

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

// Create a simplified mock WebSocket interface to avoid 'this' context issues
interface MockWebSocket {
  handlers: {
    onOpen?: () => void;
    onMessage?: (data: string) => void;
    onError?: () => void;
    onClose?: () => void;
  };
  send: (data: string) => void;
  close: () => void;
}

const KafkaConsumer = () => {
  const [message, setMessage] = useState<QTOMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    // Connect to WebSocket server that proxies Kafka messages
    const connectToKafka = () => {
      setLoading(true);

      // Create a mock WebSocket that doesn't rely on 'this' context
      const mockWs: MockWebSocket = {
        handlers: {},
        send: () => {},
        close: () => {},
      };

      // Set up event handlers for the mock WebSocket
      const handleMessage = (data: string) => {
        try {
          const parsedData = JSON.parse(data);
          setMessage(parsedData);
        } catch (err: unknown) {
          console.error("Failed to parse message:", err);
          setError("Failed to parse message");
        }
      };

      const handleError = () => {
        setError("WebSocket connection error");
        setConnected(false);
        setLoading(false);
      };

      const handleClose = () => {
        setConnected(false);
        setLoading(false);
      };

      // Assign handlers to the mock WebSocket
      mockWs.handlers.onMessage = handleMessage;
      mockWs.handlers.onError = handleError;
      mockWs.handlers.onClose = handleClose;

      // Simulate connection opening
      setTimeout(() => {
        setLoading(false);
        setConnected(true);

        if (mockWs.handlers.onOpen) {
          mockWs.handlers.onOpen();
        }

        // Send mock message after 2 seconds
        setTimeout(() => {
          const mockQtoMessage: QTOMessage = {
            project: "4_DT_random_C_ebkp",
            filename: "4_DT_random_C_ebkp.ifc",
            timestamp: "2025-03-21T09:34:57.169047Z",
            file_id: "4_DT_random_C_ebkp.ifc_2025-03-21T09:34:57.169047Z",
            elements: [
              {
                id: "3DqaUydM99ehywE4_2hm1u",
                category: "ifcwall",
                level: "U1.UG_RDOK",
                area: 68.894,
                is_structural: true,
                is_external: false,
                ebkph: "C4.3",
                materials: [
                  {
                    name: "_Holz_wg",
                    fraction: 0.04255,
                    volume: 1.35783,
                  },
                  {
                    name: "_Staenderkonstruktion_ungedaemmt_wg",
                    fraction: 0.10638,
                    volume: 3.39458,
                  },
                  {
                    name: "_Windpaper_wg",
                    fraction: 0.0,
                    volume: 0.0,
                  },
                  {
                    name: "_Gipsfaserplatte_wg",
                    fraction: 0.07448,
                    volume: 2.37622,
                  },
                  {
                    name: "_Holzwerkstoffplatte_wg",
                    fraction: 0.18085,
                    volume: 5.77078,
                  },
                  {
                    name: "_Staenderkonstruktion_gedaemmt_wg",
                    fraction: 0.59575,
                    volume: 19.00965,
                  },
                ],
                classification: {
                  id: "C4.3",
                  name: "Balkon",
                  system: "EBKP",
                },
              },
              {
                id: "3DqaUydM99ehywE4_2hm2J",
                category: "ifcwall",
                level: "U1.UG_RDOK",
                area: 63.369,
                is_structural: true,
                is_external: false,
                ebkph: "C1",
                materials: [
                  {
                    name: "_Gipsfaserplatte_wg",
                    fraction: 0.2105,
                    volume: 5.01128,
                  },
                  {
                    name: "_Staenderkonstruktion_gedaemmt_wg",
                    fraction: 0.78946,
                    volume: 18.79235,
                  },
                ],
                classification: {
                  id: "C1",
                  name: "Bodenplatte, Fundament",
                  system: "EBKP",
                },
              },
              {
                id: "3DqaUydM99ehywE4_2hm37",
                category: "ifcwall",
                level: "U1.UG_RDOK",
                area: 63.703,
                is_structural: true,
                is_external: false,
                ebkph: "C1.5",
                materials: [
                  {
                    name: "_Beton_C30-37_wg",
                    fraction: 1.0,
                    volume: 18.92857,
                  },
                ],
                classification: {
                  id: "C1.5",
                  name: "Tragende Bodenplatte",
                  system: "EBKP",
                },
              },
            ],
          };

          if (mockWs.handlers.onMessage) {
            mockWs.handlers.onMessage(JSON.stringify(mockQtoMessage));
          }
        }, 2000);
      }, 1000);

      // Return cleanup function
      return () => {
        mockWs.close();
      };
    };

    // Start the connection
    const cleanup = connectToKafka();

    // Cleanup on component unmount
    return cleanup;
  }, []);

  return (
    <Box sx={{ mt: 3 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          Kafka Consumer - QTO Elements
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              bgcolor: connected ? "success.main" : "error.main",
              mr: 1,
            }}
          />
          <Typography>
            Status:{" "}
            {loading
              ? "Connecting..."
              : connected
              ? "Connected"
              : "Disconnected"}
          </Typography>
          {loading && <CircularProgress size={20} sx={{ ml: 2 }} />}
        </Box>

        {message && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Project: {message.project}
            </Typography>
            <Typography variant="body1" gutterBottom>
              File: {message.filename}
            </Typography>
            <Typography variant="body1" gutterBottom>
              Timestamp: {new Date(message.timestamp).toLocaleString()}
            </Typography>
            <Typography variant="body1" gutterBottom>
              Elements: {message.elements.length}
            </Typography>

            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                Elements by Category:
              </Typography>
              {Object.entries(
                message.elements.reduce((acc, element) => {
                  acc[element.category] = (acc[element.category] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([category, count]) => (
                <Typography key={category} variant="body2">
                  {category}: {count}
                </Typography>
              ))}
            </Box>

            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                Elements by Classification:
              </Typography>
              {Object.entries(
                message.elements.reduce((acc, element) => {
                  if (element.classification) {
                    const id = element.classification.id;
                    acc[id] = (acc[id] || 0) + 1;
                  }
                  return acc;
                }, {} as Record<string, number>)
              ).map(([id, count]) => (
                <Typography key={id} variant="body2">
                  {id}: {count}
                </Typography>
              ))}
            </Box>
          </Box>
        )}

        {!message && !loading && connected && (
          <Typography>Waiting for messages...</Typography>
        )}
      </Paper>

      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
      >
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default KafkaConsumer;
