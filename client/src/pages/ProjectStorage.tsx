import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  ChevronRight,
  Cloud,
  Database,
  FileText,
  Folder,
  FolderKanban,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Music,
  RefreshCw,
  UserRoundCog,
  Video,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ProjectRow = {
  id: number;
  name: string;
  storage_mode: string;
  dropbox_connection_user_id: number | null;
  created_by_user_id: number | null;
  owner_name: string | null;
  dropbox_name: string | null;
  file_count: number;
  candidate_file_count: number;
};

type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number;
  modified: string | null;
};

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "opus", "m4a", "aac", "flac", "amr"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "3gp", "mpeg"];
const RENDER_EXTENSIONS = ["docx", "csv", "txt", "md", "log"];

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

/**
 * Navegador del árbol real de Dropbox del proyecto.
 *
 * Muestra la misma estructura que el usuario ve en su Dropbox —carpetas y
 * archivos con su nombre original— y abre cada archivo con el vale firmado del
 * visor, de modo que PDF, imagen, audio y video se previsualicen sin salir del
 * aplicativo. Es la lectura que el RAG del proyecto necesita para verse igual
 * que la carpeta.
 */
function DropboxBrowser({ projectId }: { projectId: number }) {
  const [path, setPath] = useState("");
  const [preview, setPreview] = useState<{
    path: string;
    view: string;
    render: string | null;
  } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const tree = trpc.storage.projectTree.useQuery({ projectId, path });

  const root = tree.data?.root ?? "";
  const current = [root, path].filter(Boolean).join("/");
  const segments = path ? path.split("/").filter(Boolean) : [];

  const openFile = async (entry: TreeEntry) => {
    const childPath = `${current}/${entry.name}`;
    setOpening(entry.name);
    try {
      const { token } = await utils.storage.projectFileToken.fetch({
        projectId,
        path: childPath,
      });
      const query = `projectId=${projectId}&path=${encodeURIComponent(
        childPath
      )}&t=${encodeURIComponent(token)}`;
      setPreview({
        path: childPath,
        view: `/api/dropbox/view?${query}`,
        render: `/api/dropbox/render?${query}`,
      });
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
          RAG del proyecto · árbol de Dropbox
        </p>
        {tree.data?.available ? (
          <span className="text-xs text-muted-foreground">
            {tree.data.entries.length} elemento(s)
          </span>
        ) : null}
      </div>

      {!tree.data?.available ? (
        <p className="text-sm text-muted-foreground">
          El proyecto no custodia sus documentos en Dropbox.
        </p>
      ) : tree.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Leyendo la carpeta…
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              className="rounded-full px-2 py-1 font-medium text-primary hover:bg-accent"
              onClick={() => setPath("")}
            >
              {root}
            </button>
            {segments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <button
                  type="button"
                  className="rounded-full px-2 py-1 hover:bg-accent"
                  onClick={() =>
                    setPath(segments.slice(0, index + 1).join("/"))
                  }
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>

          {path ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() =>
                setPath(segments.slice(0, -1).join("/"))
              }
            >
              Subir un nivel
            </button>
          ) : null}

          {!tree.data.entries.length ? (
            <p className="text-sm text-muted-foreground">
              La carpeta está vacía.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
              {(tree.data.entries as TreeEntry[]).map(entry => (
                <li key={entry.name}>
                  <button
                    type="button"
                    disabled={opening === entry.name}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/60"
                    onClick={() =>
                      entry.type === "folder"
                        ? setPath(
                            [path, entry.name].filter(Boolean).join("/")
                          )
                        : openFile(entry)
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
                      {entry.type === "folder" ? "Carpeta" : formatSize(entry.size)}
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
            <video controls src={preview.view} className="max-h-96 w-full rounded-lg">
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

export default function ProjectStorage() {
  const projects = trpc.storage.projects.useQuery();
  const connectedUsers = trpc.storage.connectedUsers.useQuery();

  const setMode = trpc.storage.setProjectStorage.useMutation({
    onSuccess: async () => {
      await projects.refetch();
      toast.success("Almacenamiento del proyecto actualizado.");
    },
    onError: error => toast.error(error.message),
  });

  const assign = trpc.storage.assignProjectConnection.useMutation({
    onSuccess: async () => {
      await projects.refetch();
      toast.success("Cuenta de Dropbox del proyecto actualizada.");
    },
    onError: error => toast.error(error.message),
  });

  const migrate = trpc.storage.migrateProject.useMutation({
    onSuccess: async result => {
      await projects.refetch();
      toast.success(
        `Migración completada: ${result.copied} documento(s) copiados${
          result.failed ? `, ${result.failed} con fallo` : ""
        }.`
      );
    },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
          Custodia de documentos
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Almacenamiento por proyecto
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Decida dónde vive la base de conocimiento de cada proyecto: en el
          volumen local o en el Dropbox de la cuenta que lo respalda. Cada
          proyecto organiza su carpeta como <span className="font-medium">Proyecto/Plaza/Candidato</span>.
          Active, asigne o migre sin que los documentos ya cargados
          desaparezcan.
        </p>
      </div>

      {projects.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando proyectos…</p>
      ) : !projects.data?.length ? (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            No hay proyectos de conocimiento registrados.
          </CardContent>
        </Card>
      ) : (
        (projects.data as ProjectRow[]).map(project => (
          <Card key={project.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <CardDescription>
                      {project.file_count} documento(s) de proyecto ·{" "}
                      {project.candidate_file_count} del RAG de candidatos
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    project.storage_mode === "dropbox"
                      ? "rounded-full border-emerald-300 text-emerald-700"
                      : "rounded-full"
                  }
                >
                  {project.storage_mode === "dropbox" ? (
                    <>
                      <Cloud className="mr-1 h-3.5 w-3.5" /> Dropbox
                    </>
                  ) : (
                    <>
                      <HardDrive className="mr-1 h-3.5 w-3.5" /> Local
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 rounded-2xl border border-border/70 p-4 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Modo de almacenamiento
                    </p>
                    <p className="font-semibold">
                      {project.storage_mode === "dropbox"
                        ? "Dropbox"
                        : "Volumen local"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <UserRoundCog className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Cuenta que lo respalda
                    </p>
                    <p className="font-semibold">
                      {project.storage_mode === "dropbox"
                        ? project.dropbox_name ??
                          project.owner_name ??
                          "Sin cuenta asignada"
                        : project.owner_name ?? "Sin propietario"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {project.storage_mode === "dropbox" ? (
                  <Button
                    variant="outline"
                    disabled={setMode.isPending}
                    onClick={() =>
                      setMode.mutate({ projectId: project.id, mode: "local" })
                    }
                  >
                    <HardDrive className="mr-2 h-4 w-4" />
                    Volver al volumen local
                  </Button>
                ) : (
                  <Button
                    disabled={setMode.isPending}
                    onClick={() =>
                      setMode.mutate({ projectId: project.id, mode: "dropbox" })
                    }
                  >
                    <Cloud className="mr-2 h-4 w-4" />
                    Activar Dropbox
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={migrate.isPending}
                  onClick={() =>
                    migrate.mutate({
                      projectId: project.id,
                      direction:
                        project.storage_mode === "dropbox"
                          ? "to_local"
                          : "to_dropbox",
                    })
                  }
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {project.storage_mode === "dropbox"
                    ? "Migrar al volumen local"
                    : "Migrar a Dropbox"}
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                  Cuenta de Dropbox asignada
                </p>
                <Select
                  value={
                    project.dropbox_connection_user_id != null
                      ? String(project.dropbox_connection_user_id)
                      : "owner"
                  }
                  onValueChange={value =>
                    assign.mutate({
                      projectId: project.id,
                      userId:
                        value === "owner" ? null : Number(value),
                    })
                  }
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm sm:max-w-sm">
                    <SelectValue placeholder="Seleccionar cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">
                      Creador del proyecto (por omisión)
                    </SelectItem>
                    {(connectedUsers.data ?? []).map((user: { id: number; name: string | null; email: string | null }) => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.name ?? user.email ?? `Usuario ${user.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Solo las cuentas que ya conectaron su Dropbox aparecen en la
                  lista. La cuenta asignada respalda la custodia cuando el modo
                  es Dropbox.
                </p>
              </div>

              {project.storage_mode === "dropbox" ? (
                <DropboxBrowser projectId={project.id} />
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
