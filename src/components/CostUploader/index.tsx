import { useState, useEffect } from "react";
import {
  Box,
  CircularProgress,
  useMediaQuery,
  useTheme,
  Typography,
} from "@mui/material";
import { CostUploaderProps, MetaFile, CostItem } from "./types";
import FileDropzone from "./FileDropzone";
import FileInfo from "./FileInfo";
import HierarchicalTable from "./HierarchicalTable";
import PreviewModal from "./PreviewModal";

interface CostUploaderProps {
  onFileUploaded?: (
    fileName: string,
    date?: string,
    status?: string,
    costData?: CostItem[],
    isUpdate?: boolean
  ) => void;
  totalElements: number;
  totalCost: number;
}

const CostUploader = ({
  onFileUploaded,
  totalElements,
  totalCost,
}: CostUploaderProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [metaFile, setMetaFile] = useState<MetaFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mappingMessage, setMappingMessage] = useState(
    "BIM Daten werden verarbeitet..."
  );
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [matchedElements, setMatchedElements] = useState<any[]>([]);

  const toggleRow = (code: string) => {
    setExpandedRows((prev: Record<string, boolean>) => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const handleRemoveFile = () => {
    // If there was a file and it was passed to the parent, notify that it's being removed
    if (metaFile && onFileUploaded) {
      // Keep the same filename but pass null data to indicate removal
      const fileName = metaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Gelöscht";
      onFileUploaded(fileName, currentDate, status, [], false);
    }

    setMetaFile(null);
  };

  const handleShowPreview = () => {
    setPreviewOpen(true);
  };

  // This function is called when the user confirms in the preview modal
  const handleConfirmPreview = (matches: any[]) => {
    setMatchedElements(matches);
    setPreviewOpen(false);
    handleSendData(matches);
  };

  const handleSendData = async (matches: any[] = []) => {
    if (!metaFile) return;

    // Here you would implement the API call to send the data
    setIsLoading(true);

    // Use the global requestSendCostData function if available
    if (
      typeof window.sendCostDataToServer === "function" &&
      matches.length > 0
    ) {
      try {
        // Send the matched elements to the server
        const fileName = metaFile.file.name;
        const currentDate = new Date().toISOString();

        // Format the data for Kafka
        const costData = {
          project: "excel-import",
          filename: fileName,
          timestamp: currentDate,
          data: matches,
          replaceExisting: true,
        };

        console.log("Sending cost data to server:", costData);

        const result = await window.sendCostDataToServer(costData);
        console.log("Server response:", result);

        // Notify parent component of successful save
        if (onFileUploaded) {
          onFileUploaded(
            fileName,
            new Date().toLocaleString("de-CH"),
            "Erfolgreich gespeichert",
            matches,
            true
          );
        }

        // Clear the file after successful processing
        setMetaFile(null);
        setIsLoading(false);
      } catch (error) {
        console.error("Error sending cost data:", error);
        setIsLoading(false);

        // We still want to notify the parent of the upload, just mark it as failed
        if (onFileUploaded && metaFile) {
          onFileUploaded(
            metaFile.file.name,
            new Date().toLocaleString("de-CH"),
            `Fehler: ${error.message || "Unbekannter Fehler"}`,
            matches,
            false
          );
        }
      }
    } else {
      // Fallback to simulated behavior if WebSocket function not available
      setTimeout(() => {
        const fileName = metaFile.file.name;
        const currentDate = new Date().toLocaleString("de-CH");
        const status = "Erfolgreich";
        const isUpdate = true;

        // Call the onFileUploaded prop if provided
        if (onFileUploaded) {
          // Extract data array based on format
          const costData =
            matches.length > 0
              ? matches
              : Array.isArray(metaFile.data)
              ? metaFile.data
              : metaFile.data.data;

          onFileUploaded(fileName, currentDate, status, costData, isUpdate);
        }

        setMetaFile(null);
        setIsLoading(false);
      }, 1500);
    }
  };

  const handleFileUploaded = (newMetaFile: MetaFile) => {
    setMetaFile(newMetaFile);

    // Pass the cost data to the parent component immediately
    if (onFileUploaded && newMetaFile.data) {
      const fileName = newMetaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Vorschau";

      // Extract data array based on format
      const costData = Array.isArray(newMetaFile.data)
        ? newMetaFile.data
        : newMetaFile.data.data;

      onFileUploaded(fileName, currentDate, status, costData);
    }
  };

  // Add event listener for BIM mapping status
  useEffect(() => {
    const handleMappingStatus = (event: CustomEvent) => {
      // Update both loading state and message
      if (event.detail.isMapping) {
        setIsLoading(true);
        setMappingMessage(
          event.detail.message || "BIM Daten werden verarbeitet..."
        );
      } else {
        setIsLoading(false);
      }
    };

    // Add event listener
    window.addEventListener(
      "bim-mapping-status" as any,
      handleMappingStatus as EventListener
    );

    // Clean up
    return () => {
      window.removeEventListener(
        "bim-mapping-status" as any,
        handleMappingStatus as EventListener
      );
    };
  }, []);

  return (
    <Box className="flex flex-col h-full" position="relative">
      {/* Single Loading Indicator */}
      {isLoading && (
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          bgcolor="rgba(255, 255, 255, 0.8)"
          zIndex={1300}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              backgroundColor: "white",
              padding: 3,
              borderRadius: 2,
              boxShadow: 3,
            }}
          >
            <CircularProgress sx={{ mb: 2 }} />
            <Typography variant="body1" color="primary.main" fontWeight="500">
              {mappingMessage}
            </Typography>
          </Box>
        </Box>
      )}

      {!metaFile ? (
        <FileDropzone
          onFileUploaded={handleFileUploaded}
          setIsLoading={setIsLoading}
        />
      ) : (
        <div>
          <div className="flex flex-col h-full">
            <FileInfo
              metaFile={metaFile}
              onRemoveFile={handleRemoveFile}
              onSendData={handleShowPreview}
            />

            <HierarchicalTable
              metaFile={metaFile}
              expandedRows={expandedRows}
              toggleRow={toggleRow}
              isMobile={isMobile}
              isLoading={isLoading}
              mappingMessage={mappingMessage}
              totalElements={totalElements}
            />

            {/* Preview Modal */}
            <PreviewModal
              open={previewOpen}
              onClose={() => setPreviewOpen(false)}
              onConfirm={handleConfirmPreview}
              metaFile={metaFile}
              totalCost={totalCost}
            />
          </div>
        </div>
      )}
    </Box>
  );
};

export default CostUploader;
