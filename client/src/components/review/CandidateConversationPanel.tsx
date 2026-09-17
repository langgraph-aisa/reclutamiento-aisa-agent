import { useAuth } from "@/_core/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Link2,
  MapPin,
  Phone,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Bandeja de WhatsApp del candidato.
 *
 * Sustituye al panel compacto «Conversación de …» por el mismo recorrido
 * operativo de la bandeja general —historial completo, lectura y escritura,
 * enlace, ubicación, archivo y nota de voz, control del agente y borrado
 * trazable— pero acotado al candidato en estudio: no permite abandonar su
 * expediente ni ver conversaciones de terceros.
 *
 * Consume los mismos procedimientos del backend que la bandeja general, de modo
 * que la conducta —permisos, guardarraíl salarial, registro de auditoría y
 * encolado del envío— es idéntica por construcción, no por coincidencia.
 *
 * Los documentos que llegan por este canal se incorporan al RAG Personal del
 * candidato desde la recepción (`registerCandidateInboundDocument`), con el
 * mismo transporte verificado y el mismo análisis de IA.
 */

function automationBadge(state: string | null | undefined) {
  const base = "shrink-0 rounded-full px-2 text-[9px]";
  if (state === "agent") {
    return (
      <Badge
        variant="outline"
        className={`${base} border-emerald-300 bg-emerald-100 text-emerald-900`}
      >
        agente JARVI HR
      </Badge>
    );
  }
  if (state === "handoff_pending" || state === "human") {
    return (
      <Badge
        variant="outline"
        className={`${base} border-sky-300 bg-sky-100 text-sky-900`}
      >
        control humano
      </Badge>
    );
  }
  if (state === "completed") {
    return (
      <Badge
        variant="outline"
        className={`${base} border-slate-300 bg-slate-100 text-slate-700`}
      >
        finalizado
      </Badge>
    );
  }
  if (state === "error") {
    return (
      <Badge
        variant="outline"
        className={`${base} border-red-300 bg-red-100 text-red-900`}
      >
        error controlado
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={base}>
      pendiente
    </Badge>
  );
}

function messageTicks(direction: string, status: string) {
  if (direction === "inbound") return null;
  if (status === "sending") return <Clock3 className="h-3 w-3 text-white/60" />;
  if (status === "sent") {
    return <span className="font-bold tracking-tighter text-[#53bdeb]">✓✓</span>;
  }
  if (status === "failed") {
    return <span className="font-bold text-[#f15c6d]">!</span>;
  }
  return <span className="text-[#8696a0]">✓</span>;
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-2xl bg-muted/55 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-bold text-primary">{String(value)}</p>
    </div>
  );
}

