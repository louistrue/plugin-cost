import { useState } from "react";
import { Box, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { CostUploaderProps, MetaFile, CostItem } from "./types";
import FileDropzone from "./FileDropzone";
import FileInfo from "./FileInfo";
import HierarchicalTable from "./HierarchicalTable";
import PreviewModal from "./PreviewModal";

const CostUploader = ({ onFileUploaded }: CostUploaderProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [metaFile, setMetaFile] = useState<MetaFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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

        await window.sendCostDataToServer(costData);

        // Notify parent component
        if (onFileUploaded) {
          onFileUploaded(
            fileName,
            new Date().toLocaleString("de-CH"),
            "Erfolgreich",
            matches,
            true
          );
        }

        setMetaFile(null);
        setIsLoading(false);
      } catch (error) {
        console.error("Error sending cost data:", error);
        setIsLoading(false);
        // Show error using the FileInfo component's notification system
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

  return (
    <div className="flex flex-col h-full">
      {!metaFile ? (
        <FileDropzone
          onFileUploaded={handleFileUploaded}
          setIsLoading={setIsLoading}
        />
      ) : (
        <div>
          {isLoading ? (
            <Box display="flex" justifyContent="center" my={4}>
              <CircularProgress />
            </Box>
          ) : (
            <div className="flex flex-col h-full">
              <FileInfo
                metaFile={metaFile}
                onRemoveFile={handleRemoveFile}
                onSendData={handleShowPreview} // Show preview instead of direct send
              />

              <HierarchicalTable
                metaFile={metaFile}
                expandedRows={expandedRows}
                toggleRow={toggleRow}
                isMobile={isMobile}
              />

              {/* Preview Modal */}
              <PreviewModal
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                onConfirm={handleConfirmPreview}
                metaFile={metaFile}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CostUploader;
