import { Badge } from "@/components/ui/badge";
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
import {
  APPLICATION_STATUS_OPTIONS,
  applicationStatusLabel,
  applicationStatusTone,
} from "@shared/applicationStatus";
import {
  adjacentReviewResultIndex,
  type ReviewNavigationDirection,
} from "@shared/reviewNavigation";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Eye,
  FilterX,
  Loader2,
  MessageSquareText,
  Phone,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type SortBy = "submitted_at" | "name" | "score" | "status" | "position";
type SortDirection = "asc" | "desc";
type ViewerSelection =
  | { kind: "ai" }
  | { kind: "summary" }
  | { kind: "reason" }
  | { kind: "answer"; fieldKey: string };

type Answer = {
  fieldKey: string;
  label: string;
  value: unknown;
  normalizedValue?: string | null;
  deterministicResult?: string | null;
};

export default function HumanReview() {
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
  const [viewer, setViewer] = useState<ViewerSelection>({ kind: "ai" });
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
      setViewer({ kind: "ai" });
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
    setViewer({ kind: "ai" });
  };

  const showForCandidate = (id: number, selection: ViewerSelection) => {
    setSelectedId(id);
    setViewer(selection);
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
    <div className="human-review-workspace flex h-[calc(100dvh-5.5rem)] min-h-0 min-w-0 flex-col gap-2 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:h-[calc(100dvh-2rem)] md:gap-3 md:overflow-hidden">
      <section className="shrink-0 rounded-2xl border border-border/60 bg-card px-3 py-3 shadow-soft sm:px-4">
        <div className="human-review-summary-grid">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-primary sm:h-12 sm:w-12 sm:rounded-2xl">
              <UserRound className="h-5 w-5 sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-800 text-primary sm:text-xl">
                  {selected?.full_name ?? "Revisión Humana"}
                </h1>
                {selected ? <StatusBadge status={selected.status} /> : null}
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {selected
                  ? `${selected.position_title} · ${selected.phone_international}`
                  : "Visión 360° para decisiones humanas trazables"}
              </p>
              <button
                type="button"
                disabled={!selected}
                onClick={() => setViewer({ kind: "summary" })}
                className="mt-1 max-w-full truncate text-left text-xs text-muted-foreground underline decoration-border underline-offset-4 hover:text-primary disabled:no-underline"
              >
                {selected?.profile_summary ??
                  "Selecciona una postulación para abrir su nota inicial de IA."}
              </button>
            </div>
          </div>
          <div className="human-review-score-actions flex items-center gap-3">
            <div className="text-center">
              <p className="text-3xl font-800 tracking-tight text-primary sm:text-4xl">
                {scoreFor(selected) ?? "—"}
                <span className="text-lg font-semibold text-muted-foreground">
                  /100
                </span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[.16em] text-muted-foreground">
                Punteo IA
              </p>
            </div>
            {selected ? (
              <Link href={`/admin/candidates?application=${selected.id}`}>
                <Button variant="outline" className="rounded-full">
                  <Eye className="mr-2 h-4 w-4" /> Detalle
                </Button>
              </Link>
            ) : null}
          </div>
          {selected ? (
            <QuickReview
              key={`${selected.id}:${selected.status}`}
              currentStatus={selected.status}
              pending={updateStatus.isPending}
              onSave={(nextStatus, comment) =>
                saveReview(selected.id, nextStatus, comment)
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay candidatos disponibles con los filtros actuales.
            </p>
          )}
        </div>
      </section>

      <ViewerPanel
        candidate={selected}
        selection={viewer}
        onSelect={setViewer}
      />

      <section className="shrink-0 rounded-2xl border border-border/60 bg-card p-2 shadow-soft sm:p-3">
        <div className="human-review-filter-grid">
          <div className="human-review-filter-search relative min-w-0">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              className="rounded-xl pl-9"
              placeholder="Nombre, teléfono, correo o plaza"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
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
          <Select value={positionId} onValueChange={setPositionId}>
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
          <Select value={minimumScore} onValueChange={setMinimumScore}>
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
            onChange={event => setFrom(event.target.value)}
            className="w-full min-w-0 rounded-xl"
            aria-label="Fecha inicial"
          />
          <Input
            type="date"
            value={to}
            onChange={event => setTo(event.target.value)}
            className="w-full min-w-0 rounded-xl"
            aria-label="Fecha final"
          />
          <Button
            type="button"
            variant={evaluatedOnly ? "default" : "outline"}
            className="w-full min-w-0 rounded-xl px-3"
            onClick={() => setEvaluatedOnly(current => !current)}
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

      <Card className="relative flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border-border/60 shadow-soft md:min-h-0">
        {workspace.isFetching ? (
          <span className="pointer-events-none absolute right-12 top-2 z-50 flex items-center rounded-full border bg-card/95 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Actualizando
          </span>
        ) : null}
        <div
          ref={matrixScrollRef}
          className="human-review-matrix-scroll min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain pb-16"
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
                    label="Persona / nota IA"
                    column="name"
                    active={sortBy}
                    direction={sortDirection}
                    onSort={changeSort}
                    className="sticky left-0 z-40 min-w-[230px] bg-muted/95 sm:min-w-[270px] lg:min-w-[300px]"
                  />
                  <th className="min-w-[150px] border-r px-3 py-3 text-left font-semibold">
                    Teléfono
                  </th>
                  {questionColumns.map(column => (
                    <th
                      key={column.fieldKey}
                      className="min-w-[170px] max-w-[220px] border-r px-3 py-3 text-left align-bottom sm:min-w-[190px] sm:max-w-[240px]"
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
                  <SortableHead
                    label="Evaluación IA"
                    column="score"
                    active={sortBy}
                    direction={sortDirection}
                    onSort={changeSort}
                    className="min-w-[140px]"
                  />
                  <th className="min-w-[150px] border-r px-3 py-3 text-left font-semibold">
                    Motivo
                  </th>
                  <th className="min-w-[230px] border-r px-3 py-3 text-left font-semibold sm:min-w-[270px]">
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
                </tr>
              </thead>
              <tbody>
                {(rows as any[]).map((candidate, index) => {
                  const answerMap = new Map(
                    answersFor(candidate).map(answer => [
                      answer.fieldKey,
                      answer,
                    ])
                  );
                  const isSelected = candidate.id === selected?.id;
                  return (
                    <tr
                      key={candidate.id}
                      data-review-row={candidate.id}
                      onClick={() => selectCandidate(candidate.id)}
                      className={`group cursor-pointer ${isSelected ? "bg-sky-50 dark:bg-neutral-800" : "bg-card hover:bg-muted/45"}`}
                    >
                      <td
                        className={`sticky left-0 z-20 max-w-[230px] border-b border-r px-3 py-3 align-top sm:max-w-[270px] lg:max-w-[300px] ${isSelected ? "bg-sky-50 dark:bg-neutral-800" : "bg-card group-hover:bg-muted"}`}
                      >
                        <div className="flex gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-primary">
                              {candidate.full_name ?? "Sin nombre"}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {candidate.position_title}
                            </p>
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                showForCandidate(candidate.id, {
                                  kind: "summary",
                                });
                              }}
                              className="mt-2 line-clamp-2 text-left text-[11px] leading-4 text-muted-foreground hover:text-primary hover:underline"
                            >
                              <Sparkles className="mr-1 inline h-3 w-3" />
                              {candidate.profile_summary ??
                                "Sin nota inicial de IA"}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-r px-3 py-3 align-top">
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
                            className="max-w-[240px] border-b border-r px-3 py-3 align-top"
                          >
                            {answer ? (
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  showForCandidate(candidate.id, {
                                    kind: "answer",
                                    fieldKey: column.fieldKey,
                                  });
                                }}
                                className="line-clamp-3 w-full text-left leading-5 text-primary hover:text-sky-800 hover:underline dark:hover:text-white"
                                title={formatAnswer(answer)}
                              >
                                {formatAnswer(answer)}
                              </button>
                            ) : (
                              <span className="text-muted-foreground/50">
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}
                      <td className="border-b border-r px-3 py-3 text-center align-top">
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            showForCandidate(candidate.id, { kind: "ai" });
                          }}
                          className="inline-flex min-w-20 items-center justify-center rounded-xl border bg-background px-3 py-2 font-bold text-primary hover:border-sky-300 hover:bg-sky-50 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
                        >
                          <Bot className="mr-2 h-4 w-4" />
                          {scoreFor(candidate) ?? "—"}
                        </button>
                      </td>
                      <td className="border-b border-r px-3 py-3 text-center align-top">
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            showForCandidate(candidate.id, { kind: "reason" });
                          }}
                          className="inline-flex items-center rounded-xl border bg-background px-3 py-2 font-semibold text-primary hover:border-sky-300 hover:bg-sky-50 dark:hover:border-neutral-500 dark:hover:bg-neutral-800"
                        >
                          <MessageSquareText className="mr-2 h-4 w-4" /> Ver
                        </button>
                      </td>
                      <RowReviewControls
                        key={`${candidate.id}:${candidate.status}`}
                        candidate={candidate}
                        pending={updateStatus.isPending}
                        onSave={saveReview}
                      />
                      <td className="border-b px-3 py-3 align-top text-muted-foreground">
                        {formatDate(candidate.submitted_at)}
                      </td>
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
            className="absolute bottom-3 right-3 z-50"
          />
        ) : null}
      </Card>
    </div>
  );
}