export function CandidateConversationPanel({
  applicationId,
  candidateName,
}: {
  applicationId: number;
  candidateName: string | null;
}) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const lightChat = theme === "light";

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [override, setOverride] = useState(false);

  // Historial completo del candidato en estudio: sin el recorte a la última
  // hora que usa la vista compacta anterior.
  const conversations = trpc.inbox.list.useQuery(
    { applicationId, timeRange: "all", limit: 200 },
    { refetchInterval: 4_000, refetchIntervalInBackground: false }
  );
  const detail = trpc.inbox.detail.useQuery(
    { conversationId: selectedId ?? 0 },
    {
      enabled: Boolean(selectedId),
      refetchInterval: 2_000,
      refetchIntervalInBackground: false,
    }
  );

  const refresh = useCallback(async () => {
    await Promise.all([conversations.refetch(), detail.refetch()]);
  }, [conversations, detail]);

  const setAutomation = trpc.inbox.setAutomation.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Control de conversación actualizado.");
    },
    onError: error => toast.error(error.message),
  });
  const markRead = trpc.inbox.markRead.useMutation({
    onSuccess: async () => {
      await conversations.refetch();
    },
    onError: () => undefined,
  });
  const send = trpc.inbox.sendText.useMutation({
    onSuccess: async () => {
      setMessage("");
      await refresh();
      toast.success("Mensaje enviado.");
    },
    onError: error => toast.error(error.message),
  });
  const syncNow = trpc.inbox.syncNow.useMutation({
    onSuccess: async result => {
      await refresh();
      toast.success(
        `Sincronización manual: ${result.inserted} mensaje(s) nuevo(s), ${result.processed} procesado(s), ${result.failures} con respaldo.`
      );
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

  const closeQuickAction = useCallback(() => setQuickKind(null), []);
  const refreshAfterSend = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const sendLink = trpc.inbox.sendLink.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Enlace enviado.");
    },
    onError: error => toast.error(error.message),
  });
  const sendLocation = trpc.inbox.sendLocation.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Ubicación enviada.");
    },
    onError: error => toast.error(error.message),
  });
  const sendFile = trpc.inbox.sendFile.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Archivo enviado.");
    },
    onError: error => toast.error(error.message),
  });
  const sendPtt = trpc.inbox.sendPtt.useMutation({
    onSuccess: async () => {
      closeQuickAction();
      await refreshAfterSend();
      toast.success("Nota de voz enviada.");
    },
    onError: error => toast.error(error.message),
  });
  const removeMessage = trpc.inbox.deleteMessage.useMutation({
    onSuccess: async () => {
      await refreshAfterSend();
      toast.success("Mensaje eliminado con trazabilidad registrada.");
    },
    onError: error => toast.error(error.message),
  });

  // Selección automática de la conversación vigente del candidato.
  useEffect(() => {
    const rows = conversations.data ?? [];
    if (!rows.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some(row => row.id === selectedId)) {
      setSelectedId(rows[0]!.id);
      if ((rows[0]!.unread_inbound ?? 0) > 0) {
        markRead.mutate({ conversationId: rows[0]!.id });
      }
    }
  }, [conversations.data, selectedId, markRead]);

  const current = detail.data?.conversation;
  const messages = useMemo(
    () => (detail.data?.messages ?? []) as any[],
    [detail.data]
  );
  const humanKeyboard = Boolean(
    current?.human_takeover && !current?.agent_enabled
  );
  const unread = (conversations.data ?? []).reduce(
    (total, row) => total + (row.unread_inbound ?? 0),
    0
  );

  const resetQuick = (kind: "link" | "location" | "file" | "ptt") => {
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

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft lg:col-span-2">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <Phone className="h-4 w-4 text-emerald-700" />
        <h3 className="text-sm font-bold text-primary">
          Conversación de {candidateName ?? "la persona evaluada"}
        </h3>
        {automationBadge(current?.automation_state)}
        {unread > 0 ? (
          <Badge
            variant="outline"
            className="shrink-0 rounded-full border-amber-300 bg-amber-100 px-2 text-[10px] text-amber-900"
            title="Mensajes nuevos sin abrir"
          >
            ⚠ {unread}
          </Badge>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {messages.length} mensaje(s) · {conversations.data?.length ?? 0}{" "}
            conversación(es)
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-full text-[11px]"
            onClick={() => syncNow.mutate()}
            disabled={syncNow.isPending}
            title="Traer ahora los mensajes del proveedor; la acción queda registrada en la auditoría"
          >
            <RefreshCw
              className={`mr-1.5 h-3 w-3 ${syncNow.isPending ? "animate-spin" : ""}`}
            />
            {syncNow.isPending ? "Trayendo…" : "Sincronizar"}
          </Button>
        </span>
      </header>

      <div className="space-y-3 p-3">
        {conversations.isLoading ? (
          <p className="rounded-xl bg-muted/40 p-4 text-center text-xs text-muted-foreground">
            Cargando el historial del candidato…
          </p>
        ) : null}

        {!conversations.isLoading && !conversations.data?.length ? (
          <p className="rounded-xl bg-muted/40 p-6 text-center text-xs text-muted-foreground">
            Sin mensajes registrados para esta postulación. La conversación se
            abre cuando la persona responde por WhatsApp.
          </p>
        ) : null}

        {current ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Info
                label="Punteo de prueba"
                value={detail.data?.assessment?.score ?? "Sin puntaje"}
              />
              <Info
                label="Prueba actual"
                value={detail.data?.assessment?.name ?? "Sin prueba activa"}
              />
              <Info
                label="Ubicación"
                value={
                  [
                    current.location_zone,
                    current.location_municipality,
                    current.location_department,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Sin confirmar"
                }
              />
              <Info
                label="Último contacto"
                value={
                  current.last_message_at
                    ? new Date(current.last_message_at).toLocaleString("es-GT", {
                        timeZone: "America/Guatemala",
                      })
                    : "Sin mensajes"
                }
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/40 p-2.5">
              <Button
                size="sm"
                variant={current.agent_enabled ? "default" : "outline"}
                className="h-7 rounded-full text-[11px]"
                onClick={() =>
                  setAutomation.mutate({
                    conversationId: current.id,
                    nextState: "agent",
                    override: false,
                  })
                }
                disabled={setAutomation.isPending}
              >
                <Bot className="mr-1.5 h-3 w-3" /> Activar JARVI HR
              </Button>
              <Button
                size="sm"
                variant={humanKeyboard ? "default" : "outline"}
                className="h-7 rounded-full text-[11px]"
                onClick={() =>
                  setAutomation.mutate({
                    conversationId: current.id,
                    nextState: "human",
                    override,
                  })
                }
                disabled={setAutomation.isPending}
              >
                <UserRound className="mr-1.5 h-3 w-3" /> Control humano
              </Button>
              {user?.role === "admin" ? (
                <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={event => setOverride(event.target.checked)}
                  />{" "}
                  Excepción administrativa auditada
                </label>
              ) : null}
            </div>

            <div
              className={`h-[380px] space-y-1.5 overflow-y-auto rounded-xl p-3 ${
                lightChat ? "bg-[#D3D3D3]" : "bg-[#0b141a]"
              }`}
            >
              {messages.length === 0 ? (
                <p className="pt-10 text-center text-xs text-white/60">
                  Sin mensajes en esta conversación.
                </p>
              ) : null}
              {messages.map(item => {
                const outbound = item.direction === "outbound";
                const trash =
                  user?.role === "admin" || humanKeyboard ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className={`hidden h-6 w-6 shrink-0 self-center rounded-full group-hover:inline-flex ${
                        lightChat
                          ? "text-black/40 hover:text-[#f15c6d]"
                          : "text-white/40 hover:text-[#f15c6d]"
                      }`}
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
                    className={`group flex items-end gap-1 ${
                      outbound ? "justify-end" : "justify-start"
                    }`}
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
                      {item.media_storage_key ? (
                        <a
                          href={`/api/inbox/files/${item.media_storage_key}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mb-0.5 flex items-center gap-1 rounded bg-black/25 px-1.5 py-0.5 text-xs font-semibold text-white/90 hover:bg-black/40"
                        >
                          <FileText className="h-3 w-3" />
                          {item.media_file_name ??
                            item.original_file_name ??
                            "Adjunto"}
                          <ExternalLink className="h-3 w-3 text-white/70" />
                        </a>
                      ) : null}
                      <p className="whitespace-pre-wrap break-words">
                        {item.body || item.transcript || "Adjunto recibido"}
                      </p>
                      {item.quoted_text ? (
                        <p className="mt-0.5 rounded bg-black/25 px-1.5 py-0.5 text-[11px] italic leading-tight text-white/75">
                          ↩ «{item.quoted_text}»
                        </p>
                      ) : null}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none text-white/60">
                        {new Date(item.created_at).toLocaleTimeString("es-GT", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                          timeZone: "America/Guatemala",
                        })}
                        {messageTicks(item.direction, item.delivery_status)}
                      </p>
                    </div>
                    {!outbound ? trash : null}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full text-[11px]"
                disabled={!humanKeyboard}
                onClick={() => resetQuick("link")}
              >
                <Link2 className="mr-1.5 h-3 w-3" /> Enlace
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full text-[11px]"
                disabled={!humanKeyboard}
                onClick={() => resetQuick("location")}
              >
                <MapPin className="mr-1.5 h-3 w-3" /> Ubicación
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full text-[11px]"
                disabled={!humanKeyboard}
                onClick={() => resetQuick("file")}
              >
                <FileText className="mr-1.5 h-3 w-3" /> Archivo
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-full text-[11px]"
                disabled={!humanKeyboard}
                onClick={() => resetQuick("ptt")}
              >
                <Volume2 className="mr-1.5 h-3 w-3" /> Nota de voz
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Textarea
                value={message}
                onChange={event => setMessage(event.target.value)}
                disabled={!humanKeyboard}
                rows={3}
                className="rounded-2xl text-sm"
                placeholder={
                  humanKeyboard
                    ? "Escriba un mensaje institucional"
                    : "El teclado se habilita al transferir el control al equipo humano"
                }
              />
              <Button
                className="rounded-2xl sm:h-full"
                onClick={() =>
                  selectedId && send.mutate({ conversationId: selectedId, text: message })
                }
                disabled={!humanKeyboard || !message.trim() || send.isPending}
              >
                <Send className="mr-2 h-4 w-4" /> Enviar
              </Button>
            </div>

            {!humanKeyboard ? (
              <p className="inline-flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5" /> JARVI HR mantiene el
                control; la transferencia exige finalización o excepción
                administrativa.
              </p>
            ) : (
              <p className="inline-flex items-center gap-2 text-[11px] text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Control humano activo y
                registrado.
              </p>
            )}

            <p className="text-[10px] leading-4 text-muted-foreground">
              Los documentos que llegan por este canal se incorporan al RAG
              Personal del candidato con el mismo análisis de IA. La bandeja de
              este módulo es exclusiva de la persona en estudio.
            </p>

            <Dialog
              open={quickKind !== null}
              onOpenChange={open => {
                if (!open) closeQuickAction();
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {quickKind === "link"
                      ? "Enviar enlace"
                      : quickKind === "location"
                        ? "Enviar ubicación"
                        : quickKind === "file"
                          ? "Enviar archivo"
                          : "Enviar nota de voz"}
                  </DialogTitle>
                  <DialogDescription>
                    El envío se registra con control humano y trazabilidad en la
                    conversación del candidato.
                  </DialogDescription>
                </DialogHeader>
                {quickKind === "link" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>URL HTTPS</Label>
                      <Input
                        value={quickLink}
                        onChange={event => setQuickLink(event.target.value)}
                        placeholder="https://…"
                        inputMode="url"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Texto de vista previa</Label>
                      <Textarea
                        value={quickCaption}
                        onChange={event => setQuickCaption(event.target.value)}
                        rows={2}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                ) : quickKind === "location" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Latitud</Label>
                      <Input
                        value={quickLatitude}
                        onChange={event => setQuickLatitude(event.target.value)}
                        inputMode="decimal"
                        placeholder="-90 a 90"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Longitud</Label>
                      <Input
                        value={quickLongitude}
                        onChange={event => setQuickLongitude(event.target.value)}
                        inputMode="decimal"
                        placeholder="-180 a 180"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Dirección</Label>
                      <Input
                        value={quickAddress}
                        onChange={event => setQuickAddress(event.target.value)}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                ) : quickKind === "file" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>URL del archivo (HTTPS)</Label>
                      <Input
                        value={quickFileUrl}
                        onChange={event => setQuickFileUrl(event.target.value)}
                        placeholder="https://…"
                        inputMode="url"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Nombre del archivo</Label>
                      <Input
                        value={quickFileName}
                        onChange={event => setQuickFileName(event.target.value)}
                        placeholder="Opcional"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Texto adjunto</Label>
                      <Textarea
                        value={quickCaption}
                        onChange={event => setQuickCaption(event.target.value)}
                        rows={2}
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>URL del audio (HTTPS)</Label>
                    <Input
                      value={quickAudioUrl}
                      onChange={event => setQuickAudioUrl(event.target.value)}
                      placeholder="https://…"
                      inputMode="url"
                    />
                  </div>
                )}
                <DialogFooter>
                  <Button variant="ghost" onClick={closeQuickAction}>
                    Cancelar
                  </Button>
                  <Button disabled={quickPending} onClick={submitQuickAction}>
                    {quickPending ? "Enviando…" : "Enviar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>
    </div>
  );
}
