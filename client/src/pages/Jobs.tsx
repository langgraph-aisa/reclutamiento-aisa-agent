import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PublicFormPreview } from "@/components/PublicFormPreview";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FolderKanban,
  Globe2,
  MessageSquareText,
  Plus,
  Radio,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

type Draft = {
  id?: number;
  code: string;
  title: string;
  department: string;
  locationLabel: string;
  description: string;
  agentKey: string;
  whatsappMessage: string;
  defaultCountry: string;
  published: boolean;
  screeningPrecalificacionEnabled: boolean;
  screeningEntrevistaEnabled: boolean;
};
const blank: Draft = {
  code: "",
  title: "",
  department: "",
  locationLabel: "",
  description: "",
  agentKey: "",
  whatsappMessage:
    "Hola {{nombre}}, muchas gracias por su solicitud de empleo.\n\nLe saludamos de parte de AISA Solar. Dando seguimiento a su solicitud de empleo para la plaza “{{plaza}}”, por este medio agradeceríamos que pudiera enviarnos su CV para que sea evaluado por nuestro equipo de Recursos Humanos.\n\nQuedamos atentos a recibirlo. ¡Muchas gracias por su interés en formar parte de AISA Solar!",
  defaultCountry: "GT",
  published: false,
  screeningPrecalificacionEnabled: true,
  screeningEntrevistaEnabled: true,
};

