import { useAuth } from "@/_core/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Bot, CheckCircle2, Clock3, FileText, Link2, MapPin, Phone, Search, Send, ShieldAlert, Trash2, UserRound, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

function initialApplicationId() {
  const value = new URLSearchParams(window.location.search).get("application");
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function automationBadge(state: string | null | undefined) {
  if (state === "agent") {
    return (
      <Badge variant="outline" className="shrink-0 rounded-full border-emerald-300 bg-emerald-100 px-2 text-[9px] text-emerald-900">
        agente
      </Badge>
    );
  }
  if (state === "handoff_pending" || state === "human") {
    return (
      <Badge variant="outline" className="shrink-0 rounded-full border-amber-300 bg-amber-100 px-2 text-[9px] text-amber-950">
        humano
      </Badge>
    );
  }
  if (state === "completed") {
    return (
      <Badge variant="outline" className="shrink-0 rounded-full border-slate-300 bg-slate-100 px-2 text-[9px] text-slate-700">
        finalizado
      </Badge>
    );
  }
  if (state === "error") {
    return (
      <Badge variant="outline" className="shrink-0 rounded-full border-red-300 bg-red-100 px-2 text-[9px] text-red-900">
        error
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 rounded-full px-2 text-[9px]">
      pendiente
    </Badge>
  );
}

export default function Inbox() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const lightChat = theme === "light";
  const [search, setSearch] = useState("");
  const [positionId, setPositionId] = useState("all");
  const [automationState, setAutomationState] = useState("all");
  const [timeRange, setTimeRange] = useState<"hour" | "all">("hour");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [override, setOverride] = useState(false);
  const requestedApplicationId = useMemo(initialApplicationId, []);
  const positions = trpc.positions.list.useQuery();
  const conversations = trpc.inbox.list.useQuery(
    {
      applicationId: requestedApplicationId,
      search: search.trim() || undefined,
      positionId: positionId === "all" ? undefined : Number(positionId),
      automationState:
        automationState === "all"
          ? undefined
          : (automationState as "agent" | "handoff_pending" | "human" | "completed" | "error"),
      timeRange,
      limit: timeRange === "hour" ? 10 : 30,
    },
    { refetchInterval: 1_000, refetchIntervalInBackground: false }
  );
  const detail = trpc.inbox.detail.useQuery(
    { conversationId: selectedId ?? 0 },
    { enabled: Boolean(selectedId), refetchInterval: 1_000, refetchIntervalInBackground: false }
  );
  const setAutomation = trpc.inbox.setAutomation.useMutation({
    onSuccess: async () => {
      await Promise.all([conversations.refetch(), detail.refetch()]);
      toast.success("Control de conversación actualizado");
    },
    onError: error => toast.error(error.message),
  });
  const send = trpc.inbox.sendText.useMutation({
    onSuccess: async () => {
      setMessage("");
      await Promise.all([detail.refetch(), conversations.refetch()]);
      toast.success("Mensaje enviado");
    },
    onError: error => toast.error(error.message),
  });
  const refreshAfterSend = async () => {
    await Promise.all([detail.refetch(), conversations.refetch()]);
  };
  const sendLink = trpc.inbox.sendLink.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Enlace enviado");
    },
    onError: error => toast.error(error.message),
  });
  const sendLocation = trpc.inbox.sendLocation.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Ubicación enviada");
    },
    onError: error => toast.error(error.message),
  });
  const sendFile = trpc.inbox.sendFile.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Archivo enviado");
    },
    onError: error => toast.error(error.message),
  });
  const sendPtt = trpc.inbox.sendPtt.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Nota de voz enviada");
    },
    onError: error => toast.error(error.message),
  });
  const removeMessage = trpc.inbox.deleteMessage.useMutation({
    onSuccess: async () => {
      await refreshAfterSend();
      toast.success("Mensaje eliminado con trazabilidad registrada");
    },
    onError: error => toast.error(error.message),
  });

  const [quickKind, setQuickKind] = useState<
    "link" | "location" | "file" | "ptt" | null
  >(null);
  const [quickLink, setQuickLink] = useState("");
  const [quickCaption, setQuickCaption] = useState("");
  const [quickLatitude, setQuickLatitude] = useState("");
  const [quickLongitude, setQuickLongitude] = useState("");
  const [quickAddress, setQuickAddress] = useState("");
  const [quickFileUrl, setQuickFileUrl] = useState("");
  const [quickFileName, setQuickFileName] = useState("");
  const [quickAudioUrl, setQuickAudioUrl] = useState("");

  const openQuickAction = (kind: "link" | "location" | "file" | "ptt") => {
    setQuickKind(kind);
    setQuickLink("");
    setQuickCaption("");
    setQuickLatitude("");
    setQuickLongitude("");
    setQuickAddress("");
    setQuickFileUrl("");
    setQuickFileName("");
    setQuickAudioUrl("");
  };

  function closeQuickAction() {
    setQuickKind(null);
  }

  const submitQuickAction = () => {
    if (!selectedId) return;
    if (quickKind === "link") {
      sendLink.mutate({
        conversationId: selectedId,
        link: quickLink,
        caption: quickCaption.trim() || undefined,
      });
    } else if (quickKind === "location") {
      sendLocation.mutate({
        conversationId: selectedId,
        latitude: Number(quickLatitude),
        longitude: Number(quickLongitude),
        address: quickAddress.trim() || undefined,
      });
    } else if (quickKind === "file") {
      sendFile.mutate({
        conversationId: selectedId,
        fileUrl: quickFileUrl,
        fileName: quickFileName.trim() || undefined,
        caption: quickCaption.trim() || undefined,
      });
    } else if (quickKind === "ptt") {
      sendPtt.mutate({ conversationId: selectedId, audioUrl: quickAudioUrl });
    }
  };

  const quickPending =
    sendLink.isPending ||
    sendLocation.isPending ||
    sendFile.isPending ||
    sendPtt.isPending;

  useEffect(() => {
    const rows = conversations.data ?? [];
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some(row => row.id === selectedId)) {
      setSelectedId(rows[0].id);
    }
  }, [conversations.data, selectedId]);

  const current = detail.data?.conversation;
  const humanKeyboard = Boolean(
    current?.human_takeover && !current?.agent_enabled
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">Comunicación operativa</p>
        <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">Bandeja de entrada</h1>
        <p className="mt-2 text-muted-foreground">Conversaciones ApiChat / WhatsApp, evaluación y control humano en una sola vista trazable.</p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-border/70 bg-card p-3 sm:grid-cols-2 xl:grid-cols-[1fr_220px_220px_210px]">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, teléfono o plaza" className="rounded-xl pl-9" />
        </div>
        <Select value={positionId} onValueChange={setPositionId}>
          <SelectTrigger className="rounded-xl"><SelectValue placeholder="Plaza" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las plazas</SelectItem>
            {(positions.data ?? []).map(position => <SelectItem key={position.id} value={String(position.id)}>{position.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={automationState} onValueChange={setAutomationState}>
          <SelectTrigger className="rounded-xl"><SelectValue placeholder="Control" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los controles</SelectItem>
            <SelectItem value="agent">Agente activo</SelectItem>
            <SelectItem value="handoff_pending">Traspaso pendiente</SelectItem>
            <SelectItem value="human">Control humano</SelectItem>
            <SelectItem value="completed">Proceso finalizado</SelectItem>
            <SelectItem value="error">Error controlado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={timeRange} onValueChange={value => setTimeRange(value as "hour" | "all")}>
          <SelectTrigger className="rounded-xl"><SelectValue placeholder="Periodo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hour">Última hora · 10</SelectItem>
            <SelectItem value="all">Histórico completo · 30</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <div className="grid min-h-[650px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="overflow-hidden rounded-3xl border-0 shadow-soft">
          <CardHeader className="border-b border-border/70">
            <CardTitle className="text-lg text-primary">Últimas conversaciones</CardTitle>
            <p className="text-xs text-muted-foreground">
              {timeRange === "hour"
                ? "Hasta 10 conversaciones de la última hora."
                : "Hasta 30 resultados históricos por consulta."}
            </p>
          </CardHeader>
          <CardContent className="max-h-[720px] space-y-2 overflow-y-auto p-2">
            {(conversations.data ?? []).map(row => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                aria-pressed={selectedId === row.id}
                className={`w-full rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === row.id ? "border-primary bg-primary/5" : "border-transparent bg-muted/45 hover:border-border"}`}
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800">
                    <Phone className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm text-primary">{row.full_name ?? "Sin nombre"}</strong>
                      {automationBadge(row.automation_state)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.position_title ?? "Plaza sin nombre"}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 shrink-0" /> {row.phone_international ?? "Sin teléfono"}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{row.last_message_body ?? "Conversación sin mensajes"}</span>
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
                  <span className="rounded-lg bg-muted/70 px-2 py-0.5 text-xs font-semibold text-primary">
                    {row.evaluation_score != null ? `${row.evaluation_score}/100` : "Sin puntaje"}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Punteo IA</span>
                  <Link
                    href={`/admin/candidates?application=${row.application_id}`}
                    onClick={event => event.stopPropagation()}
                    className="ml-auto rounded-full border border-border/70 px-3 py-1 text-xs font-semibold text-primary hover:bg-muted"
                  >
                    Detalle
                  </Link>
                </div>
              </button>
            ))}
            {!conversations.isLoading && !conversations.data?.length ? <p className="p-6 text-center text-sm text-muted-foreground">No existen conversaciones con estos filtros.</p> : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-0 shadow-soft">
          {current ? (
            <>
              <CardContent className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="Punteo actual" value={detail.data?.assessment?.score ?? "Sin puntaje"} />
                  <Info label="Prueba actual" value={detail.data?.assessment?.name ?? "Sin prueba activa"} />
                  <Info label="Ubicación" value={[current.location_zone, current.location_municipality, current.location_department].filter(Boolean).join(", ") || "Sin confirmar"} />
                  <Info label="Último contacto" value={current.last_message_at ? new Date(current.last_message_at).toLocaleString("es-GT", { timeZone: "America/Guatemala" }) : "Sin mensajes"} />
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-muted/40 p-3">
                  <Button size="sm" variant={current.agent_enabled ? "default" : "outline"} className="rounded-full" onClick={() => setAutomation.mutate({ conversationId: current.id, nextState: "agent", override: false })} disabled={setAutomation.isPending}>
                    <Bot className="mr-2 h-4 w-4" /> Activar JARVI HR
                  </Button>
                  <Button size="sm" variant={humanKeyboard ? "default" : "outline"} className="rounded-full" onClick={() => setAutomation.mutate({ conversationId: current.id, nextState: "human", override })} disabled={setAutomation.isPending}>
                    <UserRound className="mr-2 h-4 w-4" /> Control humano
                  </Button>
                  {user?.role === "admin" ? (
                    <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" checked={override} onChange={event => setOverride(event.target.checked)} /> Excepción administrativa auditada
                    </label>
                  ) : null}
                </div>

                <div className={`h-[440px] space-y-1.5 overflow-y-auto rounded-2xl p-3 ${lightChat ? "bg-[#D3D3D3]" : "bg-[#0b141a]"}`}>
                  {(detail.data?.messages ?? []).map(item => {
                    const outbound = item.direction === "outbound";
                    const trash = user?.role === "admin" || humanKeyboard ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`hidden h-6 w-6 shrink-0 self-center rounded-full group-hover:inline-flex ${lightChat ? "text-black/40 hover:text-[#f15c6d]" : "text-white/40 hover:text-[#f15c6d]"}`}
                        aria-label={`Eliminar mensaje ${item.id}`}
                        title="Eliminar mensaje"
                        onClick={() =>
                          removeMessage.mutate({
                            conversationId: current.id,
                            messageId: item.id,
                          })
                        }
                        disabled={removeMessage.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null;
                    return (
                      <div
                        key={item.id}
                        className={`group flex items-end gap-1 ${outbound ? "justify-end" : "justify-start"}`}
                      >
                        {outbound ? trash : null}
                        <div
                          className={`max-w-[78%] rounded-lg px-2.5 pb-1.5 pt-1.5 text-sm leading-[1.35] shadow-sm ${
                            outbound
                              ? "rounded-tr-none bg-[#005c4b] text-white"
                              : "rounded-tl-none bg-[#202c33] text-white"
                          }`}
                        >
                          {item.message_type === "audio" ? (
                            <Volume2 className="mb-1 h-3.5 w-3.5 text-white/80" />
                          ) : null}
                          {item.original_file_name ? (
                            <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-white/90">
                              <FileText className="h-3 w-3" />{" "}
                              {item.original_file_name}
                            </p>
                          ) : null}
                          <p className="whitespace-pre-wrap break-words">
                            {item.body || item.transcript || "Adjunto recibido"}
                          </p>
                          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none text-white/60">
                            {new Date(item.created_at).toLocaleTimeString(
                              "es-GT",
                              {
                                hour: "numeric",
                                minute: "2-digit",
                                hour12: true,
                                timeZone: "America/Guatemala",
                              }
                            )}
                            {messageTicks(item.direction, item.delivery_status)}
                          </p>
                        </div>
                        {!outbound ? trash : null}
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-full" disabled={!humanKeyboard} onClick={() => openQuickAction("link")}><Link2 className="mr-2 h-3.5 w-3.5" /> Enlace</Button>
                  <Button size="sm" variant="outline" className="rounded-full" disabled={!humanKeyboard} onClick={() => openQuickAction("location")}><MapPin className="mr-2 h-3.5 w-3.5" /> Ubicación</Button>
                  <Button size="sm" variant="outline" className="rounded-full" disabled={!humanKeyboard} onClick={() => openQuickAction("file")}><FileText className="mr-2 h-3.5 w-3.5" /> Archivo</Button>
                  <Button size="sm" variant="outline" className="rounded-full" disabled={!humanKeyboard} onClick={() => openQuickAction("ptt")}><Volume2 className="mr-2 h-3.5 w-3.5" /> Nota de voz</Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Textarea value={message} onChange={event => setMessage(event.target.value)} disabled={!humanKeyboard} rows={3} className="rounded-2xl" placeholder={humanKeyboard ? "Escriba un mensaje institucional" : "El teclado se habilita al transferir el control al equipo humano"} />
                  <Button className="rounded-2xl sm:h-full" onClick={() => selectedId && send.mutate({ conversationId: selectedId, text: message })} disabled={!humanKeyboard || !message.trim() || send.isPending}>
                    <Send className="mr-2 h-4 w-4" /> Enviar
                  </Button>
                </div>
                {!humanKeyboard ? <p className="inline-flex items-center gap-2 text-xs text-amber-800"><ShieldAlert className="h-4 w-4" /> JARVI HR mantiene el control; la transferencia exige finalización o excepción administrativa.</p> : <p className="inline-flex items-center gap-2 text-xs text-emerald-800"><CheckCircle2 className="h-4 w-4" /> Control humano activo y registrado.</p>}

                <Dialog open={quickKind !== null} onOpenChange={open => { if (!open) closeQuickAction(); }}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{quickKind === "link" ? "Enviar enlace" : quickKind === "location" ? "Enviar ubicación" : quickKind === "file" ? "Enviar archivo" : "Enviar nota de voz"}</DialogTitle>
                      <DialogDescription>El envío se registra con control humano y trazabilidad en la conversación.</DialogDescription>
                    </DialogHeader>
                    {quickKind === "link" ? (
                      <div className="space-y-3">
                        <div className="space-y-2"><Label>URL HTTPS</Label><Input value={quickLink} onChange={event => setQuickLink(event.target.value)} placeholder="https://…" inputMode="url" /></div>
                        <div className="space-y-2"><Label>Texto de vista previa</Label><Textarea value={quickCaption} onChange={event => setQuickCaption(event.target.value)} rows={2} placeholder="Opcional" /></div>
                      </div>
                    ) : quickKind === "location" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2"><Label>Latitud</Label><Input value={quickLatitude} onChange={event => setQuickLatitude(event.target.value)} inputMode="decimal" placeholder="-90 a 90" /></div>
                        <div className="space-y-2"><Label>Longitud</Label><Input value={quickLongitude} onChange={event => setQuickLongitude(event.target.value)} inputMode="decimal" placeholder="-180 a 180" /></div>
                        <div className="space-y-2 sm:col-span-2"><Label>Dirección</Label><Input value={quickAddress} onChange={event => setQuickAddress(event.target.value)} placeholder="Opcional" /></div>
                      </div>
                    ) : quickKind === "file" ? (
                      <div className="space-y-3">
                        <div className="space-y-2"><Label>URL del archivo (HTTPS)</Label><Input value={quickFileUrl} onChange={event => setQuickFileUrl(event.target.value)} placeholder="https://…" inputMode="url" /></div>
                        <div className="space-y-2"><Label>Nombre del archivo</Label><Input value={quickFileName} onChange={event => setQuickFileName(event.target.value)} placeholder="Opcional" /></div>
                        <div className="space-y-2"><Label>Texto adjunto</Label><Textarea value={quickCaption} onChange={event => setQuickCaption(event.target.value)} rows={2} placeholder="Opcional" /></div>
                      </div>
                    ) : (
                      <div className="space-y-2"><Label>URL del audio (HTTPS)</Label><Input value={quickAudioUrl} onChange={event => setQuickAudioUrl(event.target.value)} placeholder="https://…" inputMode="url" /></div>
                    )}
                    <DialogFooter>
                      <Button variant="ghost" onClick={closeQuickAction}>Cancelar</Button>
                      <Button disabled={quickPending} onClick={submitQuickAction}>{quickPending ? "Enviando…" : "Enviar"}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </>
          ) : (
            <CardContent className="grid min-h-[650px] place-items-center text-sm text-muted-foreground">Seleccione una conversación.</CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded-2xl bg-muted/55 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 text-sm font-bold text-primary">{String(value)}</p></div>;
}

function messageTicks(direction: string, status: string) {
  if (direction === "inbound") return null;
  if (status === "sending")
    return <Clock3 className="h-3 w-3 text-white/60" />;
  if (status === "sent")
    return (
      <span className="font-bold tracking-tighter text-[#53bdeb]">✓✓</span>
    );
  if (status === "failed")
    return <span className="font-bold text-[#f15c6d]">!</span>;
  return <span className="text-[#8696a0]">✓</span>;
}
