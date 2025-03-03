import {
  Typography,
  Button,
  IconButton,
  ListItem,
  ListItemIcon,
  Divider,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { fileSize } from "./utils";
import { MetaFile } from "./types";

interface FileInfoProps {
  metaFile: MetaFile;
  onRemoveFile: () => void;
  onSendData: () => void;
}

const FileInfo = ({ metaFile, onRemoveFile, onSendData }: FileInfoProps) => {
  return (
    <>
      <ListItem sx={{ mt: 4 }}>
        <ListItemIcon>
          <InsertDriveFileIcon color="primary" />
        </ListItemIcon>
        <div className="flex-grow">
          <Typography sx={{ color: "#666" }}>{metaFile.file.name}</Typography>
          <Typography variant="body2" sx={{ color: "#888" }} className="pb-2">
            {fileSize(metaFile.file.size || 0)}
          </Typography>
        </div>
        <ListItemIcon className="flex gap-6">
          <IconButton edge="end" onClick={onRemoveFile}>
            <DeleteIcon />
          </IconButton>
          <Button
            variant="contained"
            color="primary"
            onClick={onSendData}
            disabled={!metaFile.valid}
          >
            Daten senden
          </Button>
        </ListItemIcon>
      </ListItem>

      <Divider sx={{ my: 2 }} />

      <Typography variant="h6" className="mb-2">
        Kostenübersicht
      </Typography>
    </>
  );
};

export default FileInfo;
