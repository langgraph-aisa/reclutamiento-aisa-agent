import {
  answersFor,
  formatAnswer,
  formatDate,
  humanReviewStamp,
  scoreFor,
} from "@/components/review/CandidateReviewSummary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { VerticalNavigator } from "@/components/VerticalNavigator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { APPLICATION_STATUS_OPTIONS } from "@shared/applicationStatus";
import {
  adjacentReviewResultIndex,
  type ReviewNavigationDirection,
} from "@shared/reviewNavigation";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ClipboardCheck,
  Eye,
  FilterX,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Phone,
  Search,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type SortBy = "submitted_at" | "name" | "score" | "status" | "position";
type SortDirection = "asc" | "desc";

/**
 * Candidatos: búsqueda de postulaciones. Filtros combinables, matriz de
 * resultados y navegación vertical entre resultados. La revisión y la decisión
 * viven en Revisión Humana: el botón «Detalle» de cada fila abre la ficha.
 */
export default function Candidates() {
  const utils = trpc.useUtils();
  const positions = trpc.positions.list.useQuery();
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [positionId, setPositionId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minimumScore, setMinimumScore] = useState("all");
  const [evaluatedOnly, setEvaluatedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("submitted_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const matrixScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const workspace = trpc.candidates.reviewWorkspace.useQuery(
    {
      search: debouncedSearch.trim() || undefined,
      status: status === "all" ? undefined : (status as any),
      positionId: positionId === "all" ? undefined : Number(positionId),
      from: from || undefined,
      to: to || undefined,
      minimumScore: minimumScore === "all" ? undefined : Number(minimumScore),
      evaluatedOnly,
      sortBy,
      sortDirection,
    },
    { placeholderData: previous => previous }
  );
  const rows = workspace.data ?? [];

  useEffect(() => {
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    if (!rows.some((row: any) => row.id === selectedId)) {
      setSelectedId(rows[0].id);
    }
  }, [rows, selectedId]);

  const selected = rows.find((row: any) => row.id === selectedId) ?? rows[0];
  const questionColumns = useMemo(() => {
    const columns = new Map<string, string>();
    for (const row of rows as any[]) {
      for (const answer of answersFor(row)) {
        if (!columns.has(answer.fieldKey)) {
          columns.set(answer.fieldKey, answer.label || answer.fieldKey);
        }
      }
    }
    return Array.from(columns.entries()).map(([fieldKey, label]) => ({
      fieldKey,
      label,
    }));
  }, [rows]);

  const updateStatus = trpc.candidates.setStatus.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.candidates.reviewWorkspace.invalidate(),
        utils.candidates.list.invalidate(),
        utils.candidates.detail.invalidate({ id: result.application.id }),
        utils.dashboard.summary.invalidate(),
        utils.reports.overview.invalidate(),
      ]);
      if (result.whatsapp?.status === "sent") {
        toast.success("Cambio guardado y solicitud de CV enviada por WhatsApp");
      } else if (result.whatsapp?.status === "failed") {
        toast.error("Estado guardado; el envío de WhatsApp requiere revisión");
      } else if (result.whatsapp?.status === "unknown") {
        toast.warning(
          "Estado guardado; confirma el envío antes de reintentarlo"
        );
      } else {
        toast.success("Revisión humana guardada con auditoría");
      }
    },
    onError: error => toast.error(`No fue posible guardar: ${error.message}`),
  });

  const saveReview = async (
    id: number,
    nextStatus: string,
    comment: string
  ) => {
    await updateStatus.mutateAsync({
      id,
      status: nextStatus as any,
      comment: comment.trim() || undefined,
    });
  };

  const selectCandidate = (id: number) => {
    setSelectedId(id);
  };

  const selectedIndex = selected
    ? rows.findIndex((row: any) => row.id === selected.id)
    : -1;

  const moveThroughResults = (direction: ReviewNavigationDirection) => {
    if (!rows.length) return;
    const nextIndex = adjacentReviewResultIndex(
      selectedIndex,
      rows.length,
      direction
    );
    const nextCandidate = rows[nextIndex] as any;
    selectCandidate(nextCandidate.id);
    window.requestAnimationFrame(() => {
      const container = matrixScrollRef.current;
      const row = container?.querySelector<HTMLElement>(
        `[data-review-row="${nextCandidate.id}"]`
      );
      if (!container || !row) return;
      container.scrollTo({
        top: Math.max(0, row.offsetTop - 48),
        behavior: "smooth",
      });
    });
  };

  const changeSort = (column: SortBy) => {
    if (sortBy === column) {
      setSortDirection(current => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDirection(
      column === "score" || column === "submitted_at" ? "desc" : "asc"
    );
  };

  /**
   * Un filtro configurado abre la matriz por la mejor calificación.
   *
   * Sin filtro la hoja es un registro de ingreso y se lee por fecha. Con filtro
   * es una lista de trabajo, y el evaluador necesita ver primero a quien mejor
   * puntuó. Por eso aplicar un filtro devuelve el orden a «Evaluación IA»
   * descendente, y retirar todos los filtros devuelve el registro a su fecha.
   */
  const prioritiseByScore = () => {
    setSortBy("score");
    setSortDirection("desc");
  };

  /** Aplica un filtro y devuelve la matriz a su orden de prioridad. */
  const filtered =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      prioritiseByScore();
    };

  const onFilterChange = {
    search: filtered(setSearchText),
    status: filtered(setStatus),
    position: filtered(setPositionId),
    minimumScore: filtered(setMinimumScore),
    from: filtered(setFrom),
    to: filtered(setTo),
  };

  const clearFilters = () => {
    setSearchText("");
    setStatus("all");
    setPositionId("all");
    setFrom("");
    setTo("");
    setMinimumScore("all");
    setEvaluatedOnly(false);
    setSortBy("submitted_at");
    setSortDirection("desc");
  };

  return (
    <div className="human-review-workspace flex h-[calc(100dvh-5.5rem)] min-h-0 min-w-0 flex-col gap-2 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:h-[calc(100dvh-2rem)] md:gap-3 md:overflow-y-auto">
      <header className="shrink-0 rounded-2xl border border-border/60 bg-card px-3 py-3 shadow-soft sm:px-4">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-sky-700">
              Búsqueda de postulaciones
            </p>
            <h1 className="mt-1 text-2xl font-800 tracking-[-.03em] text-primary sm:text-3xl">
              Candidatos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {rows.length} postulación{rows.length === 1 ? "" : "es"} en el
              filtro vigente · el botón «Detalle» abre la ficha completa en
              Revisión Humana
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            La revisión y la decisión se registran en la ficha de cada persona.
          </p>
        </div>
      </header>

      <section className="shrink-0 rounded-2xl border border-border/60 bg-card p-2 shadow-soft sm:p-3">
        <div className="human-review-filter-grid">
          <div className="human-review-filter-search relative min-w-0">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={event => onFilterChange.search(event.target.value)}
              className="rounded-xl pl-9"
              placeholder="Nombre, teléfono, correo o plaza"
            />
          </div>
          <Select value={status} onValueChange={onFilterChange.status}>
            <SelectTrigger className="w-full min-w-0 rounded-xl">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {APPLICATION_STATUS_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={positionId} onValueChange={onFilterChange.position}>
            <SelectTrigger className="w-full min-w-0 rounded-xl">
              <SelectValue placeholder="Plaza" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las plazas</SelectItem>
              {(positions.data ?? []).map((position: any) => (
                <SelectItem key={position.id} value={String(position.id)}>
                  {position.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minimumScore} onValueChange={onFilterChange.minimumScore}>
            <SelectTrigger className="w-full min-w-0 rounded-xl">
              <SelectValue placeholder="Punteo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo punteo</SelectItem>
              <SelectItem value="90">90 o más</SelectItem>
              <SelectItem value="80">80 o más</SelectItem>
              <SelectItem value="70">70 o más</SelectItem>
              <SelectItem value="60">60 o más</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={from}
            onChange={event => onFilterChange.from(event.target.value)}
            className="w-full min-w-0 rounded-xl"
            aria-label="Fecha inicial"
          />
          <Input
            type="date"
            value={to}
            onChange={event => onFilterChange.to(event.target.value)}
            className="w-full min-w-0 rounded-xl"
            aria-label="Fecha final"
          />
          <Button
            type="button"
            variant={evaluatedOnly ? "default" : "outline"}
            className="w-full min-w-0 rounded-xl px-3"
            onClick={() => {
              setEvaluatedOnly(current => !current);
              prioritiseByScore();
            }}
            aria-pressed={evaluatedOnly}
          >
            <Bot className="mr-2 h-4 w-4" /> Con IA
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full min-w-0 rounded-xl"
            onClick={clearFilters}
          >
            <FilterX className="mr-2 h-4 w-4" /> Limpiar
          </Button>
        </div>
      </section>

      <Card className="relative flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border-border/60 shadow-soft md:min-h-[18rem]">
        {workspace.isFetching ? (
          <span className="pointer-events-none absolute right-24 top-3 z-50 flex items-center rounded-full border bg-card/95 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Actualizando
          </span>
        ) : null}
        <div
          ref={matrixScrollRef}
          className="human-review-matrix-scroll min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain"
        >
          {workspace.error ? (
            <div className="grid h-full min-h-40 place-items-center p-6 text-center">
              <p className="text-sm text-destructive">
                No fue posible cargar la matriz: {workspace.error.message}
              </p>
            </div>
          ) : rows.length === 0 && !workspace.isLoading ? (
            <div className="grid h-full min-h-40 place-items-center p-6 text-center">
              <div>
                <Search className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-3 font-semibold text-primary">
                  Sin coincidencias
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ajusta los filtros para ampliar la revisión.
                </p>
              </div>
            </div>
          ) : (
            <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 z-30 bg-muted/95 shadow-[0_1px_0_hsl(var(--border))] backdrop-blur">
                <tr>
                  <SortableHead
                    label="Evaluación IA"
                    column="score"
                    active={sortBy}
                    direction={sortDirection}
                    onSort={changeSort}
                    className="sticky left-0 z-40 w-[210px] min-w-[210px] max-w-[210px] bg-[#dce8f0] shadow-[8px_0_18px_-16px_rgba(15,23,42,.9)] dark:bg-[#1b2a3a] sm:w-[230px] sm:min-w-[230px] sm:max-w-[230px]"
                  />
                  <th className="min-w-[150px] border-r px-3 py-2 text-left font-semibold">
                    Motivo
                  </th>
                  <th className="min-w-[230px] border-r px-3 py-2 text-left font-semibold sm:min-w-[270px]">
                    Comentario humano
                  </th>
                  <SortableHead
                    label="Estado / acción"
                    column="status"
                    active={sortBy}
                    direction={sortDirection}
                    onSort={changeSort}
                    className="min-w-[220px] sm:min-w-[250px]"
                  />
                  <SortableHead
                    label="Ingreso"
                    column="submitted_at"
                    active={sortBy}
                    direction={sortDirection}
                    onSort={changeSort}
                    className="min-w-[145px]"
                  />
                  <SortableHead
                    label="Candidato / plaza"
                    column="name"
                    active={sortBy}
                    direction={sortDirection}
                    onSort={changeSort}
                    className="w-[190px] min-w-[190px] max-w-[190px] sm:w-[210px] sm:min-w-[210px] sm:max-w-[210px]"
                  />
                  <th className="min-w-[150px] border-r px-3 py-2 text-left font-semibold">
                    Teléfono
                  </th>
                  {questionColumns.map(column => (
                    <th
                      key={column.fieldKey}
                      className="min-w-[170px] max-w-[220px] border-r px-3 py-2 text-left align-bottom sm:min-w-[190px] sm:max-w-[240px]"
                      title={column.label}
                    >
                      <span className="block font-mono text-[11px] font-bold text-primary">
                        {column.fieldKey}
                      </span>
                      <span className="mt-1 block line-clamp-2 font-normal text-muted-foreground">
                        {column.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rows as any[]).map(candidate => {
                  const answerMap = new Map(
                    answersFor(candidate).map(answer => [
                      answer.fieldKey,
                      answer,
                    ])
                  );
                  const isSelected = candidate.id === selected?.id;
                  const stamp = humanReviewStamp(candidate.human_review_at);
                  return (
                    <tr
                      key={candidate.id}
                      data-review-row={candidate.id}
                      onClick={() => selectCandidate(candidate.id)}
                      className={`group cursor-pointer ${isSelected ? "bg-sky-50 dark:bg-[#162333]" : "bg-card hover:bg-muted/45"}`}
                    >
                      <td
                        className={`sticky left-0 z-20 w-[210px] min-w-[210px] max-w-[210px] border-b border-r px-3 py-2 align-top shadow-[8px_0_18px_-16px_rgba(15,23,42,.9)] sm:w-[230px] sm:min-w-[230px] sm:max-w-[230px] ${isSelected ? "bg-[#c8dfec] dark:bg-[#24384d]" : "bg-[#eaf2f7] group-hover:bg-[#dce8f0] dark:bg-[#162333] dark:group-hover:bg-[#1b2a3a]"}`}
                      >
                        <Link
                          href={`/admin/human-review?application=${candidate.id}`}
                          onClick={event => event.stopPropagation()}
                          className="flex w-full items-center justify-center rounded-xl border bg-background px-3 py-2 font-bold text-primary hover:border-sky-300 hover:bg-sky-50 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
                          aria-label={`Abrir la ficha de ${candidate.full_name ?? "la persona"} en Revisión Humana`}
                          title="Abrir la ficha completa en Revisión Humana"
                        >
                          <Bot className="mr-2 h-4 w-4" />
                          {scoreFor(candidate) ?? "—"}
                        </Link>
                        {stamp ? (
                          <Link
                            href={`/admin/human-review?application=${candidate.id}`}
                            onClick={event => event.stopPropagation()}
                            className="mt-2 flex w-full items-center justify-center gap-1 rounded-full border border-rose-400 bg-rose-600 px-2 py-1 text-center text-[10px] font-bold leading-tight text-white hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-ring dark:border-rose-400 dark:bg-rose-700 dark:hover:bg-rose-600"
                            aria-label={`Revisión humana ya guardada el día ${stamp.date} a las ${stamp.time} por ${candidate.human_review_actor ?? "una persona"}`}
                            title={`Revisión humana guardada por ${candidate.human_review_actor ?? "una persona"}`}
                          >
                            <ClipboardCheck
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              Revisión Humana ({stamp.time}) {stamp.date}
                            </span>
                          </Link>
                        ) : null}
                      </td>
                      <td className="border-b border-r px-3 py-2 text-center align-top">
                        <Link
                          href={`/admin/human-review?application=${candidate.id}`}
                          onClick={event => event.stopPropagation()}
                          className="inline-flex items-center rounded-xl border bg-background px-3 py-2 font-semibold text-primary hover:border-sky-300 hover:bg-sky-50 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
                          title="Abrir la ficha completa en Revisión Humana"
                        >
                          <MessageSquareText className="mr-2 h-4 w-4" /> Ver
                        </Link>
                      </td>
                      <RowReviewControls
                        key={`${candidate.id}:${candidate.status}`}
                        candidate={candidate}
                        pending={updateStatus.isPending}
                        onSave={saveReview}
                      />
                      <td className="border-b border-r px-3 py-2 align-top text-muted-foreground">
                        {formatDate(candidate.submitted_at)}
                      </td>
                      <td
                        className={`w-[190px] min-w-[190px] max-w-[190px] border-b border-r px-3 py-2 align-top sm:w-[210px] sm:min-w-[210px] sm:max-w-[210px] ${isSelected ? "bg-[#c8dfec] dark:bg-[#24384d]" : "bg-[#eaf2f7] group-hover:bg-[#dce8f0] dark:bg-[#162333] dark:group-hover:bg-[#1b2a3a]"}`}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <button
                            type="button"
                            onClick={event => {
                              event.stopPropagation();
                              selectCandidate(candidate.id);
                            }}
                            aria-pressed={isSelected}
                            className="block min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <span className="block truncate text-sm font-bold text-primary">
                              {candidate.full_name ?? "Sin nombre"}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">
                              {candidate.position_title}
                            </span>
                          </button>
                          <Link
                            href={`/admin/inbox?application=${candidate.id}`}
                            onClick={event => event.stopPropagation()}
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-emerald-300 bg-card text-emerald-800 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Abrir WhatsApp de ${candidate.full_name ?? "la persona"}`}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                        <Link
                          href={`/admin/human-review?application=${candidate.id}`}
                          onClick={event => event.stopPropagation()}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-card px-2.5 py-1 text-[11px] font-semibold text-sky-900 outline-none hover:bg-sky-50 focus-visible:ring-2 focus-visible:ring-ring dark:border-sky-700 dark:text-sky-200 dark:hover:bg-neutral-800"
                          aria-label={`Ver ficha completa de ${candidate.full_name ?? "la persona"} en Revisión Humana`}
                        >
                          <Eye className="h-3 w-3" />
                          Detalle
                        </Link>
                      </td>
                      <td className="border-b border-r px-3 py-2 align-top">
                        <a
                          href={`tel:${candidate.phone_international}`}
                          onClick={event => event.stopPropagation()}
                          className="inline-flex items-center font-mono text-xs text-primary hover:underline"
                        >
                          <Phone className="mr-1.5 h-3.5 w-3.5" />
                          {candidate.phone_international}
                        </a>
                        {candidate.email ? (
                          <p className="mt-2 max-w-[170px] truncate text-[11px] text-muted-foreground">
                            {candidate.email}
                          </p>
                        ) : null}
                      </td>
                      {questionColumns.map(column => {
                        const answer = answerMap.get(column.fieldKey);
                        return (
                          <td
                            key={column.fieldKey}
                            className="max-w-[240px] border-b border-r px-3 py-2 align-top"
                          >
                            {answer ? (
                              <Link
                                href={`/admin/human-review?application=${candidate.id}`}
                                onClick={event => event.stopPropagation()}
                                className="line-clamp-2 block w-full text-left leading-5 text-primary hover:text-sky-800 hover:underline dark:hover:text-white"
                                title={formatAnswer(answer)}
                              >
                                {formatAnswer(answer)}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground/50">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {rows.length ? (
          <VerticalNavigator
            label="Navegación vertical de resultados"
            previousLabel="Seleccionar candidato anterior"
            nextLabel="Seleccionar candidato siguiente"
            disablePrevious={selectedIndex <= 0}
            disableNext={selectedIndex < 0 || selectedIndex >= rows.length - 1}
            onPrevious={() => moveThroughResults(-1)}
            onNext={() => moveThroughResults(1)}
            status={`Resultado ${selectedIndex + 1} de ${rows.length}`}
            orientation="horizontal"
            className="absolute right-3 top-3 z-50 rounded-lg border border-border/70 bg-card/95 p-1 shadow-md backdrop-blur"
          />
        ) : null}
      </Card>
    </div>
  );
}

function RowReviewControls({
  candidate,
  pending,
  onSave,
}: {
  candidate: any;
  pending: boolean;
  onSave: (id: number, status: string, comment: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(candidate.status);
  const [comment, setComment] = useState("");
  const disabled =
    pending || (status === candidate.status && comment.trim().length === 0);
  return (
    <Fragment>
      <td className="border-b border-r px-3 py-2 align-top">
        <Input
          value={comment}
          maxLength={1000}
          onClick={event => event.stopPropagation()}
          onChange={event => setComment(event.target.value)}
          placeholder="Agregar criterio o evidencia…"
          className="h-8 min-w-[245px] rounded-lg text-xs"
        />
      </td>
      <td className="border-b border-r px-3 py-2 align-top">
        <div className="flex min-w-[225px] gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              onClick={event => event.stopPropagation()}
              className="h-8 min-w-0 flex-1 rounded-lg text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent onClick={event => event.stopPropagation()}>
              {APPLICATION_STATUS_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            disabled={disabled}
            className="h-8 w-8 shrink-0 rounded-lg"
            aria-label="Guardar revisión de esta fila"
            onClick={async event => {
              event.stopPropagation();
              await onSave(candidate.id, status, comment);
              setComment("");
            }}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
        </div>
      </td>
    </Fragment>
  );
}

function SortableHead({
  label,
  column,
  active,
  direction,
  onSort,
  className = "",
}: {
  label: string;
  column: SortBy;
  active: SortBy;
  direction: SortDirection;
  onSort: (column: SortBy) => void;
  className?: string;
}) {
  return (
    <th className={`border-r px-3 py-2 text-left ${className}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center font-semibold text-primary hover:text-sky-800 dark:hover:text-white"
        title="Ordenar ascendente o descendente"
      >
        {label}
        {active === column ? (
          direction === "asc" ? (
            <ArrowUp className="ml-1.5 h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="ml-1.5 h-3.5 w-3.5" />
          )
        ) : (
          <span className="ml-1.5 text-muted-foreground/50">↕</span>
        )}
      </button>
    </th>
  );
}