function ViewerPanel({
  candidate,
  selection,
  onSelect,
}: {
  candidate: any;
  selection: ViewerSelection;
  onSelect: (selection: ViewerSelection) => void;
}) {
  const blocks = Array.isArray(candidate?.ai_payload?.blocks)
    ? candidate.ai_payload.blocks
    : [];
  const answer =
    selection.kind === "answer"
      ? answersFor(candidate).find(item => item.fieldKey === selection.fieldKey)
      : null;
  const heading =
    selection.kind === "answer"
      ? (answer?.fieldKey ?? selection.fieldKey)
      : selection.kind === "reason"
        ? "Motivo de evaluación"
        : selection.kind === "summary"
          ? "Nota inicial del candidato"
          : "Matriz de evaluación IA";
  const viewerScrollRef = useRef<HTMLDivElement>(null);
  const [scrollLimits, setScrollLimits] = useState({ up: false, down: false });
  const selectionKey =
    selection.kind === "answer"
      ? `${selection.kind}:${selection.fieldKey}`
      : selection.kind;

  const updateScrollLimits = () => {
    const element = viewerScrollRef.current;
    if (!element) return;
    setScrollLimits({
      up: element.scrollTop > 2,
      down: element.scrollTop + element.clientHeight < element.scrollHeight - 2,
    });
  };

  useEffect(() => {
    const element = viewerScrollRef.current;
    if (!element) return;
    element.scrollTop = 0;
    const frame = window.requestAnimationFrame(updateScrollLimits);
    const observer = new ResizeObserver(updateScrollLimits);
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [candidate?.id, selectionKey, blocks.length]);

  const scrollViewer = (direction: -1 | 1) => {
    const element = viewerScrollRef.current;
    if (!element) return;
    element.scrollBy({
      top: direction * Math.max(72, element.clientHeight * 0.85),
      behavior: "smooth",
    });
  };

  return (
    <section className="human-review-viewer relative h-[220px] shrink-0 overflow-hidden rounded-2xl bg-[#0b2d4b] text-white shadow-lift dark:bg-neutral-950 sm:h-[184px] lg:h-[168px]">
      <div className="flex h-full flex-col px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-sky-200/70">
              Visor 360° · {candidate?.full_name ?? "Sin selección"}
            </p>
            <h2 className="mt-1 text-lg font-bold text-white">{heading}</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ViewerButton
              active={selection.kind === "summary"}
              onClick={() => onSelect({ kind: "summary" })}
              icon={Sparkles}
              label="Nota IA"
            />
            <ViewerButton
              active={selection.kind === "ai"}
              onClick={() => onSelect({ kind: "ai" })}
              icon={Bot}
              label="Evaluación"
            />
            <ViewerButton
              active={selection.kind === "reason"}
              onClick={() => onSelect({ kind: "reason" })}
              icon={MessageSquareText}
              label="Motivo"
            />
          </div>
        </div>
        <div
          ref={viewerScrollRef}
          onScroll={updateScrollLimits}
          className="mt-2 min-h-0 flex-1 overflow-y-auto pr-9 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {!candidate ? (
            <div className="grid h-full place-items-center text-sm text-white/60">
              Selecciona un candidato en la matriz inferior.
            </div>
          ) : selection.kind === "answer" ? (
            <div className="grid gap-3 md:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
              <div className="rounded-xl bg-white/8 p-4">
                <p className="text-xs uppercase tracking-[.14em] text-white/50">
                  Pregunta del formulario
                </p>
                <p className="mt-2 text-sm leading-6 text-white/80">
                  {answer?.label ?? "Campo dinámico"}
                </p>
                {answer?.deterministicResult ? (
                  <Badge className="mt-3 rounded-full bg-white/10 text-white hover:bg-white/10">
                    Regla: {answer.deterministicResult}
                  </Badge>
                ) : null}
              </div>
              <div className="rounded-xl bg-white/8 p-4">
                <p className="text-xs uppercase tracking-[.14em] text-white/50">
                  Respuesta registrada
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/90">
                  {answer ? formatAnswer(answer) : "Sin respuesta registrada."}
                </p>
              </div>
            </div>
          ) : selection.kind === "summary" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <ViewerTextCard
                label="Resumen de persona"
                text={candidate.profile_summary ?? "Sin nota inicial de IA."}
              />
              <ViewerTextCard
                label="Contexto de la plaza"
                text={`${candidate.position_title} · Ingreso ${formatDate(candidate.submitted_at)}`}
              />
            </div>
          ) : selection.kind === "reason" ? (
            <ViewerTextCard
              label="Razonamiento registrado"
              text={
                candidate.evaluation_reason ??
                candidate.latest_reason ??
                "Pendiente de evaluación."
              }
            />
          ) : blocks.length ? (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {blocks.map((block: any) => (
                <div key={block.id} className="rounded-xl bg-white/8 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-white/90">
                      {blockLabel(block.id)}
                    </span>
                    <span className="font-bold text-sky-100">
                      {Math.round(Number(block.score) || 0)}/100
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-300"
                      style={{
                        width: `${Math.max(0, Math.min(100, Number(block.score) || 0))}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-white/60">
                    {block.rationale ?? "Sin razonamiento por bloque."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[auto_1fr]">
              <div className="grid min-w-32 place-items-center rounded-xl bg-white/8 p-4">
                <p className="text-3xl font-bold">
                  {scoreFor(candidate) ?? "—"}
                  <span className="text-sm text-white/50">/100</span>
                </p>
              </div>
              <ViewerTextCard
                label={candidate.ai_model ?? "Evaluación disponible"}
                text={candidate.evaluation_reason ?? "Sin matriz por bloques."}
              />
            </div>
          )}
        </div>
      </div>
      {candidate ? (
        <VerticalNavigator
          label="Navegación de bloques de evaluación"
          previousLabel="Mostrar bloques anteriores"
          nextLabel="Mostrar bloques siguientes"
          disablePrevious={!scrollLimits.up}
          disableNext={!scrollLimits.down}
          onPrevious={() => scrollViewer(-1)}
          onNext={() => scrollViewer(1)}
          status={heading}
          className="absolute right-2 top-1/2 z-20 -translate-y-1/2"
        />
      ) : null}
    </section>
  );
}

function QuickReview({
  currentStatus,
  pending,
  onSave,
}: {
  currentStatus: string;
  pending: boolean;
  onSave: (status: string, comment: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [comment, setComment] = useState("");
  const disabled =
    pending || (status === currentStatus && comment.trim().length === 0);
  return (
    <div className="human-review-quick-grid min-w-0">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-full min-w-0 rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {APPLICATION_STATUS_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={comment}
        onChange={event => setComment(event.target.value)}
        placeholder="Comentario de revisión"
        maxLength={1000}
        className="w-full min-w-0 rounded-xl"
      />
      <Button
        type="button"
        disabled={disabled}
        className="w-full rounded-xl sm:w-auto"
        onClick={async () => {
          await onSave(status, comment);
          setComment("");
        }}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Check className="mr-2 h-4 w-4" /> Guardar
          </>
        )}
      </Button>
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
      <td className="border-b border-r px-3 py-3 align-top">
        <Input
          value={comment}
          maxLength={1000}
          onClick={event => event.stopPropagation()}
          onChange={event => setComment(event.target.value)}
          placeholder="Agregar criterio o evidencia…"
          className="h-9 min-w-[245px] rounded-lg text-xs"
        />
      </td>
      <td className="border-b border-r px-3 py-3 align-top">
        <div className="flex min-w-[225px] gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              onClick={event => event.stopPropagation()}
              className="h-9 min-w-0 flex-1 rounded-lg text-xs"
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
            className="h-9 w-9 shrink-0 rounded-lg"
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
    <th className={`border-r px-3 py-3 text-left ${className}`}>
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

function ViewerButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-white bg-white text-[#0b2d4b]" : "border-white/20 bg-white/5 text-white/75 hover:bg-white/10"}`}
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" /> {label}
    </button>
  );
}

function ViewerTextCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl bg-white/8 p-4">
      <p className="text-xs uppercase tracking-[.14em] text-white/50">
        {label}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/85">
        {text}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = {
    neutral: "border-slate-200 bg-slate-50 text-slate-800",
    priority: "border-violet-200 bg-violet-50 text-violet-800",
    positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
    conditional: "border-sky-200 bg-sky-50 text-sky-800",
    review: "border-amber-200 bg-amber-50 text-amber-800",
    negative: "border-red-200 bg-red-50 text-red-800",
    interview: "border-cyan-200 bg-cyan-50 text-cyan-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  }[applicationStatusTone(status)];
  return (
    <Badge
      variant="outline"
      className={`rounded-full dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 ${tone}`}
    >
      {applicationStatusLabel(status)}
    </Badge>
  );
}

function answersFor(candidate: any): Answer[] {
  return Array.isArray(candidate?.answers) ? candidate.answers : [];
}

function scoreFor(candidate: any) {
  const value = candidate?.evaluation_score ?? candidate?.ai_payload?.score;
  if (
    (value === null || value === undefined) &&
    candidate?.ai_payload?.criticalDisqualification === true
  ) {
    return 0;
  }
  const score = Number(value);
  return Number.isFinite(score) ? Math.round(score) : null;
}

function formatAnswer(answer: Answer) {
  if (answer.normalizedValue?.trim()) return answer.normalizedValue;
  const value = answer.value;
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(String).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function blockLabel(value: string) {
  const labels: Record<string, string> = {
    identificacion_ajuste: "Identificación del ajuste",
    evidencia_experiencia: "Evidencia de experiencia",
    competencias: "Competencias técnicas/comerciales",
    disponibilidad_logistica: "Disponibilidad y logística",
    riesgos_brechas: "Riesgos o brechas",
    dictamen_ia: "Dictamen IA",
  };
  return labels[value] ?? value;
}
