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
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useKafka } from "../contexts/KafkaContext";
import SyncIcon from "@mui/icons-material/Sync";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

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

// URL for WebSocket connection
const WEBSOCKET_URL =
  import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:8001";

// Group related messages by project and file
interface MessageGroup {
  project: string;
  filename: string;
  file_id: string;
  latestTimestamp: string;
  messages: QTOMessage[];
}

const KafkaConsole = () => {
  const [messageGroups, setMessageGroups] = useState<MessageGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Get the eBKP area sums from context
  const { ebkpAreaSums } = useKafka();

  // Function to add a new message and group it appropriately
  const addMessage = (newMessage: QTOMessage) => {
    setMessageGroups((prevGroups) => {
      // Look for an existing group for this project/file
      const groupKey = `${newMessage.project}-${newMessage.file_id}`;
      const groupIndex = prevGroups.findIndex(
        (g) => `${g.project}-${g.file_id}` === groupKey
      );

      // Create a copy of the groups
      const newGroups = [...prevGroups];

      if (groupIndex >= 0) {
        // Update existing group
        const group = { ...newGroups[groupIndex] };
        group.messages = [...group.messages, newMessage];
        // Update timestamp if newer
        if (newMessage.timestamp > group.latestTimestamp) {
          group.latestTimestamp = newMessage.timestamp;
        }
        newGroups[groupIndex] = group;
      } else {
        // Create new group
        newGroups.push({
          project: newMessage.project,
          filename: newMessage.filename,
          file_id: newMessage.file_id,
          latestTimestamp: newMessage.timestamp,
          messages: [newMessage],
        });
      }

      // Keep only the 5 most recent groups
      return newGroups.slice(-5);
    });
  };

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

              // Process the incoming message
              console.log("Received Kafka message via WebSocket", parsedData);
              addMessage(parsedData);
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

      {/* Display current eBKP area sums */}
      <Accordion sx={{ mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle1">eBKP Area Sums</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {Object.keys(ebkpAreaSums).length > 0 ? (
            <Box sx={{ maxHeight: 200, overflow: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>eBKP Code</TableCell>
                    <TableCell align="right">Area Sum (m²)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(ebkpAreaSums).map(([code, area]) => (
                    <TableRow key={code}>
                      <TableCell>{code}</TableCell>
                      <TableCell align="right">
                        {typeof area === "number"
                          ? area.toLocaleString("de-CH", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "0.00"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Typography variant="body2" color="textSecondary">
              No eBKP area data received yet
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Add legend for BIM data indicators */}
      <Box sx={{ mt: 2, mb: 2 }}>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">Legende: BIM Daten</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 2 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Chip
                  icon={<SyncIcon />}
                  size="small"
                  label="123.45"
                  variant="outlined"
                  color="info"
                  sx={{ height: 24 }}
                />
                <Typography variant="body2">
                  Werte aus BIM/IFC Daten (ersetzt Excel-Werte)
                </Typography>
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <Box
                  component="span"
                  sx={{ display: "flex", alignItems: "center" }}
                >
                  <Typography variant="body2">123.45</Typography>
                  <InfoOutlinedIcon
                    color="info"
                    fontSize="small"
                    sx={{ ml: 0.5 }}
                  />
                </Box>
                <Typography variant="body2">
                  Info-Symbol zeigt BIM-Datenquelle und Zeitstempel an
                </Typography>
              </Box>

              <Typography variant="body2" sx={{ fontStyle: "italic", mt: 1 }}>
                Hinweis: Bei Werten aus BIM-Daten wird die Einheit automatisch
                auf "m²" gesetzt und die Kosten entsprechend neu berechnet.
              </Typography>
            </Box>
          </AccordionDetails>
        </Accordion>
      </Box>

      {messageGroups.length === 0 && !loading && connected && (
        <Typography variant="body2" color="textSecondary" sx={{ py: 2 }}>
          Waiting for messages...
        </Typography>
      )}

      {messageGroups.map((group, groupIndex) => (
        <Accordion key={groupIndex} sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ flexGrow: 1 }}>
              {group.project} - {group.messages.length} elements
            </Typography>
            <Typography variant="caption" color="textSecondary" sx={{ mr: 2 }}>
              {new Date(group.latestTimestamp).toLocaleString()}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>File:</strong> {group.filename}
              </Typography>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Elements by Category:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
                {Object.entries(
                  group.messages.reduce((acc, msg) => {
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
                  group.messages.reduce((acc, msg) => {
                    try {
                      // Handle new format with single element
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
