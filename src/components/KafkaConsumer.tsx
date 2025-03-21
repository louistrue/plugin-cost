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

// Flattened message format with one element per message
interface QTOMessage {
  project: string;
  filename: string;
  timestamp: string;
  file_id: string;
  element_id: string;
  category: string;
  level: string;
  area: number;
  is_structural: boolean;
  is_external: boolean;
  ebkph: string;
  materials: Material[];
  classification?: Classification;
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
  const [messages, setMessages] = useState<QTOMessage[]>([]);
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
          // Store message in state
          setMessages((prevMessages) =>
            [...prevMessages, parsedData].slice(-10)
          ); // Keep last 10 messages
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

        // Send mock message after 2 seconds - flat format
        setTimeout(() => {
          const mockQtoMessage: QTOMessage = {
            project: "4_DT_random_C_ebkp",
            filename: "4_DT_random_C_ebkp.ifc",
            timestamp: "2025-03-21T09:34:57.169047Z",
            file_id: "4_DT_random_C_ebkp.ifc_2025-03-21T09:34:57.169047Z",
            element_id: "3DqaUydM99ehywE4_2hm1u",
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
            ],
            classification: {
              id: "C4.3",
              name: "Balkon",
              system: "EBKP",
            },
          };

          if (mockWs.handlers.onMessage) {
            mockWs.handlers.onMessage(JSON.stringify(mockQtoMessage));
          }

          // Send another message 1 second later
          setTimeout(() => {
            const mockQtoMessage2: QTOMessage = {
              project: "4_DT_random_C_ebkp",
              filename: "4_DT_random_C_ebkp.ifc",
              timestamp: "2025-03-21T09:34:58.169047Z",
              file_id: "4_DT_random_C_ebkp.ifc_2025-03-21T09:34:57.169047Z",
              element_id: "3DqaUydM99ehywE4_2hm2J",
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
              ],
              classification: {
                id: "C1",
                name: "Bodenplatte, Fundament",
                system: "EBKP",
              },
            };

            if (mockWs.handlers.onMessage) {
              mockWs.handlers.onMessage(JSON.stringify(mockQtoMessage2));
            }
          }, 1000);
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

  // Group messages by project and file
  const groupedMessages = messages.reduce<Record<string, QTOMessage[]>>(
    (acc, message) => {
      const key = `${message.project}-${message.filename}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(message);
      return acc;
    },
    {}
  );

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

        {messages.length > 0 && (
          <>
            {Object.entries(groupedMessages).map(([key, projectMessages]) => (
              <Box key={key} sx={{ mb: 4 }}>
                <Typography variant="h6" gutterBottom>
                  Project: {projectMessages[0].project}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  File: {projectMessages[0].filename}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  Elements Received: {projectMessages.length}
                </Typography>
                <Typography variant="body1" gutterBottom>
                  Latest Timestamp:{" "}
                  {new Date(
                    projectMessages[projectMessages.length - 1].timestamp
                  ).toLocaleString()}
                </Typography>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Elements by Category:
                  </Typography>
                  {Object.entries(
                    projectMessages.reduce((acc, msg) => {
                      try {
                        if (msg.category) {
                          acc[msg.category] = (acc[msg.category] || 0) + 1;
                        }
                      } catch (err) {
                        console.error(
                          "Error processing message categories:",
                          err,
                          msg
                        );
                      }
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
                    projectMessages.reduce((acc, msg) => {
                      try {
                        if (msg.classification?.id) {
                          const id = msg.classification.id;
                          acc[id] = (acc[id] || 0) + 1;
                        }
                      } catch (err) {
                        console.error(
                          "Error processing message classifications:",
                          err,
                          msg
                        );
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
            ))}
          </>
        )}

        {messages.length === 0 && !loading && connected && (
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
