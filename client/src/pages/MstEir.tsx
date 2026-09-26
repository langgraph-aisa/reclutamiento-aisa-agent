import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AudioLines,
  BookOpenText,
  Building2,
  File,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  History,
  Info,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type MethodologyDocument = {
  id: number;
  document_key: "siera" | "mst_eir";
  display_name: string;
  content_markdown: string;
  version: number;
  revision_count: number;
  updated_at: string | Date;
  updated_by_name: string | null;
  updated_by_email: string | null;
};

type KnowledgeFileRow = {
  id: number;
  project_id: number;
  folder_id: number | null;
  original_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  summary_66: string;
  deep_analysis: string;
  analysis_status: string;
  analyzed_model: string | null;
  uploaded_at: string | Date;
  updated_at: string | Date;
  uploaded_by_name: string | null;
  uploaded_by_email: string | null;
};

type KnowledgeFolderRow = {
  id: number;
  project_id: number;
  parent_id: number | null;
  name: string;
  created_at: string | Date;
  file_count: number;
  child_count: number;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
  });
}

function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function kindLabel(kind: string) {
  return (
    {
      imagen: "Imagen",
      video: "Video",
      audio: "Audio",
      documento: "Documento",
      hoja: "Hoja de cálculo",
    }[kind] ?? "Otro"
  );
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

export default function MstEir() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null
  );
  const [projectName, setProjectName] = useState("");
  const [projectSummary, setProjectSummary] = useState("");
  const [checkedPositions, setCheckedPositions] = useState<Set<number>>(
    new Set()
  );
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [deepEditor, setDeepEditor] = useState("");
  const [dragging, setDragging] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const settings = trpc.knowledge.settings.useQuery();
  const projects = trpc.knowledge.projects.useQuery();
  const positions = trpc.positions.list.useQuery();
  const projectPositions = trpc.knowledge.projectPositions.useQuery(
    { projectId: selectedProjectId ?? 0 },
    { enabled: Boolean(selectedProjectId) }
  );
  const folders = trpc.knowledge.folders.useQuery(
    { projectId: selectedProjectId ?? 0 },
    { enabled: Boolean(selectedProjectId) }
  );
  const files = trpc.knowledge.files.useQuery(
    {
      projectId: selectedProjectId ?? 0,
      folderId: selectedFolderId,
      kind: kindFilter === "todas" ? undefined : kindFilter,
    },
    { enabled: Boolean(selectedProjectId) }
  );
  const methodology = trpc.mstEir.documents.useQuery();
  // Diagnóstico del almacenamiento del proyecto elegido: comprueba cada
  // documento contra el medio que lo custodia —el volumen del servidor o el
  // Dropbox del proyecto—, de modo que el aviso nombre la causa verdadera y no
  // declare ausentes los archivos que están en Dropbox.
  const storageHealth = trpc.knowledge.storageHealth.useQuery(
    { projectId: selectedProjectId ?? undefined },
    {
      enabled: Boolean(selectedProjectId),
      refetchOnWindowFocus: true,
    }
  );

  const saveProject = trpc.knowledge.saveProject.useMutation({
    onSuccess: result => {
      toast.success("Proyecto y plazas vinculadas guardados correctamente.");
      setSelectedProjectId(result.id);
      projects.refetch();
      projectPositions.refetch();
    },
    onError: error =>
      toast.error(`No fue posible guardar el proyecto: ${error.message}`),
  });
  const deleteProject = trpc.knowledge.deleteProject.useMutation({
    onSuccess: () => {
      toast.success("Proyecto eliminado correctamente.");
      setSelectedProjectId(null);
      setSelectedFileId(null);
      projects.refetch();
    },
    onError: error =>
      toast.error(`No fue posible eliminar el proyecto: ${error.message}`),
  });
  const createFolder = trpc.knowledge.createFolder.useMutation({
    onSuccess: () => {
      toast.success("Carpeta creada correctamente.");
      setNewFolderName("");
      folders.refetch();
    },
    onError: error =>
      toast.error(`No fue posible crear la carpeta: ${error.message}`),
  });
  const deleteFolder = trpc.knowledge.deleteFolder.useMutation({
    onSuccess: () => {
      toast.success("Carpeta eliminada correctamente.");
      folders.refetch();
      files.refetch();
    },
    onError: error =>
      toast.error(`No fue posible eliminar la carpeta: ${error.message}`),
  });
  const uploadFile = trpc.knowledge.upload.useMutation({
    onSuccess: result => {
      // El destino se declara: la carga que aterriza en el volumen del servidor
      // no está sincronizada con Dropbox y la operación debe saberlo al cargar,
      // no al descubrir el archivo ausente días después.
      toast.success(
        result.destination.backend === "dropbox"
          ? `Archivo custodiado en Dropbox · ${result.destination.path}`
          : `Archivo guardado en el volumen del servidor · ${result.destination.path}`
      );
      if (result.analysisMessage) toast.info(result.analysisMessage);
      setSelectedFileId(result.id);
      files.refetch();
      folders.refetch();
      storageHealth.refetch();
    },
    onError: error =>
      toast.error(`No fue posible cargar el archivo: ${error.message}`),
  });
  const analyzeFile = trpc.knowledge.analyze.useMutation({
    onSuccess: result => {
      toast.success(result.analysisMessage);
      files.refetch();
    },
    onError: error =>
      toast.error(`No fue posible analizar el documento: ${error.message}`),
  });
  const saveAnalysis = trpc.knowledge.saveAnalysis.useMutation({
    onSuccess: () => {
      toast.success("Análisis guardado como base de conocimiento.");
      files.refetch();
    },
    onError: error =>
      toast.error(`No fue posible guardar el análisis: ${error.message}`),
  });
  const moveFile = trpc.knowledge.moveFile.useMutation({
    onSuccess: () => {
      toast.success("Archivo movido correctamente.");
      files.refetch();
      folders.refetch();
    },
    onError: error =>
      toast.error(`No fue posible mover el archivo: ${error.message}`),
  });
  const deleteFile = trpc.knowledge.deleteFile.useMutation({
    onSuccess: () => {
      toast.success("Archivo eliminado correctamente.");
      setSelectedFileId(null);
      setViewerOpen(false);
      files.refetch();
      folders.refetch();
    },
    onError: error =>
      toast.error(`No fue posible eliminar el archivo: ${error.message}`),
  });

  const projectRows = projects.data ?? [];
  useEffect(() => {
    if (!selectedProjectId && projectRows.length > 0) {
      setSelectedProjectId(Number(projectRows[0].id));
    }
  }, [projectRows, selectedProjectId]);

  const selectedProject = projectRows.find(
    row => Number(row.id) === selectedProjectId
  );

  useEffect(() => {
    if (!selectedProject) return;
    setProjectName(String(selectedProject.name ?? ""));
    setProjectSummary(String(selectedProject.summary ?? ""));
  }, [selectedProject?.id, selectedProject?.updated_at]);

  useEffect(() => {
    const linked = new Set(
      (projectPositions.data ?? []).map((row: any) => Number(row.position_id))
    );
    setCheckedPositions(linked);
  }, [projectPositions.data, selectedProjectId]);

  const fileRows = useMemo(() => {
    const rows = (files.data ?? []) as KnowledgeFileRow[];
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(row =>
      String(row.original_name).toLowerCase().includes(term)
    );
  }, [files.data, search]);

  const selectedFile =
    ((files.data ?? []) as KnowledgeFileRow[]).find(
      row => row.id === selectedFileId
    ) ?? null;

  useEffect(() => {
    setDeepEditor(selectedFile?.deep_analysis ?? "");
  }, [selectedFileId, files.data]);

  const folderRows = (folders.data ?? []) as KnowledgeFolderRow[];
  const rootFolders = folderRows.filter(row => !row.parent_id);
  const childrenOf = (parentId: number) =>
    folderRows.filter(row => row.parent_id === parentId);
  const folderPathLabel = useMemo(() => {
    if (!selectedFolderId) return "Inicio";
    const find = (id: number, parts: string[]): string[] => {
      const row = folderRows.find(folder => folder.id === id);
      if (!row) return parts;
      parts.unshift(row.name);
      return row.parent_id ? find(row.parent_id, parts) : parts;
    };
    return ["Inicio", ...find(selectedFolderId, [])].join(" / ");
  }, [folderRows, selectedFolderId]);

  const validateFileForUpload = useCallback(
    (file: File) => {
      const allowed = settings.data?.allowedExtensions ?? [];
      const maxSizeMb = settings.data?.maxSizeMb ?? 20;
      const dot = file.name.lastIndexOf(".");
      const extension = dot < 0 ? "" : file.name.slice(dot + 1).toLowerCase();
      if (!allowed.includes(extension)) {
        toast.error(
          `Extensión «${extension || "desconocida"}» no permitida. Habilitadas en Configuración: ${allowed.join(", ")}.`
        );
        return false;
      }
      if (file.size > maxSizeMb * 1024 * 1024) {
        toast.error(
          `El archivo supera el peso máximo de ${maxSizeMb} MB definido en Configuración > Conocimiento de proyectos.`
        );
        return false;
      }
      return true;
    },
    [settings.data]
  );

  const uploadFileObject = useCallback(
    async (file: File) => {
      if (!selectedProjectId) {
        toast.error("Seleccione o cree un proyecto antes de cargar archivos.");
        return;
      }
      if (!validateFileForUpload(file)) return;
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result ?? "");
        const base64 = raw.includes(",") ? raw.split(",")[1] ?? raw : raw;
        uploadFile.mutate({
          projectId: selectedProjectId,
          folderId: selectedFolderId,
          fileName: file.name,
          base64,
        });
      };
      reader.onerror = () =>
        toast.error("No fue posible leer el archivo seleccionado.");
      reader.readAsDataURL(file);
    },
    [selectedProjectId, selectedFolderId, uploadFile, validateFileForUpload]
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      for (const file of Array.from(event.dataTransfer.files)) {
        void uploadFileObject(file);
      }
    },
    [uploadFileObject]
  );

  /**
   * El visor se compone con etiquetas que el navegador resuelve por su cuenta
   * (`img`, `video`, `audio`, `iframe`). Esas peticiones no llevan cabeceras de
   * sesión, por lo que se solicita un vale firmado y se anexa a la dirección.
   * El vale caduca en quince minutos y solo autoriza la lectura de este archivo.
   */
  const viewerToken = trpc.knowledge.viewerToken.useQuery(
    { fileId: selectedFileId ?? 0 },
    { enabled: Boolean(selectedFileId) }
  );
  const viewerQuery = viewerToken.data?.token
    ? `?t=${encodeURIComponent(viewerToken.data.token)}`
    : "";
  const viewerUrl = selectedFile
    ? `/api/knowledge/files/${selectedFile.id}${viewerQuery}`
    : "";
  const renderUrl = selectedFile
    ? `/api/knowledge/render/${selectedFile.id}${viewerQuery}`
    : "";
  const kind = selectedFile ? kindOfExtension(selectedFile.extension) : "otro";
  const isAnalyzable =
    selectedFile && ["pdf", "docx"].includes(selectedFile.extension);
  const isRenderable = selectedFile
    ? ["docx", "csv", "xlsx", "xls", "txt"].includes(selectedFile.extension)
    : false;
  const deepWords = countWords(deepEditor);
  const deepLimitExceeded = deepWords > 325;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
          Conocimiento institucional
        </p>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-800 tracking-[-.04em] text-primary">
          <FolderKanban className="h-9 w-9 text-emerald-700" />
          Administrador de Proyectos
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Administre proyectos, carpetas y archivos multimedia con análisis de
          IA. Cada proyecto conserva su propia base de conocimiento (RAG) que
          alimenta al Agente de IA LangGraph.
        </p>
      </div>

      <Card className="rounded-3xl border-0 bg-[#0b2d4b] text-white shadow-soft dark:bg-[#162333]">
        <CardContent className="flex gap-3 p-5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
          <p className="text-sm leading-6 text-white/75">
            Los archivos se conservan en el almacenamiento institucional y los
            análisis se registran en PostgreSQL. El RAG del proyecto es la
            fuente de aprendizaje del agente; la decisión de contratación
            permanece con el equipo humano autorizado.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl text-primary">
                  Descripción del Proyecto
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Seleccione un proyecto existente o cree uno nuevo.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedProjectId ? String(selectedProjectId) : ""}
                onValueChange={value => {
                  setSelectedProjectId(Number(value));
                  setSelectedFolderId(null);
                  setSelectedFileId(null);
                  setViewerOpen(false);
                }}
              >
                <SelectTrigger className="w-[240px] rounded-full">
                  <SelectValue placeholder="Seleccionar proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {projectRows.map(row => (
                    <SelectItem key={row.id} value={String(row.id)}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  setSelectedProjectId(null);
                  setProjectName("");
                  setProjectSummary("");
                  setCheckedPositions(new Set());
                  setSelectedFolderId(null);
                  setSelectedFileId(null);
                  setViewerOpen(false);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Nuevo proyecto
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Nombre del proyecto</Label>
                <Input
                  id="project-name"
                  value={projectName}
                  onChange={event => setProjectName(event.target.value)}
                  placeholder="Escriba el nombre del proyecto"
                  maxLength={160}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-summary">Resumen</Label>
                <Textarea
                  id="project-summary"
                  value={projectSummary}
                  onChange={event => setProjectSummary(event.target.value)}
                  placeholder="Descripción breve para identificar el perfil"
                  rows={3}
                  maxLength={2000}
                  className="rounded-2xl"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Plazas vinculadas al RAG</Label>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-border/70 bg-muted/30 p-2">
                {(positions.data ?? []).map((position: any) => {
                  const checked = checkedPositions.has(Number(position.id));
                  return (
                    <label
                      key={position.id}
                      className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-700"
                        checked={checked}
                        disabled={!selectedProjectId || saveProject.isPending}
                        onChange={event =>
                          setCheckedPositions(current => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(Number(position.id));
                            } else {
                              next.delete(Number(position.id));
                            }
                            return next;
                          })
                        }
                      />
                      <span className="truncate">{position.title}</span>
                    </label>
                  );
                })}
                {!positions.data?.length && (
                  <p className="p-2 text-xs text-muted-foreground">
                    No existen plazas configuradas.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {checkedPositions.size} plazas vinculadas · se guardan junto
                  con el proyecto
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Marque todas las plazas que compartirán la base de
                conocimiento de este proyecto durante la evaluación del
                agente. La lista escanea las plazas configuradas para
                mantener el RAG actualizado.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedProject
                ? `${selectedProject.position_count ?? 0} plazas · ${selectedProject.file_count ?? 0} archivos · ${selectedProject.folder_count ?? 0} carpetas`
                : "Proyecto nuevo sin archivos"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                className="rounded-full"
                disabled={!projectName.trim() || saveProject.isPending}
                onClick={() =>
                  saveProject.mutate({
                    id: selectedProjectId ?? undefined,
                    name: projectName.trim(),
                    summary: projectSummary.trim(),
                    positionIds: Array.from(checkedPositions),
                  })
                }
              >
                <Save className="mr-2 h-4 w-4" /> Guardar proyecto
              </Button>
              {selectedProjectId ? (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    if (
                      window.confirm(
                        "¿Desea eliminar este proyecto junto con sus archivos y análisis?"
                      )
                    ) {
                      deleteProject.mutate({ id: selectedProjectId });
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Eliminar proyecto
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-primary">
                Análisis de Documento de IA
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                El clic sobre un archivo carga su resumen en la caja azul y su
                análisis profundo en el editor.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700 dark:text-sky-300" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-sky-900 dark:text-sky-100">
                  Resumen del documento · máximo 66 palabras
                </p>
                <p className="mt-2 text-sm leading-6 text-sky-800 dark:text-sky-200">
                  {selectedFile?.summary_66
                    ? selectedFile.summary_66
                    : "Seleccione un archivo para cargar aquí su resumen generado por IA."}
                </p>
                {selectedFile && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full">
                      {formatBytes(selectedFile.size_bytes)}
                    </Badge>
                    <Badge variant="outline" className="rounded-full">
                      {selectedFile.extension}
                    </Badge>
                    {selectedFile.analysis_status === "analizado" ? (
                      <Badge className="rounded-full bg-emerald-100 text-emerald-800">
                        Analizado con IA
                      </Badge>
                    ) : selectedFile.analysis_status === "pendiente" ? (
                      <Badge className="rounded-full bg-amber-100 text-amber-800">
                        Análisis pendiente
                      </Badge>
                    ) : selectedFile.analysis_status === "no_aplica" ? (
                      <Badge className="rounded-full bg-slate-100 text-slate-700">
                        Sin análisis aplicable
                      </Badge>
                    ) : (
                      <Badge className="rounded-full bg-red-100 text-red-800">
                        Error de análisis
                      </Badge>
                    )}
                    {isAnalyzable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={analyzeFile.isPending}
                        onClick={() =>
                          analyzeFile.mutate({ id: selectedFile.id })
                        }
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        {analyzeFile.isPending
                          ? "Analizando…"
                          : "Generar análisis de IA"}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="deep-analysis">
                Análisis profundo del documento · base de conocimiento del
                agente
              </Label>
              <span
                className={`text-xs ${deepLimitExceeded ? "font-semibold text-red-700" : "text-muted-foreground"}`}
              >
                {deepWords} / 325 palabras
              </span>
            </div>
            <Textarea
              id="deep-analysis"
              value={deepEditor}
              onChange={event => setDeepEditor(event.target.value)}
              placeholder="Análisis profundo del documento: en qué consiste, su propósito, alcance, responsables y reglas clave. Máximo 325 palabras."
              rows={7}
              maxLength={8000}
              className="rounded-2xl"
            />
            {deepLimitExceeded && (
              <p className="text-sm text-red-700">
                El análisis supera el máximo de 325 palabras; reduzca el texto
                antes de guardar.
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                className="rounded-full"
                disabled={
                  !selectedFile || deepLimitExceeded || saveAnalysis.isPending
                }
                onClick={() =>
                  saveAnalysis.mutate({
                    id: selectedFile!.id,
                    deepAnalysis: deepEditor.trim(),
                    summary: selectedFile?.summary_66 || undefined,
                  })
                }
              >
                <Save className="mr-2 h-4 w-4" /> Guardar análisis
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-xl text-primary">RAG</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedProject ? String(selectedProject.name) : "Proyecto"} ·
                base de conocimiento con archivos y visores integrados.
              </p>
            </div>
            <Badge
              variant="outline"
              className="self-start rounded-full sm:self-auto"
            >
              Fuente de aprendizaje del Agente de IA
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          {storageHealth.data ? (
            <p className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="font-semibold text-primary">
                Custodia de los documentos:
              </span>
              {storageHealth.data.storageMode === "dropbox"
                ? `Dropbox del proyecto · ${storageHealth.data.registered} documento(s) en la carpeta del proyecto`
                : `volumen del servidor · ${storageHealth.data.directory} (sin custodia de Dropbox)`}
              {storageHealth.data.custody === "mixta"
                ? " · parte del catálogo sigue en el volumen: la migración del proyecto la completa"
                : null}
              {storageHealth.data.unverified
                ? ` · ${storageHealth.data.unverified} documento(s) sin verificar en este alcance`
                : null}
            </p>
          ) : null}
          {storageHealth.data && storageHealth.data.missing > 0 ? (
            <div className="mb-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-primary">
                  {storageHealth.data.missing} de{" "}
                  {storageHealth.data.verified} documentos verificados no están
                  en su medio de custodia
                </p>
                {storageHealth.data.missingInVolume > 0 ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {storageHealth.data.missingInVolume} no está(n) en el volumen
                    del servidor ({" "}
                    <span className="font-mono">
                      {storageHealth.data.directory}
                    </span>
                    ). El registro existe en la base de datos, pero el archivo
                    binario no se encuentra en la ruta configurada. Verifique que
                    KNOWLEDGE_STORAGE_DIR apunte a un volumen persistente en
                    EasyPanel y vuelva a cargar los documentos afectados.
                  </p>
                ) : null}
                {storageHealth.data.missingInDropbox > 0 ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {storageHealth.data.missingInDropbox} no está(n) en la
                    carpeta del proyecto en Dropbox. Verifique que la cuenta que
                    respalda el proyecto siga conectada en «Mi cuenta» y que la
                    carpeta del proyecto no se haya movido ni depurado; después
                    vuelva a cargar los documentos afectados.
                  </p>
                ) : null}
                {storageHealth.data.missingSample.length ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Afectados, entre otros:{" "}
                    {storageHealth.data.missingSample
                      .slice(0, 3)
                      .map(file => file.originalName)
                      .join("; ")}
                    .
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {storageHealth.data &&
          storageHealth.data.missing === 0 &&
          storageHealth.data.custody === "volumen" ? (
            <div className="mb-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="text-xs leading-5 text-muted-foreground">
                El proyecto custodia sus documentos en el volumen del servidor,
                no en Dropbox: lo que se cargue aquí no se sincroniza con la
                carpeta del proyecto. Active la custodia en Dropbox y ejecute la
                migración desde «Custodia de proyectos» para que el RAG y la
                carpeta del proyecto sean el mismo conjunto de archivos.
              </p>
            </div>
          ) : null}
          {storageHealth.data && !storageHealth.data.directoryExists ? (
            <div className="mb-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="text-xs leading-5 text-muted-foreground">
                El directorio de almacenamiento{" "}
                <span className="font-mono">
                  {storageHealth.data.directory}
                </span>{" "}
                no existe todavía en este proceso. Se creará al cargar el primer
                documento; si esperaba encontrar archivos previos, el volumen
                persistente no está montado.
              </p>
            </div>
          ) : null}
          {storageHealth.data &&
          storageHealth.data.directoryExists &&
          !storageHealth.data.writable ? (
            <div className="mb-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
              <p className="text-xs leading-5 text-muted-foreground">
                El volumen de almacenamiento existe pero el servicio no puede
                escribir en él; las cargas nuevas fallarán.
              </p>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[220px_280px_minmax(0,1fr)]">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                    variant={kindFilter === value ? "default" : "ghost"}
                    size="sm"
                    className="justify-start rounded-full lg:rounded-xl"
                    onClick={() => setKindFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Carpetas
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {folderRows.length}
                  </span>
                </div>
                <Button
                  type="button"
                  variant={selectedFolderId === null ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start rounded-xl"
                  onClick={() => {
                    setSelectedFolderId(null);
                    setViewerOpen(false);
                  }}
                >
                  <FolderOpen className="mr-2 h-4 w-4" /> Inicio
                </Button>
                {rootFolders.map(folder => (
                  <FolderNode
                    key={folder.id}
                    folder={folder}
                    childrenOf={childrenOf}
                    selectedFolderId={selectedFolderId}
                    onSelect={id => {
                      setSelectedFolderId(id);
                      setViewerOpen(false);
                    }}
                    onDelete={id => deleteFolder.mutate({ id })}
                  />
                ))}
                <div className="flex items-center gap-2 pt-2">
                  <Input
                    value={newFolderName}
                    onChange={event => setNewFolderName(event.target.value)}
                    placeholder="Nombre de la carpeta"
                    className="rounded-xl text-sm"
                    maxLength={160}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 rounded-full"
                    disabled={!newFolderName.trim() || !selectedProjectId}
                    aria-label="Crear carpeta"
                    title="Crear carpeta"
                    onClick={() =>
                      createFolder.mutate({
                        projectId: selectedProjectId!,
                        parentId: selectedFolderId,
                        name: newFolderName.trim(),
                      })
                    }
                  >
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Descripción de Archivo
              </p>
              {selectedFile ? (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Nombre</dt>
                    <dd className="break-words font-medium text-primary">
                      {selectedFile.original_name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Fecha de subida
                    </dt>
                    <dd>{formatDateTime(selectedFile.uploaded_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Peso</dt>
                    <dd>{formatBytes(selectedFile.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Extensión</dt>
                    <dd className="uppercase">{selectedFile.extension}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Subido por
                    </dt>
                    <dd>
                      {selectedFile.uploaded_by_name ??
                        selectedFile.uploaded_by_email ??
                        "Usuario registrado"}{" "}
                      · {formatDateTime(selectedFile.uploaded_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Carpeta</dt>
                    <dd>{folderPathLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tipo</dt>
                    <dd>{kindLabel(kind)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Acción esperada
                    </dt>
                    <dd>Abrir una hoja administrativa</dd>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Select
                      value={
                        selectedFile.folder_id
                          ? String(selectedFile.folder_id)
                          : "root"
                      }
                      onValueChange={value =>
                        moveFile.mutate({
                          id: selectedFile.id,
                          folderId: value === "root" ? null : Number(value),
                        })
                      }
                    >
                      <SelectTrigger className="h-9 rounded-full text-xs">
                        <SelectValue placeholder="Mover a carpeta" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="root">Inicio</SelectItem>
                        {folderRows.map(folder => (
                          <SelectItem key={folder.id} value={String(folder.id)}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => {
                        if (
                          window.confirm(
                            "¿Desea eliminar este archivo y su análisis?"
                          )
                        ) {
                          deleteFile.mutate({ id: selectedFile.id });
                        }
                      }}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> Eliminar
                    </Button>
                  </div>
                </dl>
              ) : (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Inicio</p>
                  <p>{formatDateTime(new Date())}</p>
                  <p>Acción esperada</p>
                  <p>Abrir una hoja administrativa</p>
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-primary">
                  Archivos del proyecto
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {fileRows.length} de {files.data?.length ?? 0}
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder="Buscar…"
                      className="w-44 rounded-full pl-9 text-sm"
                    />
                  </div>
                  <label className="inline-flex">
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-full"
                      disabled={!selectedProjectId || uploadFile.isPending}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadFile.isPending ? "Cargando…" : "Cargar"}
                    </Button>
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept={settings.data?.allowedExtensions
                        .map(extension => `.${extension}`)
                        .join(",")}
                      onChange={event => {
                        for (const file of Array.from(event.target.files ?? [])) {
                          void uploadFileObject(file);
                        }
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              {!viewerOpen || !selectedFile ? (
                <div
                  className={`rounded-2xl border-2 border-dashed p-4 transition ${dragging ? "border-emerald-500 bg-emerald-50/60" : "border-border bg-muted/20"}`}
                  onDragOver={event => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  {fileRows.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                      <Upload className="h-10 w-10 text-muted-foreground" />
                      <p className="text-sm font-semibold text-primary">
                        + Arrastre y Suelte
                      </p>
                      <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                        Suelte aquí archivos multimedia, PDF o Word. El peso
                        máximo permitido es {settings.data?.maxSizeMb ?? 20} MB
                        por archivo (Configuración &gt; Conocimiento de
                        proyectos).
                      </p>
                      <p className="text-xs text-muted-foreground">
                        No hay archivos para mostrar
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {fileRows.map(file => {
                        const Icon = kindIcon(file.extension);
                        return (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => {
                              setSelectedFileId(file.id);
                              setViewerOpen(true);
                            }}
                            aria-pressed={selectedFileId === file.id}
                            className="rounded-2xl border border-border/70 bg-card p-3 text-left transition hover:border-primary hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="mb-2 grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                              <Icon className="h-6 w-6" />
                            </div>
                            <p className="truncate text-sm font-medium text-primary">
                              {file.original_name}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatBytes(file.size_bytes)} ·{" "}
                              {kindLabel(kindOfExtension(file.extension))}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {formatDateTime(file.uploaded_at)}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-primary">
                      {selectedFile.original_name}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => setViewerOpen(false)}
                    >
                      <X className="mr-1.5 h-4 w-4" /> Cerrar visor
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-xl bg-card">
                    {kind === "imagen" && (
                      <img
                        src={viewerUrl}
                        alt={selectedFile.original_name}
                        className="mx-auto max-h-[440px] w-auto object-contain"
                      />
                    )}
                    {kind === "video" && (
                      <video
                        src={viewerUrl}
                        controls
                        className="mx-auto max-h-[440px] w-full"
                      />
                    )}
                    {kind === "audio" && (
                      <div className="p-6">
                        <div className="mb-3 flex items-center gap-2 text-muted-foreground">
                          <AudioLines className="h-5 w-5" />
                          <span>{selectedFile.original_name}</span>
                        </div>
                        <audio src={viewerUrl} controls className="w-full" />
                      </div>
                    )}
                    {selectedFile.extension === "pdf" && (
                      <iframe
                        src={viewerUrl}
                        title={selectedFile.original_name}
                        className="h-[440px] w-full"
                      />
                    )}
                    {isRenderable && (
                      <iframe
                        src={renderUrl}
                        title={selectedFile.original_name}
                        className="h-[440px] w-full bg-white"
                      />
                    )}
                    {selectedFile.extension === "doc" && (
                      <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                        <p className="max-w-md text-sm text-muted-foreground">
                          El formato Word heredado (.doc) no dispone de vista
                          previa integrada. Conviértalo a .docx para
                          previsualizarlo aquí o descargue el archivo.
                        </p>
                        <a
                          href={viewerUrl}
                          download={selectedFile.original_name}
                          className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                        >
                          Descargar archivo
                        </a>
                      </div>
                    )}
                    {!isRenderable &&
                      !["doc", "pdf", "jpg", "jpeg", "png", "mp4", "mp3"].includes(
                        selectedFile.extension
                      ) && (
                        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
                          <FileText className="h-10 w-10 text-muted-foreground" />
                          <p className="max-w-md text-sm text-muted-foreground">
                            Este tipo de archivo no dispone de vista previa
                            integrada. Utilice el análisis de IA o descargue el
                            archivo para revisarlo en su aplicación de
                            escritorio.
                          </p>
                          <a
                            href={viewerUrl}
                            download={selectedFile.original_name}
                            className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                          >
                            Descargar archivo
                          </a>
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {methodology.data?.length ? (
        <details className="group rounded-3xl border border-border/70 bg-card shadow-soft">
          <summary className="flex cursor-pointer items-center gap-3 p-5 text-sm font-semibold text-primary">
            <BookOpenText className="h-5 w-5 text-emerald-700" />
            Metodología institucional SIERA y MST-EIR
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {methodology.data.length} documentos versionados
            </span>
          </summary>
          <div className="space-y-6 border-t border-border/60 p-5">
            {methodology.data.map(document => (
              <DocumentEditor
                key={document.document_key}
                document={document as MethodologyDocument}
                onSaved={() => methodology.refetch()}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FolderNode({
  folder,
  childrenOf,
  selectedFolderId,
  onSelect,
  onDelete,
}: {
  folder: KnowledgeFolderRow;
  childrenOf: (parentId: number) => KnowledgeFolderRow[];
  selectedFolderId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const children = childrenOf(folder.id);
  const active = selectedFolderId === folder.id;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="sm"
          className="min-w-0 flex-1 justify-start rounded-xl"
          onClick={() => onSelect(folder.id)}
        >
          <Folder className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{folder.name}</span>
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground"
          aria-label={`Eliminar carpeta ${folder.name}`}
          title="Eliminar carpeta"
          onClick={() => {
            if (
              window.confirm(
                `¿Desea eliminar la carpeta «${folder.name}»? Los archivos regresan a Inicio.`
              )
            ) {
              onDelete(folder.id);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {children.length > 0 && (
        <div className="ml-4 space-y-1 border-l border-border/60 pl-2">
          {children.map(child => (
            <FolderNode
              key={child.id}
              folder={child}
              childrenOf={childrenOf}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentEditor({
  document,
  onSaved,
}: {
  document: MethodologyDocument;
  onSaved: () => Promise<unknown>;
}) {
  const [content, setContent] = useState(document.content_markdown);
  const saveDocument = trpc.mstEir.saveDocument.useMutation({
    onSuccess: async result => {
      setContent(result.content_markdown);
      await onSaved();
      toast.success(
        result.unchanged
          ? `${document.display_name} no tenía cambios`
          : `${document.display_name} guardado como versión ${result.version}`
      );
    },
    onError: error =>
      toast.error(
        `No fue posible guardar ${document.display_name}: ${error.message}`
      ),
  });

  useEffect(() => {
    setContent(document.content_markdown);
  }, [document.id, document.version, document.content_markdown]);

  const changed = content !== document.content_markdown;
  const isSiera = document.document_key === "siera";

  return (
    <Card className="rounded-2xl border border-border/70 shadow-none">
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex gap-3">
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isSiera ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}
            >
              <BookOpenText className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-primary">
                {isSiera ? "1) SIERA" : "2) Modelo MST-EIR"}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {document.display_name}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full">
              Versión {document.version}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              <History className="mr-1 h-3.5 w-3.5" />
              {document.revision_count} revisiones
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          rows={24}
          spellCheck
          className="min-h-[34rem] resize-y rounded-2xl font-mono text-sm leading-6"
          aria-label={`Contenido de ${document.display_name}`}
        />
        <div className="flex flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <div>
            <span>{content.length.toLocaleString("es-GT")} caracteres</span>
            <span className="mx-2">·</span>
            <span>
              Última actualización:{" "}
              {new Date(document.updated_at).toLocaleString("es-GT")}
              {document.updated_by_name
                ? ` por ${document.updated_by_name}`
                : " · carga inicial"}
            </span>
          </div>
          <span>{changed ? "Cambios sin guardar" : "Contenido guardado"}</span>
        </div>
        <Button
          type="button"
          onClick={() =>
            saveDocument.mutate({
              documentKey: document.document_key,
              contentMarkdown: content,
              expectedVersion: Number(document.version),
            })
          }
          disabled={
            !changed ||
            !content.length ||
            content.length > 100_000 ||
            saveDocument.isPending
          }
          className="rounded-full"
        >
          <Save className="mr-2 h-4 w-4" />
          {saveDocument.isPending
            ? "Guardando…"
            : isSiera
              ? "Guardar SIERA"
              : "Guardar Modelo MST-EIR"}
        </Button>
        {content.length > 100_000 && (
          <p className="text-sm text-red-700">
            El documento supera el máximo de 100,000 caracteres.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

