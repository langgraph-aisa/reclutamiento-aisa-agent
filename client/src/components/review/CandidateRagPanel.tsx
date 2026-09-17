import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AudioLines,
  BookOpen,
  ChevronRight,
  File,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderPlus,
  Info,
  ListChecks,
  Loader2,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * RAG personal del candidato.
 *
 * Sustituye al panel de solo lectura «Conocimiento vigente y ciclos de
 * información» por el mismo módulo operativo del RAG de proyectos —arrastre,
 * árbol de documentos, visor y análisis de IA de 66 y 325 palabras— pero
 * acotado al expediente de una postulación y con tres bloques propios: la base
 * de conocimiento de la plaza, los ciclos de información abiertos y las
 * aclaraciones confirmadas por la persona.
 *
 * La configuración de extensiones y peso es compartida con el RAG de proyectos:
 * una sola política gubernamental ambos módulos.
 */

const SUMMARY_WORD_LIMIT = 66;
const ANALYSIS_WORD_LIMIT = 325;

type CandidateFile = {
  id: number;
  folderId: number | null;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  kind: string;
  summary: string;
  deepAnalysis: string;
  analysisStatus: string;
  analyzedModel: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
};

type CandidateFolder = {
  id: number;
  parentId: number | null;
  name: string;
  fileCount: number;
};

type PlazaProject = {
  id: number;
  name: string;
  files: Array<{ id: number | null; originalName: string; characters: number }>;
};

type Cycle = {
  id: number;
  dimension: string;
  question: string;
  status: string;
};

type Note = {
  id: number;
  topic: string;
  dimension: string;
  detail: string;
  evidenceExcerpt: string;
};

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  return date.toLocaleString("es-GT", { timeZone: "America/Guatemala" });
}

function kindIcon(extension: string) {
  if (["jpg", "jpeg", "png"].includes(extension)) return FileImage;
  if (extension === "mp4") return FileVideo;
  if (extension === "mp3") return FileAudio;
  if (["doc", "docx"].includes(extension)) return FileText;
  if (extension === "pdf") return File;
  if (["xls", "xlsx", "csv"].includes(extension)) return FileSpreadsheet;
  return File;
}

function kindOfExtension(extension: string) {
  if (["jpg", "jpeg", "png"].includes(extension)) return "imagen";
  if (extension === "mp4") return "video";
  if (extension === "mp3") return "audio";
  if (["doc", "docx", "pdf"].includes(extension)) return "documento";
  if (["xls", "xlsx", "csv"].includes(extension)) return "hoja";
  return "otro";
}