export default function Jobs() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const query = trpc.positions.list.useQuery();
  const upsert = trpc.positions.upsert.useMutation({
    onSuccess: () => {
      toast.success("Plaza revisada editorialmente y guardada");
      query.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const setPublished = trpc.positions.setPublished.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(
        variables.published
          ? "Plaza publicada correctamente"
          : "Plaza retirada de la landing"
      );
      query.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.positions.remove.useMutation({
    onSuccess: () => query.refetch(),
  });
  const setPhaseEnabled = trpc.screening.setPhaseEnabled.useMutation({
    onSuccess: () => query.refetch(),
    onError: error => toast.error(error.message),
  });
  const createForm = trpc.forms.upsert.useMutation({
    onSuccess: (created: any, variables) => {
      toast.success("Formulario creado");
      utils.forms.listByPosition.invalidate({
        positionId: variables.positionId,
      });
      query.refetch();
      window.location.assign(
        `/admin/forms/${variables.positionId}?formId=${created.id}`
      );
    },
    onError: error => toast.error(error.message),
  });
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [search, setSearch] = useState("");
  const [linkDialogPosition, setLinkDialogPosition] = useState<number | null>(
    null
  );
  const [draftProjectIds, setDraftProjectIds] = useState<Set<number>>(
    new Set()
  );
  const [importPositionId, setImportPositionId] = useState<number | null>(null);
  const [screeningTarget, setScreeningTarget] = useState<{
    positionId: number;
    phase: "precalificacion" | "entrevista";
  } | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importBase64, setImportBase64] = useState("");
  const [importReading, setImportReading] = useState(false);
  const importForm = trpc.forms.importSpreadsheet.useMutation({
    onSuccess: result => {
      toast.success(
        `${
          result.reusedForm
            ? "Importación aplicada al formulario existente de la plaza"
            : "Importación completada"
        }: ${result.rowsImported} filas con respuestas, ${result.candidatesCreated} candidatos nuevos, ${result.applicationsCreated} postulaciones nuevas y ${result.answersInserted} respuestas agregadas.`
      );
      if (importPositionId)
        utils.forms.listByPosition.invalidate({ positionId: importPositionId });
      query.refetch();
      setImportPositionId(null);
      setImportFileName("");
      setImportBase64("");
    },
    onError: error =>
      toast.error(`No fue posible importar el formulario: ${error.message}`),
  });
  const onImportFile = (file: File) => {
    setImportReading(true);
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      setImportBase64(raw.includes(",") ? raw.split(",")[1] ?? raw : raw);
      setImportReading(false);
    };
    reader.onerror = () => {
      toast.error("No fue posible leer el archivo seleccionado.");
      setImportReading(false);
    };
    reader.readAsDataURL(file);
  };
  const knowledgeProjects = trpc.knowledge.projects.useQuery(undefined, {
    enabled: isAdmin,
  });
  const positionProjectsMatrix = trpc.knowledge.positionProjectsMatrix.useQuery(
    undefined,
    { enabled: isAdmin }
  );
  const savePositionProjects = trpc.knowledge.savePositionProjects.useMutation({
    onSuccess: () => {
      toast.success("Proyectos vinculados actualizados.");
      positionProjectsMatrix.refetch();
      setLinkDialogPosition(null);
    },
    onError: error => toast.error(error.message),
  });
  const linkedProjectsFor = (positionId: number) =>
    (positionProjectsMatrix.data ?? []).filter(
      (link: any) => Number(link.position_id) === positionId
    );
  const openLinkDialog = (positionId: number) => {
    const linked = linkedProjectsFor(positionId).map((link: any) =>
      Number(link.project_id)
    );
    setDraftProjectIds(new Set(linked));
    setLinkDialogPosition(positionId);
  };
  const jobs = (query.data ?? []).filter(
    (job: any) =>
      !search ||
      `${job.title} ${job.department ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const openNew = () => {
    setDraft(blank);
    setShowForm(true);
  };
  const openEdit = (job: any) => {
    setDraft({
      id: job.id,
      code: job.code,
      title: job.title,
      department: job.department ?? "",
      locationLabel: job.location_label ?? "",
      description: job.description ?? "",
      agentKey: job.agent_key,
      whatsappMessage: job.whatsapp_message ?? blank.whatsappMessage,
      defaultCountry: job.default_country ?? "GT",
      published: job.published,
      screeningPrecalificacionEnabled:
        job.screening_precalificacion_enabled ?? true,
      screeningEntrevistaEnabled: job.screening_entrevista_enabled ?? true,
    });
    setShowForm(true);
  };
  const save = async () => {
    if (!draft.code || !draft.title || !draft.agentKey) return;
    await upsert.mutateAsync(draft);
    setDraft(blank);
    setShowForm(false);
  };
  const [managingPositionId, setManagingPositionId] = useState<number | null>(
    null
  );
  const managingPosition =
    jobs.find((job: any) => Number(job.id) === managingPositionId) ?? null;

  const actionButtons = (job: any) => (
    <div className="mt-4 flex flex-wrap gap-2">
      <Link href={`/admin/candidates?position=${job.id}`}>
        <Button variant="outline" size="sm" className="rounded-full">
          <Users className="mr-2 h-3.5 w-3.5" />
          Candidatos
        </Button>
      </Link>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() =>
          setScreeningTarget({
            positionId: Number(job.id),
            phase: "precalificacion",
          })
        }
      >
        <Sparkles className="mr-2 h-3.5 w-3.5" />
        Precalificación IA
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() =>
          setScreeningTarget({
            positionId: Number(job.id),
            phase: "entrevista",
          })
        }
      >
        <MessageSquareText className="mr-2 h-3.5 w-3.5" />
        Entrevista IA
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openEdit(job)}
        className="rounded-full"
      >
        <Edit3 className="mr-2 h-3.5 w-3.5" />
        Editar
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          setPublished.mutate({ id: job.id, published: !job.published })
        }
        className="rounded-full"
      >
        {job.published ? "Despublicar" : "Publicar"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          window.confirm("¿Eliminar esta plaza y su formulario?") &&
          remove.mutate({ id: job.id })
        }
        className="rounded-full text-red-700 hover:bg-red-50"
      >
        <Trash2 className="mr-2 h-3.5 w-3.5" />
        Eliminar
      </Button>
    </div>
  );

  const renderProjects = (job: any) => (
    <div className="rounded-2xl bg-sky-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Proyectos RAG
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => openLinkDialog(Number(job.id))}
        >
          <FolderKanban className="mr-2 h-3.5 w-3.5" />
          Vincular proyectos
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {linkedProjectsFor(Number(job.id)).length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Sin proyectos vinculados
          </span>
        ) : (
          linkedProjectsFor(Number(job.id)).map((link: any) => (
            <Badge
              key={link.project_id}
              className="rounded-full bg-sky-100 text-sky-800"
            >
              {link.project_name}
            </Badge>
          ))
        )}
      </div>
    </div>
  );

  const renderForms = (job: any) => (
    <div className="rounded-2xl bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Formularios y anuncios
        </p>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setImportPositionId(Number(job.id))}
            >
              <Upload className="mr-2 h-3.5 w-3.5" />
              Importar Excel/CSV
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={() =>
                createForm.mutate({
                  positionId: Number(job.id),
                  title: `Formulario · ${job.title}`,
                  intro: "Complete sus datos para postularse a esta plaza.",
                })
              }
              disabled={createForm.isPending}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Nuevo formulario
            </Button>
          </div>
        )}
      </div>
      <PositionForms positionId={Number(job.id)} isAdmin={isAdmin} />
    </div>
  );

  return (
    <div className="space-y-7">
      {managingPosition ? (
        <div className="space-y-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <button
                type="button"
                onClick={() => setManagingPositionId(null)}
                className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-primary"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver a plazas
              </button>
              <h1 className="text-3xl font-800 tracking-[-.03em] text-primary">
                {managingPosition.title}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {managingPosition.department ?? "Sin área"} ·{" "}
                {managingPosition.location_label ?? "Guatemala"}
              </p>
            </div>
            <Badge
              className={
                managingPosition.published
                  ? "rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                  : "rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100"
              }
            >
              {managingPosition.published ? "Publicada" : "Borrador"}
            </Badge>
          </div>
          {isAdmin && actionButtons(managingPosition)}
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-border/70 bg-muted/40 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Switch
                  checked={Boolean(
                    managingPosition.screening_precalificacion_enabled
                  )}
                  onCheckedChange={enabled =>
                    setPhaseEnabled.mutate({
                      positionId: Number(managingPosition.id),
                      phase: "precalificacion",
                      enabled,
                    })
                  }
                  disabled={setPhaseEnabled.isPending}
                  aria-label="Activar la precalificación de la plaza"
                />
                Precalificación activa
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Switch
                  checked={Boolean(
                    managingPosition.screening_entrevista_enabled
                  )}
                  onCheckedChange={enabled =>
                    setPhaseEnabled.mutate({
                      positionId: Number(managingPosition.id),
                      phase: "entrevista",
                      enabled,
                    })
                  }
                  disabled={setPhaseEnabled.isPending}
                  aria-label="Activar la entrevista de la plaza"
                />
                Entrevista activa
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">
              {managingPosition.applications_count ?? 0} postulaciones
            </span>
            <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">
              {managingPosition.agent_key}
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
              <Globe2 className="mr-1 inline h-3.5 w-3.5" />
              {managingPosition.default_country ?? "GT"}
            </span>
          </div>
          {isAdmin && renderProjects(managingPosition)}
          {renderForms(managingPosition)}
        </div>
      ) : (
        <>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            {isAdmin ? "Configuración" : "Vista de consulta"}
          </p>
          <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
            Plazas y Anuncios
          </h1>
          <p className="mt-2 text-muted-foreground">
            {isAdmin
              ? "Cada plaza administra sus anuncios, formularios propios e importados, reglas y agente evaluador."
              : "Consulte plazas, estados de publicación y enlaces públicos disponibles."}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openNew} className="rounded-full">
            <Plus className="mr-2 h-4 w-4" />
            Nueva plaza
          </Button>
        )}
      </div>
      {isAdmin && showForm && (
        <Card className="rounded-3xl border-emerald-200 bg-emerald-50/35 shadow-soft">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl text-primary">
                {draft.id ? "Editar plaza" : "Crear plaza y agente"}
              </CardTitle>
              <Badge variant="outline" className="rounded-full">
                Campos internos protegidos
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Field label="Código interno">
              <Input
                value={draft.code}
                onChange={event =>
                  setDraft({ ...draft, code: event.target.value })
                }
                placeholder="VEN-2026"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Nombre de la plaza">
              <Input
                value={draft.title}
                onChange={event =>
                  setDraft({ ...draft, title: event.target.value })
                }
                placeholder="Vendedor de campo"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Área / departamento">
              <Input
                value={draft.department}
                onChange={event =>
                  setDraft({ ...draft, department: event.target.value })
                }
                placeholder="Comercial"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Agente evaluador">
              <Input
                value={draft.agentKey}
                onChange={event =>
                  setDraft({ ...draft, agentKey: event.target.value })
                }
                placeholder="evaluador-vendedor"
                className="rounded-2xl"
              />
            </Field>
            <Field label="País predeterminado">
              <Input
                value={draft.defaultCountry}
                onChange={event =>
                  setDraft({
                    ...draft,
                    defaultCountry: event.target.value
                      .toUpperCase()
                      .slice(0, 2),
                  })
                }
                placeholder="GT"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Ubicación visible">
              <Input
                value={draft.locationLabel}
                onChange={event =>
                  setDraft({ ...draft, locationLabel: event.target.value })
                }
                placeholder="Ciudad de Guatemala"
                className="rounded-2xl"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Descripción">
                <Textarea
                  value={draft.description}
                  onChange={event =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  placeholder="Describa la oportunidad…"
                  className="rounded-2xl"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Mensaje de solicitud de CV">
                <Textarea
                  value={draft.whatsappMessage}
                  onChange={event =>
                    setDraft({ ...draft, whatsappMessage: event.target.value })
                  }
                  placeholder="Utilice {{nombre}} y {{plaza}}."
                  className="rounded-2xl"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Debe conservar las variables {"{{nombre}}"} y {"{{plaza}}"};
                  si falta alguna se utilizará el mensaje estándar aprobado.
                </p>
              </Field>
            </div>
            <div className="flex gap-3 sm:col-span-2">
              <Button
                onClick={save}
                disabled={upsert.isPending}
                className="rounded-full"
              >
                {upsert.isPending ? "Guardando…" : "Guardar plaza"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowForm(false)}
                className="rounded-full"
              >
                Cancelar
              </Button>
            </div>
            {upsert.error && (
              <p className="text-sm text-red-700 sm:col-span-2">
                {upsert.error.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      <div className="flex items-center justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="rounded-full pl-10"
            placeholder="Buscar plaza…"
          />
        </div>
        <Badge variant="outline" className="hidden rounded-full sm:flex">
          {jobs.length} visibles
        </Badge>
      </div>
      {jobs.length === 0 ? (
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <BriefcaseBusiness className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-xl font-800 text-primary">
              Aún no hay plazas configuradas
            </h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {isAdmin
                ? "Cree la primera plaza para generar su identificador seguro y formulario base."
                : "Un administrador debe crear y publicar las plazas."}
            </p>
            {isAdmin && (
              <Button onClick={openNew} className="mt-6 rounded-full">
                Crear primera plaza
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job: any) => (
            <Card key={job.id} className="rounded-3xl border-0 shadow-soft">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
                      <BriefcaseBusiness className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="font-800 text-primary">{job.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {job.department ?? "Sin área"} ·{" "}
                        {job.location_label ?? "Guatemala"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        job.published
                          ? "rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                          : "rounded-full bg-amber-100 text-amber-800 hover:bg-amber-100"
                      }
                    >
                      {job.published ? "Publicada" : "Borrador"}
                    </Badge>
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={() => setManagingPositionId(Number(job.id))}
                    >
                      <FolderKanban className="mr-2 h-3.5 w-3.5" />
                      {isAdmin ? "Gestionar" : "Ver"}
                    </Button>
                  </div>
                </div>
                {isAdmin && actionButtons(job)}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-700">
                    {job.applications_count ?? 0} postulaciones
                  </span>
                  <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">
                    {job.agent_key}
                  </span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                    <Globe2 className="mr-1 inline h-3.5 w-3.5" />
                    {job.default_country ?? "GT"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Card className="rounded-3xl border-0 bg-[#0b2d4b] text-white shadow-soft dark:bg-[#162333]">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/10">
              <Radio className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <p className="font-semibold text-white">
                {isAdmin ? "Seguimiento por plaza" : "Acceso de consulta"}
              </p>
              <p className="mt-1 text-sm text-white/60">
                {isAdmin
                  ? "Defina las preguntas de precalificación y entrevista; el agente las administra en orden después de recibir el CV."
                  : "La configuración de formularios y perfiles está reservada al rol Administrador."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
        </>
      )}

      <ScreeningDialog
        target={screeningTarget}
        onClose={() => setScreeningTarget(null)}
      />

      <Dialog
        open={linkDialogPosition !== null}
        onOpenChange={open => {
          if (!open) setLinkDialogPosition(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              Vincular proyectos RAG a esta plaza
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Los proyectos marcados alimentarán al Agente de IA con su base de
              conocimiento durante la evaluación de esta plaza.
            </p>
          </DialogHeader>
          <div className="max-h-96 space-y-1 overflow-y-auto rounded-2xl border border-border/70 bg-muted/30 p-2">
            {(knowledgeProjects.data ?? []).map((project: any) => {
              const checked = draftProjectIds.has(Number(project.id));
              return (
                <label
                  key={project.id}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-700"
                    checked={checked}
                    disabled={savePositionProjects.isPending}
                    onChange={event =>
                      setDraftProjectIds(current => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(Number(project.id));
                        } else {
                          next.delete(Number(project.id));
                        }
                        return next;
                      })
                    }
                  />
                  <span className="truncate">{project.name}</span>
                </label>
              );
            })}
            {!knowledgeProjects.data?.length && (
              <p className="p-2 text-xs text-muted-foreground">
                No existen proyectos configurados.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {draftProjectIds.size} proyectos vinculados
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setLinkDialogPosition(null)}
              >
                <X className="mr-2 h-4 w-4" /> Cerrar
              </Button>
              <Button
                type="button"
                className="rounded-full"
                disabled={savePositionProjects.isPending}
                onClick={() =>
                  savePositionProjects.mutate({
                    positionId: linkDialogPosition!,
                    projectIds: Array.from(draftProjectIds),
                  })
                }
              >
                Guardar vinculaciones
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importPositionId !== null}
        onOpenChange={open => {
          if (!open) {
            setImportPositionId(null);
            setImportFileName("");
            setImportBase64("");
          }
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-primary">
              Importar formulario desde Excel o CSV
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              La primera fila define las preguntas (columnas). La columna de
              teléfono o WhatsApp identifica al candidato: si no está
              registrado, se crea con ese número como única fuente de
              relación. Los candidatos y sus respuestas se cargan de
              inmediato y el formulario queda en borrador.
            </p>
          </DialogHeader>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-border/70 bg-muted/30 p-8 text-center">
            <FileSpreadsheet className="h-8 w-8 text-emerald-700" />
            <span className="text-sm font-semibold text-primary">
              {importFileName || "Seleccione el archivo .csv, .xlsx o .xls"}
            </span>
            <span className="text-xs text-muted-foreground">
              Máximo 5 MB · el WhatsApp es la clave única de cada candidato
            </span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                if (file) onImportFile(file);
                event.target.value = "";
              }}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Las respuestas importadas se agregan sin sobrescribir las
              existentes. Si la plaza ya tiene un formulario con las mismas
              preguntas, la importación agrega las respuestas a ese formulario
              en lugar de crear otro. La evaluación automática con IA no se
              ejecuta en la importación: se solicita cuando la persona
              responsable lo decida.
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setImportPositionId(null)}
              >
                <X className="mr-2 h-4 w-4" /> Cerrar
              </Button>
              <Button
                type="button"
                className="rounded-full"
                disabled={
                  !importBase64 ||
                  importReading ||
                  importForm.isPending ||
                  importPositionId === null
                }
                onClick={() =>
                  importForm.mutate({
                    positionId: importPositionId!,
                    fileName: importFileName,
                    base64: importBase64,
                  })
                }
              >
                <Upload className="mr-2 h-4 w-4" />
                {importForm.isPending
                  ? "Importando…"
                  : "Importar formulario"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PositionForms({
  positionId,
  isAdmin,
}: {
  positionId: number;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const forms = trpc.forms.listByPosition.useQuery({ positionId });
  const [previewFormId, setPreviewFormId] = useState<number | null>(null);
  const [copiedFormId, setCopiedFormId] = useState<number | null>(null);
  const setFormPublished = trpc.forms.setPublished.useMutation({
    onSuccess: (_result, variables) => {
      toast.success(
        variables.published
          ? "Formulario habilitado: su enlace seguro ya recibe candidatos"
          : "Formulario apagado: su enlace deja de estar disponible"
      );
      utils.forms.listByPosition.invalidate({ positionId });
    },
    onError: error =>
      toast.error(`No fue posible cambiar el formulario: ${error.message}`),
  });
  const publicUrl = (form: any) =>
    `${window.location.origin}/apply/f/${form.public_token}`;
  const copyPublicUrl = async (form: any) => {
    await navigator.clipboard?.writeText(publicUrl(form));
    setCopiedFormId(Number(form.id));
    window.setTimeout(() => setCopiedFormId(null), 1400);
  };
  const rows = forms.data ?? [];
  if (!forms.data)
    return <p className="mt-2 text-xs text-muted-foreground">Cargando…</p>;
  if (rows.length === 0)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Sin formularios. {isAdmin ? "Cree o importe uno." : ""}
      </p>
    );
  return (
    <div className="mt-2 space-y-1.5">
      {rows.map((form: any) => (
        <div
          key={form.id}
          className="rounded-xl border border-border/60 bg-background px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-primary">
              Formulario No. {form.version}
            </span>
            <span className="truncate text-muted-foreground">{form.title}</span>
            <Badge
              className={
                form.source === "importado"
                  ? "rounded-full bg-sky-100 text-sky-800"
                  : "rounded-full bg-violet-100 text-violet-800"
              }
            >
              {form.source === "importado" ? "Importado" : "Herramienta"}
            </Badge>
            <Badge
              className={
                form.published
                  ? "rounded-full bg-emerald-100 text-emerald-800"
                  : "rounded-full bg-amber-100 text-amber-800"
              }
            >
              {form.published ? "habilitada" : "borrador"}
            </Badge>
            <span className="text-muted-foreground">
              {form.question_count} preguntas · {form.submission_count}{" "}
              respuestas
            </span>
            {isAdmin ? (
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Switch
                    checked={Boolean(form.published)}
                    disabled={setFormPublished.isPending}
                    onCheckedChange={published =>
                      setFormPublished.mutate({
                        id: Number(form.id),
                        published,
                      })
                    }
                    aria-label={`Encender o apagar el formulario No. ${form.version}`}
                  />
                  {form.published ? "Encendido" : "Apagado"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => copyPublicUrl(form)}
                  aria-label={`Copiar el enlace del formulario No. ${form.version}`}
                >
                  {copiedFormId === Number(form.id) ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copiedFormId === Number(form.id) ? "Copiado" : "Enlace"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() =>
                    window.open(
                      publicUrl(form),
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                  aria-label={`Abrir el formulario público No. ${form.version}`}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Ver público
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setPreviewFormId(Number(form.id))}
                  aria-label={`Ver cómo se ve públicamente el formulario No. ${form.version}`}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  Cómo se ve
                </Button>
                <Link href={`/admin/forms/${positionId}?formId=${form.id}`}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                  >
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                    Preguntas
                  </Button>
                </Link>
                <Link href={`/admin/forms/${positionId}?formId=${form.id}`}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                  >
                    <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                    Editar
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            Enlace seguro: /apply/f/{form.public_token}
          </p>
        </div>
      ))}
      <PublicFormPreview
        formId={previewFormId}
        open={previewFormId !== null}
        onOpenChange={open => {
          if (!open) setPreviewFormId(null);
        }}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-primary">{label}</Label>
      {children}
    </div>
  );
}

type ScreeningTarget = {
  positionId: number;
  phase: "precalificacion" | "entrevista";
} | null;

const SCREENING_PHASE_LABEL: Record<
  "precalificacion" | "entrevista",
  { title: string; subtitle: string }
> = {
  precalificacion: {
    title: "Precalificación por IA",
    subtitle:
      "El agente administra estas preguntas al inicio de la conversación, después de recibir el CV. Active, ordene y defina cuándo una respuesta descarta.",
  },
  entrevista: {
    title: "Entrevista Guiada por IA",
    subtitle:
      "Segunda ronda: el agente administra estas preguntas si la persona supera la precalificación. Active, ordene y defina cuándo una respuesta descarta.",
  },
};

type ScreeningDraft = {
  id?: number;
  fieldKey: string;
  type: string;
  prompt: string;
  helpText: string;
  hardFail: boolean;
  acceptedAnswers: string;
  dependsOnFieldKey: string;
  evaluationCriteria: string;
};

const blankScreeningDraft: ScreeningDraft = {
  fieldKey: "",
  type: "texto",
  prompt: "",
  helpText: "",
  hardFail: false,
  acceptedAnswers: "",
  dependsOnFieldKey: "",
  evaluationCriteria: "",
};

function ScreeningDialog({
  target,
  onClose,
}: {
  target: ScreeningTarget;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const open = target !== null;
  const positionId = target?.positionId ?? 0;
  const phase = target?.phase ?? "precalificacion";
  const questions = trpc.screening.listQuestions.useQuery(
    { positionId },
    { enabled: open }
  );
  const save = trpc.screening.saveQuestion.useMutation({
    onSuccess: () => {
      toast.success("Pregunta guardada");
      utils.screening.listQuestions.invalidate({ positionId });
      setDraft(null);
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.screening.deleteQuestion.useMutation({
    onSuccess: () => {
      utils.screening.listQuestions.invalidate({ positionId });
    },
    onError: error => toast.error(error.message),
  });
  const setActive = trpc.screening.setQuestionActive.useMutation({
    onSuccess: () => {
      utils.screening.listQuestions.invalidate({ positionId });
    },
    onError: error => toast.error(error.message),
  });
  const move = trpc.screening.moveQuestion.useMutation({
    onSuccess: () => {
      utils.screening.listQuestions.invalidate({ positionId });
    },
    onError: error => toast.error(error.message),
  });
  const [draft, setDraft] = useState<ScreeningDraft | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [target]);

  const phaseQuestions = (questions.data ?? []).filter(
    (question: any) => question.phase === phase
  );

  const startEdit = (question: any) => {
    setDraft({
      id: Number(question.id),
      fieldKey: question.field_key,
      type: question.type,
      prompt: question.prompt,
      helpText: question.help_text ?? "",
      hardFail: Boolean(question.hard_fail),
      acceptedAnswers: Array.isArray(question.accepted_answers)
        ? question.accepted_answers.join(", ")
        : "",
      dependsOnFieldKey: question.depends_on_field_key ?? "",
      evaluationCriteria: question.evaluation_criteria ?? "",
    });
  };

  const submit = () => {
    if (!draft || !target) return;
    const acceptedAnswers = draft.acceptedAnswers
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
    save.mutate({
      id: draft.id,
      positionId: target.positionId,
      phase: target.phase,
      fieldKey: draft.fieldKey,
      type: draft.type || "texto",
      prompt: draft.prompt,
      helpText: draft.helpText || undefined,
      hardFail: draft.hardFail,
      acceptedAnswers,
      answerConfig: {},
      evaluationCriteria: draft.evaluationCriteria || undefined,
      dependsOnFieldKey: draft.dependsOnFieldKey || undefined,
      orderIndex: draft.id
        ? (phaseQuestions.find((q: any) => Number(q.id) === draft.id)
            ?.order_index ?? 0)
        : phaseQuestions.length,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-3xl sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-primary">
              {SCREENING_PHASE_LABEL[phase].title}
            </DialogTitle>
            {!draft && (
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => setDraft(blankScreeningDraft)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Agregar pregunta
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {SCREENING_PHASE_LABEL[phase].subtitle}
          </p>
        </DialogHeader>

        {draft ? (
          <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-semibold text-primary">
              {draft.id ? "Editar pregunta y su criterio" : "Nueva pregunta y su criterio"}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Clave del campo">
                <Input
                  value={draft.fieldKey}
                  onChange={event =>
                    setDraft({ ...draft, fieldKey: event.target.value })
                  }
                  placeholder="experiencia_ventas"
                  className="rounded-2xl"
                />
              </Field>
              <Field label="Tipo">
                <Input
                  value={draft.type}
                  onChange={event =>
                    setDraft({ ...draft, type: event.target.value })
                  }
                  placeholder="texto"
                  className="rounded-2xl"
                />
              </Field>
            </div>
            <Field label="Pregunta">
              <Textarea
                value={draft.prompt}
                onChange={event =>
                  setDraft({ ...draft, prompt: event.target.value })
                }
                placeholder="¿Cuántos años de experiencia tiene?"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Ayuda al candidato">
              <Textarea
                value={draft.helpText}
                onChange={event =>
                  setDraft({ ...draft, helpText: event.target.value })
                }
                placeholder="Explique cómo debe responder."
                className="rounded-2xl"
              />
            </Field>
            <div className="flex items-center justify-between rounded-2xl border border-border/60 p-3">
              <div>
                <p className="text-sm font-semibold text-primary">
                  ¿Descalifica si no coincide?
                </p>
                <p className="text-xs text-muted-foreground">
                  Úselo para residencia, licencia u otra condición esencial.
                </p>
              </div>
              <Switch
                checked={draft.hardFail}
                onCheckedChange={checked =>
                  setDraft({ ...draft, hardFail: checked })
                }
                aria-label="Activar el descarte directo de esta pregunta"
              />
            </div>
            {draft.hardFail && (
              <Field label="Respuestas que aprueban la condición">
                <Textarea
                  value={draft.acceptedAnswers}
                  onChange={event =>
                    setDraft({ ...draft, acceptedAnswers: event.target.value })
                  }
                  placeholder="Sí, Guatemala, 12 meses"
                  className="rounded-2xl"
                />
                <p className="text-xs text-muted-foreground">
                  Separe con comas. Si activa el descarte directo, cualquier
                  respuesta distinta puede descalificar automáticamente.
                </p>
              </Field>
            )}
            <Field label="Depende de la pregunta (clave opcional)">
              <Input
                value={draft.dependsOnFieldKey}
                onChange={event =>
                  setDraft({ ...draft, dependsOnFieldKey: event.target.value })
                }
                placeholder="tipo_de_vehiculo"
                className="rounded-2xl"
              />
            </Field>
            <Field label="Criterio de razonamiento para IA">
              <Textarea
                value={draft.evaluationCriteria}
                onChange={event =>
                  setDraft({ ...draft, evaluationCriteria: event.target.value })
                }
                placeholder="Considere que la persona está calificada solo si la experiencia es de 12 meses o más. Si indica meses, conviértalos a meses totales."
                className="rounded-2xl"
              />
            </Field>
            <div className="flex gap-2">
              <Button
                className="rounded-full"
                disabled={save.isPending}
                onClick={submit}
              >
                {save.isPending ? "Guardando…" : "Guardar pregunta"}
              </Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => setDraft(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {phaseQuestions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                Sin preguntas en esta fase. Agregue la primera para que el
                agente la administre al candidato.
              </p>
            ) : (
              phaseQuestions.map((question: any, index: number) => (
                <div
                  key={question.id}
                  className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-primary">
                      {index + 1}. {question.prompt}
                    </span>
                    {Boolean(question.hard_fail) && (
                      <Badge className="rounded-full bg-red-100 text-red-800">
                        Descarte directo
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      {question.field_key}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      {question.type}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <Switch
                        checked={Boolean(question.active)}
                        disabled={setActive.isPending}
                        onCheckedChange={active =>
                          setActive.mutate({
                            id: Number(question.id),
                            active,
                          })
                        }
                        aria-label={`Activar o desactivar la pregunta ${question.prompt}`}
                      />
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      disabled={index === 0 || move.isPending}
                      onClick={() =>
                        move.mutate({ id: Number(question.id), direction: "up" })
                      }
                    >
                      Subir
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      disabled={index === phaseQuestions.length - 1 || move.isPending}
                      onClick={() =>
                        move.mutate({
                          id: Number(question.id),
                          direction: "down",
                        })
                      }
                    >
                      Bajar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => startEdit(question)}
                    >
                      Editar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-red-700 hover:bg-red-50"
                      onClick={() =>
                        window.confirm("¿Eliminar esta pregunta?") &&
                        remove.mutate({ id: Number(question.id) })
                      }
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

