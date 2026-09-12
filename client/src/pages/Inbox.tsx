import { useAuth } from "@/_core/hooks/useAuth";
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
import { Bot, CheckCircle2, FileText, Link2, MapPin, MessageCircle, Search, Send, ShieldAlert, Trash2, UserRound, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function initialApplicationId() {
  const value = new URLSearchParams(window.location.search).get("application");
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const trafficStyle = {
  verde: "border-emerald-300 bg-emerald-100 text-emerald-900",
  amarillo: "border-amber-300 bg-amber-100 text-amber-950",
  rojo: "border-red-300 bg-red-100 text-red-900",
} as const;

function trafficClass(value: unknown) {
  const key = value === "verde" || value === "amarillo" ? value : "rojo";
  return trafficStyle[key];
}

export default function Inbox() {
  const { user } = useAuth();
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
                  <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800">
                    <MessageCircle className="h-5 w-5" />
                    <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card ${row.traffic_light === "verde" ? "bg-emerald-500" : row.traffic_light === "amarillo" ? "bg-amber-500" : "bg-red-500"}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm text-primary">{row.full_name ?? "Sin nombre"}</strong>
                      <Badge variant="outline" className={`shrink-0 rounded-full px-2 text-[9px] ${trafficClass(row.traffic_light)}`}>{row.traffic_light}</Badge>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{row.position_title}</span>
                    <span className="mt-2 block line-clamp-2 text-xs leading-5 text-muted-foreground">{row.last_message_body ?? "Conversación sin mensajes"}</span>
                  </span>
                </div>
              </button>
            ))}
            {!conversations.isLoading && !conversations.data?.length ? <p className="p-6 text-center text-sm text-muted-foreground">No existen conversaciones con estos filtros.</p> : null}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-3xl border-0 shadow-soft">
          {current ? (
            <>
              <CardHeader className="border-b border-border/70 bg-primary text-primary-foreground">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <CardTitle className="text-xl text-white">{current.full_name ?? "Sin nombre"}</CardTitle>
                    <p className="mt-1 text-sm text-white/75">{current.position_title} · {current.phone_international}</p>
                  </div>
                  <Badge variant="outline" className={`w-fit rounded-full ${trafficClass(current.traffic_light)}`}>{current.traffic_light} · {current.automation_state}</Badge>
                </div>
              </CardHeader>
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

                <div className="h-[360px] space-y-3 overflow-y-auto rounded-2xl bg-muted/35 p-4">
                  {(detail.data?.messages ?? []).map(item => (
                    <div key={item.id} className={`flex items-end gap-1 ${item.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${item.direction === "outbound" ? "bg-primary text-primary-foreground" : "border border-border/70 bg-card text-primary"}`}>
                        {item.message_type === "audio" ? <Volume2 className="mb-2 h-4 w-4" /> : null}
                        {item.original_file_name ? <p className="mb-2 inline-flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> {item.original_file_name}</p> : null}
                        <p className="whitespace-pre-wrap break-words">{item.body || item.transcript || "Adjunto recibido"}</p>
                        <p className={`mt-2 text-[10px] ${item.direction === "outbound" ? "text-white/65" : "text-muted-foreground"}`}>{item.delivery_status} · {new Date(item.created_at).toLocaleString("es-GT", { timeZone: "America/Guatemala" })}</p>
                      </div>
                      {user?.role === "admin" || humanKeyboard ? (
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 self-center text-muted-foreground hover:text-destructive" aria-label={`Eliminar mensaje ${item.id}`} title="Eliminar mensaje" onClick={() => removeMessage.mutate({ conversationId: current.id, messageId: item.id })} disabled={removeMessage.isPending}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
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
