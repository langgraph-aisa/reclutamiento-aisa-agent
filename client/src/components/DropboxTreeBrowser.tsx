import {
  ChevronRight,
  FileText,
  Folder,
  Image as ImageIcon,
  Loader2,
  Music,
  Video,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Navegador del árbol real de Dropbox.
 *
 * Muestra la misma estructura que el usuario ve en su Dropbox —carpetas y
 * archivos con su nombre original, incluidos los que no están en el catálogo— y
 * abre cada archivo con el vale firmado del visor. Es la pieza compartida entre
 * el RAG del proyecto y el RAG del candidato: cada hoja aporta su origen de
 * datos y su acuñador de vales, de modo que la navegación y la previsualización
 * no divergan entre las dos superficies.
 */

export type DropboxTreeEntry = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number;
  modified: string | null;
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "opus",
  "m4a",
  "aac",
  "flac",
  "amr",
];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "3gp", "mpeg"];
// Extensiones que el backend compone a HTML y el visor incrusta: Word, hoja de
// cálculo y texto. El resto se ofrece como apertura en una pestaña nueva.
const RENDER_EXTENSIONS = ["docx", "xlsx", "xls", "csv", "txt", "md", "log"];

function extensionOf(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1]! : "";
}

function formatSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DropboxTreeBrowser({
  title,
  root,
  relativePath,
  entries,
  available,
  loading,
  emptyLabel = "La carpeta está vacía.",
  unavailableLabel = "La carpeta no se custodia en Dropbox.",
  onNavigate,
  openFile,
}: {
  title: string;
  root: string | null;
  relativePath: string;
  entries: DropboxTreeEntry[];
  available: boolean;
  loading: boolean;
  emptyLabel?: string;
  unavailableLabel?: string;
  onNavigate: (relativePath: string) => void;
  openFile: (fullPath: string) => Promise<{
    view: string;
    render: string | null;
  }>;
}) {
  const [preview, setPreview] = useState<{
    path: string;
    view: string;
    render: string | null;
  } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const segments = relativePath
    ? relativePath.split("/").filter(Boolean)
    : [];

  const open = async (entry: DropboxTreeEntry) => {
    const fullPath = [root, relativePath, entry.name]
      .filter(Boolean)
      .join("/");
    setOpening(entry.name);
    try {
      const urls = await openFile(fullPath);
      setPreview({ path: fullPath, view: urls.view, render: urls.render });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No fue posible abrir el archivo."
      );
    } finally {
      setOpening(null);
    }
  };

  const previewExtension = preview ? extensionOf(preview.path) : "";

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
          {title}
        </p>
        {available ? (
          <span className="text-xs text-muted-foreground">
            {entries.length} elemento(s)
          </span>
        ) : null}
      </div>

      {!available ? (
        <p className="text-sm text-muted-foreground">{unavailableLabel}</p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Leyendo la carpeta…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              className="rounded-full px-2 py-1 font-medium text-primary hover:bg-accent"
              onClick={() => onNavigate("")}
            >
              {root}
            </button>
            {segments.map((segment, index) => (
              <span
                key={`${segment}-${index}`}
                className="flex items-center gap-1"
              >
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <button
                  type="button"
                  className="rounded-full px-2 py-1 hover:bg-accent"
                  onClick={() =>
                    onNavigate(segments.slice(0, index + 1).join("/"))
                  }
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>

          {relativePath ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => onNavigate(segments.slice(0, -1).join("/"))}
            >
              Subir un nivel
            </button>
          ) : null}

          {!entries.length ? (
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
              {entries.map(entry => (
                <li key={entry.name}>
                  <button
                    type="button"
                    disabled={opening === entry.name}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/60"
                    onClick={() =>
                      entry.type === "folder"
                        ? onNavigate(
                            [relativePath, entry.name]
                              .filter(Boolean)
                              .join("/")
                          )
                        : open(entry)
                    }
                  >
                    {entry.type === "folder" ? (
                      <Folder className="h-4 w-4 text-primary" />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {entry.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {entry.type === "folder"
                        ? "Carpeta"
                        : formatSize(entry.size)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {preview ? (
        <div className="space-y-2 rounded-xl border border-border/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">
              {preview.path}
            </p>
            <button
              type="button"
              className="rounded-full p-1 hover:bg-accent"
              onClick={() => setPreview(null)}
              aria-label="Cerrar visor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {IMAGE_EXTENSIONS.includes(previewExtension) ? (
            <img
              src={preview.view}
              alt={preview.path}
              className="max-h-96 w-full rounded-lg object-contain"
            />
          ) : AUDIO_EXTENSIONS.includes(previewExtension) ? (
            <audio controls src={preview.view} className="w-full">
              <Music className="h-4 w-4" />
            </audio>
          ) : VIDEO_EXTENSIONS.includes(previewExtension) ? (
            <video
              controls
              src={preview.view}
              className="max-h-96 w-full rounded-lg"
            >
              <Video className="h-4 w-4" />
            </video>
          ) : previewExtension === "pdf" ? (
            <iframe
              src={preview.view}
              title={preview.path}
              className="h-96 w-full rounded-lg border border-border/60"
            />
          ) : preview.render && RENDER_EXTENSIONS.includes(previewExtension) ? (
            <iframe
              src={preview.render}
              title={preview.path}
              className="h-96 w-full rounded-lg border border-border/60"
            />
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Este formato no tiene vista previa integrada.
              </p>
              <a
                className="text-primary underline"
                href={preview.view}
                target="_blank"
                rel="noreferrer"
              >
                Abrir en una pestaña nueva
              </a>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
