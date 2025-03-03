import { Paper, Typography } from "@mui/material";
import { useDropzone } from "react-dropzone";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useCallback } from "react";
import { getDropzoneStyle } from "./styles";
import { parseExcelFile } from "./utils";
import { MetaFile } from "./types";

interface FileDropzoneProps {
  onFileUploaded: (metaFile: MetaFile) => void;
  setIsLoading: (loading: boolean) => void;
}

const FileDropzone = ({ onFileUploaded, setIsLoading }: FileDropzoneProps) => {
  const onDropFile = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setIsLoading(true);

      try {
        const file = acceptedFiles[0];
        const result = await parseExcelFile(file);

        onFileUploaded({
          file,
          data: result.data,
          headers: result.headers,
          missingHeaders: result.missingHeaders,
          valid: result.valid,
        });
      } catch (error) {
        console.error("Error processing file:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [onFileUploaded, setIsLoading]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropFile,
    multiple: false,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
      "application/vnd.ms-excel": [".xls"],
    },
  });

  return (
    <Paper {...getRootProps()} sx={getDropzoneStyle(isDragActive)}>
      <input {...getInputProps()} />
      {isDragActive ? (
        <div>
          <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
          <Typography variant="body1" color="primary">
            Lassen Sie die Excel-Datei hier fallen...
          </Typography>
        </div>
      ) : (
        <div>
          <UploadFileIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
          <Typography variant="body1" color="textPrimary">
            Drag and Drop
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Format: Excel (.xlsx, .xls)
          </Typography>
        </div>
      )}
    </Paper>
  );
};

export default FileDropzone;