export function CandidateRagPanel({
  applicationId,
  candidateName,
  plazaProjects,
  cycles,
  notes,
  knowledgeFingerprint,
}: {
  applicationId: number;
  candidateName: string | null;
  plazaProjects: PlazaProject[];
  cycles: Cycle[];
  notes: Note[];
  knowledgeFingerprint: string | null;
}) {
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState("todas");
  const [dragging, setDragging] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [deepEditor, setDeepEditor] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const dragDepth = useRef(0);

  const settings = trpc.knowledge.settings.useQuery();
  const tree = trpc.candidateKnowledge.tree.useQuery(
    { applicationId },
    { refetchInterval: 15_000, refetchIntervalInBackground: false }
  );
  const health = trpc.candidateKnowledge.storageHealth.useQuery();

  const openCycles = cycles.filter(cycle => cycle.status === "abierto");
  const files = useMemo<CandidateFile[]>(
    () => (tree.data?.files ?? []) as CandidateFile[],
    [tree.data]
  );
  const folders = useMemo<CandidateFolder[]>(
    () => (tree.data?.folders ?? []) as CandidateFolder[],
    [tree.data]
  );

  const visibleFiles = useMemo(
    () =>
      files.filter(file => {
        if (selectedFolderId !== null && file.folderId !== selectedFolderId) {
          return false;
        }
        if (kindFilter === "todas") return true;
        return kindOfExtension(file.extension) === kindFilter;
      }),
    [files, selectedFolderId, kindFilter]
  );

  const selectedFile = files.find(file => file.id === selectedFileId) ?? null;

  const refresh = useCallback(() => {
    void tree.refetch();
  }, [tree]);

  const upload = trpc.candidateKnowledge.upload.useMutation({
    onSuccess: result => {
      toast.success(result.analysisMessage);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const analyze = trpc.candidateKnowledge.analyze.useMutation({
    onSuccess: result => {
      toast.success(result.message);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const saveAnalysis = trpc.candidateKnowledge.saveAnalysis.useMutation({
    onSuccess: () => {
      toast.success("Análisis guardado con trazabilidad.");
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const removeFile = trpc.candidateKnowledge.delete.useMutation({
    onSuccess: () => {
      toast.success("Documento eliminado.");
      setSelectedFileId(null);
      setViewerOpen(false);
      refresh();    },
    onError: error => toast.error(error.message),
  });
  const saveFolder = trpc.candidateKnowledge.saveFolder.useMutation({
    onSuccess: () => {
      setNewFolderName("");
      toast.success("Carpeta guardada.");
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const deleteFolder = trpc.candidateKnowledge.deleteFolder.useMutation({
    onSuccess: () => {
      toast.success("Carpeta eliminada; los documentos volvieron al inicio.");
      setSelectedFolderId(null);
      refresh();
    },
    onError: error => toast.error(error.message),
  });
  const moveFile = trpc.candidateKnowledge.move.useMutation({
    onSuccess: () => {
      toast.success("Documento movido.");
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  /** El visor resuelve el documento fuera del ciclo de tRPC; el vale lo autoriza. */
  const viewerToken = trpc.candidateKnowledge.viewerToken.useQuery(
    { fileId: selectedFileId ?? 0 },
    { enabled: Boolean(selectedFileId) }
  );
  const viewerQuery = viewerToken.data?.token
    ? `?t=${encodeURIComponent(viewerToken.data.token)}`
    : "";
  const viewerUrl = selectedFile
    ? `/api/candidate-knowledge/files/${selectedFile.id}${viewerQuery}`
    : "";
  const renderUrl = selectedFile
    ? `/api/candidate-knowledge/render/${selectedFile.id}${viewerQuery}`
    : "";

  const kind = selectedFile ? kindOfExtension(selectedFile.extension) : "otro";
  const isRenderable = selectedFile
    ? ["docx", "csv", "xlsx", "xls", "txt"].includes(selectedFile.extension)
    : false;
  const isAnalyzable = selectedFile
    ? ["pdf", "docx"].includes(selectedFile.extension)
    : false;

  const onSelect = useCallback((file: CandidateFile) => {
    setSelectedFileId(file.id);
    setDeepEditor(file.deepAnalysis ?? "");
    setViewerOpen(true);
  }, []);

  const uploadFiles = useCallback(
    async (list: FileList | File[]) => {
      const maxSizeMb = settings.data?.maxSizeMb ?? 20;
      const allowed = settings.data?.allowedExtensions ?? [];
      for (const file of Array.from(list)) {
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (allowed.length && !allowed.includes(extension)) {
          toast.error(
            `Extensión «${extension || "desconocida"}» no permitida. Habilitadas en Configuración: ${allowed.join(", ")}.`
          );
          continue;
        }
        if (file.size > maxSizeMb * 1024 * 1024) {
          toast.error(
            `El archivo supera el peso máximo de ${maxSizeMb} MB definido en Configuración.`
          );
          continue;
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const raw = String(reader.result ?? "");
            resolve(raw.includes(",") ? (raw.split(",")[1] ?? raw) : raw);
          };
          reader.onerror = () => reject(new Error("lectura fallida"));
          reader.readAsDataURL(file);
        }).catch(() => null);
        if (!base64) {
          toast.error("No fue posible leer el archivo seleccionado.");
          continue;
        }
        upload.mutate({
          applicationId,
          folderId: selectedFolderId,
          fileName: file.name,
          base64,
        });
      }
    },
    [applicationId, selectedFolderId, settings.data, upload]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (event.dataTransfer.files.length) {
        void uploadFiles(event.dataTransfer.files);
      }
    },
    [uploadFiles]
  );

  const deepWords = countWords(deepEditor);
  const deepLimitExceeded = deepWords > ANALYSIS_WORD_LIMIT;

  const rootFolders = folders.filter(folder => folder.parentId === null);
  const childrenOf = (parentId: number) =>
    folders.filter(folder => folder.parentId === parentId);

  const renderFolder = (folder: CandidateFolder, depth: number) => (
    <div key={folder.id} className="space-y-1">
      <div
        className={`flex items-center gap-1 rounded-lg px-1.5 py-1 ${
          selectedFolderId === folder.id ? "bg-muted" : ""
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px]"
          onClick={() => setSelectedFolderId(folder.id)}
          title={`${folder.name} · ${folder.fileCount} documento(s)`}
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">
            {folder.fileCount}
          </span>
        </button>
        <button
          type="button"
          aria-label={`Eliminar la carpeta ${folder.name}`}
          title="Eliminar carpeta"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => deleteFolder.mutate({ id: folder.id })}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {childrenOf(folder.id).map(child => renderFolder(child, depth + 1))}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft lg:col-span-2">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <BookOpen className="h-4 w-4 text-sky-700" />
        <h3 className="text-sm font-bold text-primary">
          RAG Personal · Conocimiento vigente y Ciclos de Información del
          Candidato
        </h3>
        <Badge
          variant="outline"
          className="shrink-0 rounded-full px-2 text-[10px]"
          title="Expediente documental exclusivo de este proceso de evaluación"
        >
          uso exclusivo del candidato
        </Badge>
        {knowledgeFingerprint ? (
          <Badge
            variant="outline"
            className="shrink-0 rounded-full px-2 text-[10px]"
            title="Huella del RAG de la plaza usada en la última evaluación automática"
          >
            <Sparkles className="mr-1 h-3 w-3" />
            {String(knowledgeFingerprint).slice(0, 12)}
          </Badge>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {files.length} documento(s) · {tree.data?.analysis.analyzed ?? 0}{" "}
          analizado(s)
        </span>
      </header>

      <div className="space-y-3 p-3">
        {health.data && health.data.missing > 0 ? (
          <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/10">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <p className="text-[11px] leading-5 text-muted-foreground">
              {health.data.missing} de {health.data.registered} documento(s) no
              están en el volumen de almacenamiento (
              <span className="font-mono">{health.data.directory}</span>).
              Verifique la persistencia del volumen en EasyPanel y vuelva a
              cargarlos.
            </p>
          </div>
        ) : null}

        {/* Resumen del documento y análisis profundo editable */}
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-500/30 dark:bg-sky-500/10">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-900 dark:text-sky-200">
              Resumen del documento · máximo {SUMMARY_WORD_LIMIT} palabras
            </p>
            <p className="mt-1.5 text-xs leading-5 text-primary">
              {selectedFile?.summary
                ? selectedFile.summary
                : "Seleccione un documento para cargar aquí su resumen generado por IA."}
            </p>
            {selectedFile ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {formatBytes(selectedFile.sizeBytes)} · {selectedFile.extension}
                </Badge>
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {selectedFile.analysisStatus === "analizado"
                    ? "Analizado con IA"
                    : selectedFile.analysisStatus === "pendiente"
                      ? "Análisis pendiente"
                      : selectedFile.analysisStatus === "no_aplica"
                        ? "Sin análisis aplicable"
                        : "Análisis con error"}
                </Badge>
                {selectedFile.analysisStatus === "analizado" &&
                isAnalyzable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full text-[11px]"
                    disabled={analyze.isPending}
                    onClick={() => analyze.mutate({ id: selectedFile.id })}
                  >
                    {analyze.isPending ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3 w-3" />
                    )}
                    Regenerar análisis
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Análisis profundo del documento
              </p>
              <span className="text-[10px] text-muted-foreground">
                {deepWords} / {ANALYSIS_WORD_LIMIT} palabras
              </span>
              {selectedFile && isAnalyzable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 rounded-full text-[11px]"
                  disabled={analyze.isPending}
                  onClick={() => analyze.mutate({ id: selectedFile.id })}
                >
                  {analyze.isPending ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3 w-3" />
                  )}
                  Generar análisis de IA
                </Button>
              ) : null}
            </div>
            <Textarea
              value={deepEditor}
              onChange={event => setDeepEditor(event.target.value)}
              disabled={!selectedFile}
              placeholder={
                selectedFile
                  ? "El análisis explica en qué consiste el documento, su propósito, alcance, responsables y reglas clave; si es informativo, amplía el perfil del candidato."
                  : "Seleccione un documento del expediente para editar su análisis."
              }
              className="mt-2 min-h-[120px] text-xs"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {deepLimitExceeded ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  Excede el límite institucional de {ANALYSIS_WORD_LIMIT}{" "}
                  palabras.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  El texto alimenta al agente como conocimiento del expediente.
                </p>
              )}
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-full text-[11px]"
                disabled={
                  !selectedFile || deepLimitExceeded || saveAnalysis.isPending
                }
                onClick={() =>
                  selectedFile &&
                  saveAnalysis.mutate({
                    id: selectedFile.id,
                    deepAnalysis: deepEditor,
                  })
                }
              >
                <Save className="mr-1.5 h-3 w-3" /> Guardar análisis
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[230px_260px_minmax(0,1fr)]">
          {/* Árbol de documentos y filtros */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Navegación
            </p>
            <div className="flex flex-wrap gap-1.5 lg:flex-col lg:items-stretch">
              {[
                ["todas", "Inicio"],
                ["imagen", "Imagen"],
                ["video", "Video"],
                ["audio", "Audio"],
                ["documento", "Documentos (PDF y Word)"],
                ["hoja", "Hojas de cálculo"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={kindFilter === value ? "default" : "ghost"}
                  className="justify-start rounded-full text-[11px] lg:rounded-xl"
                  onClick={() => setKindFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Carpetas
            </p>
            <button
              type="button"
              className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11px] ${
                selectedFolderId === null ? "bg-muted" : ""
              }`}
              onClick={() => setSelectedFolderId(null)}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
              Inicio
              <span className="ml-auto text-muted-foreground">
                {files.length}
              </span>
            </button>
            <div className="space-y-1">
              {rootFolders.map(folder => renderFolder(folder, 0))}
            </div>
            <div className="flex items-center gap-1.5 pt-1">
              <Input
                value={newFolderName}
                onChange={event => setNewFolderName(event.target.value)}
                placeholder="Nombre de la carpeta"
                className="h-8 rounded-lg text-[11px]"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0 rounded-lg"
                aria-label="Crear carpeta"
                title="Crear carpeta"
                disabled={!newFolderName.trim() || saveFolder.isPending}
                onClick={() =>
                  saveFolder.mutate({
                    applicationId,
                    parentId: selectedFolderId,
                    name: newFolderName,
                  })
                }
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Descripción del documento seleccionado */}
          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Descripción del documento
            </p>
            {selectedFile ? (
              <dl className="mt-1.5 space-y-1.5 text-[11px]">
                {[
                  ["Nombre", selectedFile.originalName],
                  ["Fecha de carga", formatDateTime(selectedFile.uploadedAt)],
                  ["Peso", formatBytes(selectedFile.sizeBytes)],
                  ["Extensión", selectedFile.extension.toUpperCase()],
                  [
                    "Procedencia",
                    selectedFile.source === "webhook"
                      ? "Webhook / WhatsApp"
                      : selectedFile.source === "postulacion"
                        ? "Formulario de postulación"
                        : "Registro administrativo",
                  ],
                  [
                    "Cargado por",
                    `${selectedFile.uploadedByName ?? "Sistema"} · ${formatDateTime(selectedFile.uploadedAt)}`,
                  ],
                  ["Tipo", selectedFile.kind],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words text-primary">{value}</dd>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 pt-1">
                  <select
                    aria-label="Mover documento a una carpeta"
                    className="h-7 min-w-0 flex-1 rounded-lg border border-border bg-card px-1.5 text-[11px]"
                    value={selectedFile.folderId ?? ""}
                    onChange={event =>
                      moveFile.mutate({
                        id: selectedFile.id,
                        folderId: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">Inicio</option>
                    {folders.map(folder => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full text-[11px]"
                    disabled={removeFile.isPending}
                    onClick={() => removeFile.mutate({ id: selectedFile.id })}
                  >
                    <Trash2 className="mr-1.5 h-3 w-3" /> Eliminar
                  </Button>
                </div>
              </dl>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Seleccione un documento del expediente para ver su descripción,
                su resumen y su análisis.
              </p>
            )}
          </div>

          {/* Archivos y visor */}
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-primary">
                Expediente del candidato
                <span className="ml-2 font-normal text-muted-foreground">
                  {visibleFiles.length} de {files.length}
                </span>
              </p>
              <label className="inline-flex">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 rounded-full text-[11px]"
                  disabled={upload.isPending}
                >
                  {upload.isPending ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 h-3 w-3" />
                  )}
                  Cargar
                </Button>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept={(settings.data?.allowedExtensions ?? [])
                    .map(extension => `.${extension}`)
                    .join(",")}
                  onChange={event => {
                    if (event.target.files?.length) {
                      void uploadFiles(event.target.files);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
            </div>

            {!viewerOpen || !selectedFile ? (
              <div
                className={`rounded-xl border-2 border-dashed p-3 transition ${
                  dragging
                    ? "border-emerald-500 bg-emerald-50/60"
                    : "border-border bg-muted/20"
                }`}
                onDragEnter={event => {
                  event.preventDefault();
                  dragDepth.current += 1;
                  setDragging(true);
                }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={() => {
                  dragDepth.current -= 1;
                  if (dragDepth.current <= 0) setDragging(false);
                }}
                onDrop={onDrop}
              >
                {visibleFiles.length === 0 ? (
                  <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 text-center">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-[11px] font-semibold text-primary">
                      + Arrastre y Suelte
                    </p>
                    <p className="max-w-sm text-[10px] leading-4 text-muted-foreground">
                      Currículum, títulos, certificaciones u otros documentos
                      del candidato. Peso máximo{" "}
                      {settings.data?.maxSizeMb ?? 20} MB por archivo
                      (Configuración &gt; Conocimiento de proyectos).
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {visibleFiles.map(file => {
                      const Icon = kindIcon(file.extension);
                      return (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => onSelect(file)}
                          aria-pressed={selectedFileId === file.id}
                          className={`rounded-xl border p-2 text-left transition hover:border-emerald-400 ${
                            selectedFileId === file.id
                              ? "border-emerald-500 bg-emerald-50/60"
                              : "border-border bg-card"
                          }`}
                        >
                          <Icon className="h-4 w-4 text-emerald-700" />
                          <p
                            className="mt-1 truncate text-[11px] font-semibold text-primary"
                            title={file.originalName}
                          >
                            {file.originalName}
                          </p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {formatBytes(file.sizeBytes)} · {file.kind}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatDateTime(file.uploadedAt)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] font-semibold text-primary">
                    {selectedFile.originalName}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 rounded-full text-[11px]"
                    onClick={() => setViewerOpen(false)}
                  >
                    <X className="mr-1.5 h-3 w-3" /> Cerrar visor
                  </Button>
                </div>
                <div className="overflow-hidden rounded-lg bg-card">
                  {kind === "imagen" ? (
                    <img
                      src={viewerUrl}
                      alt={selectedFile.originalName}
                      className="mx-auto max-h-[320px] w-auto object-contain"
                    />
                  ) : null}
                  {kind === "video" ? (
                    <video
                      src={viewerUrl}
                      controls
                      className="mx-auto max-h-[320px] w-full"
                    />
                  ) : null}
                  {kind === "audio" ? (
                    <div className="p-4">
                      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                        <AudioLines className="h-4 w-4" />
                        <span className="truncate text-[11px]">
                          {selectedFile.originalName}
                        </span>
                      </div>
                      <audio src={viewerUrl} controls className="w-full" />
                    </div>
                  ) : null}
                  {selectedFile.extension === "pdf" ? (
                    <iframe
                      src={viewerUrl}
                      title={selectedFile.originalName}
                      className="h-[320px] w-full"
                    />
                  ) : null}
                  {isRenderable ? (
                    <iframe
                      src={renderUrl}
                      title={selectedFile.originalName}
                      className="h-[320px] w-full bg-white"
                    />
                  ) : null}
                  {!isRenderable &&
                  !["pdf", "jpg", "jpeg", "png", "mp4", "mp3"].includes(
                    selectedFile.extension
                  ) ? (
                    <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 p-4 text-center">
                      <Info className="h-6 w-6 text-muted-foreground" />
                      <p className="max-w-sm text-[11px] text-muted-foreground">
                        Este formato no dispone de vista previa integrada.
                        Descargue el documento para revisarlo.
                      </p>
                      <a
                        href={viewerUrl}
                        download={selectedFile.originalName}
                        className="text-[11px] font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Descargar documento
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bloques propios del RAG del candidato */}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Base de conocimiento de la plaza
            </p>
            {plazaProjects.length ? (
              <ul className="mt-1.5 space-y-2">
                {plazaProjects.map(project => (
                  <li key={project.id}>
                    <p className="text-[11px] font-semibold text-primary">
                      {project.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {project.files.length} documento(s) analizado(s)
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {project.files.map(file => (
                        <li
                          key={`${project.id}:${file.id ?? file.originalName}`}
                          className="truncate text-[10px] text-muted-foreground"
                          title={file.originalName}
                        >
                          · {file.originalName} ({file.characters} caracteres)
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Sin proyectos de conocimiento vinculados a esta plaza.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ListChecks className="h-3 w-3" /> Ciclos abiertos (
              {openCycles.length})
            </p>
            {openCycles.length ? (
              <ul className="mt-1.5 space-y-1">
                {openCycles.map(cycle => (
                  <li
                    key={cycle.id}
                    className="rounded-lg border border-sky-200 bg-sky-50 p-1.5 text-[10px] text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100"
                  >
                    <p className="font-semibold">{cycle.dimension}</p>
                    <p className="mt-0.5">{cycle.question}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Sin preguntas abiertas con el candidato.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Aclaraciones confirmadas por la persona
            </p>
            {notes.length ? (
              <ul className="mt-1.5 space-y-1">
                {notes.map(note => (
                  <li key={note.id} className="rounded-lg bg-card p-1.5 text-[10px]">
                    <p className="font-semibold text-primary">
                      {note.topic} · {note.dimension}
                    </p>
                    <p className="mt-0.5">{note.detail}</p>
                    <p className="mt-0.5 italic text-muted-foreground">
                      Evidencia: «{note.evidenceExcerpt}»
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Sin aclaraciones registradas todavía.
              </p>
            )}
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
          <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            El expediente es exclusivo de {candidateName ?? "esta persona"} en su
            proceso de evaluación y no altera la base de conocimiento
            institucional de la plaza. Los documentos también pueden llegar por
            el webhook de ApiChat y se incorporan con el mismo análisis.
          </span>
        </p>
      </div>
    </div>
  );
}
