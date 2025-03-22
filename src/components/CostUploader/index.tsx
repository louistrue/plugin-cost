import { useState } from "react";
import { Box, CircularProgress, useMediaQuery, useTheme } from "@mui/material";
import { CostUploaderProps, MetaFile, CostItem } from "./types";
import FileDropzone from "./FileDropzone";
import FileInfo from "./FileInfo";
import HierarchicalTable from "./HierarchicalTable";

const CostUploader = ({ onFileUploaded }: CostUploaderProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [metaFile, setMetaFile] = useState<MetaFile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

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

  const handleSendData = async () => {
    if (!metaFile) return;

    // Here you would implement the API call to send the data
    // For now, we'll just simulate a successful upload
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      const fileName = metaFile.file.name;
      const currentDate = new Date().toLocaleString("de-CH");
      const status = "Erfolgreich";
      const isUpdate = true; // Flag to indicate this is updating an existing entry

      // Call the onFileUploaded prop if provided
      if (onFileUploaded) {
        // Extract data array based on format
        const costData = Array.isArray(metaFile.data)
          ? metaFile.data
          : metaFile.data.data;

        onFileUploaded(fileName, currentDate, status, costData, isUpdate);
      }

      setMetaFile(null);
      setIsLoading(false);
    }, 1500);
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
                onSendData={handleSendData}
              />

              <HierarchicalTable
                metaFile={metaFile}
                expandedRows={expandedRows}
                toggleRow={toggleRow}
                isMobile={isMobile}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CostUploader;
