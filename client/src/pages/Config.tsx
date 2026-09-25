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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { GuatemalaPhoneInput } from "@/components/GuatemalaPhoneInput";
import { CredentialField } from "@/components/CredentialField";
import {
  Check,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/** Etiquetas operativas del catálogo de endpoints conversacionales. */
const ENDPOINT_CAPABILITY_LABELS: Record<string, string> = {
  receive: "Recepción",
  send: "Envío",
  moderation: "Moderación",
};

const ENDPOINT_CONSUMER_LABELS: Record<string, string> = {
  recepcion: "Recepción",
  bandeja: "Bandeja humana",
  agente: "Agente JARVI HR",
  moderacion: "Moderación",
};

export default function Config() {
  const recipients = trpc.config.recipients.useQuery();
  const apiChatConfiguration = trpc.config.apiChatConfiguration.useQuery();
  /**
   * Dirección de retorno que Dropbox compara carácter por carácter con la
   * registrada. Se compone del origen real de este despliegue —no de una
   * plantilla—, porque un puerto, un subdominio o una barra final distintos
   * producen el rechazo «Invalid redirect_uri» al autorizar.
   */
  const dropboxRedirectUri = `${window.location.origin}/api/dropbox/oauth/callback`;
  const [copiedDropboxRedirect, setCopiedDropboxRedirect] = useState(false);
  const copyDropboxRedirectUri = async () => {
    await navigator.clipboard?.writeText(dropboxRedirectUri);
    setCopiedDropboxRedirect(true);
    window.setTimeout(() => setCopiedDropboxRedirect(false), 1_400);
  };
  const saveRecipient = trpc.config.saveRecipient.useMutation({
    onSuccess: () => recipients.refetch(),
  });
  const saveSetting = trpc.config.saveSetting.useMutation();
  const cvAnalysis = trpc.config.cvAnalysis.useQuery();
  const settings = trpc.config.settings.useQuery();
  const saveApiChatPreferences = trpc.config.saveApiChatPreferences.useMutation(
    {
      onSuccess: async () => {
        await apiChatConfiguration.refetch();
        toast.success("Configuración de ApiChat guardada");
      },
      onError: error => toast.error(error.message),
    }
  );
  const saveApiChatPublicBaseUrl =
    trpc.config.savePublicBaseUrl.useMutation({
      onSuccess: async () => {
        await apiChatConfiguration.refetch();
      },
      onError: error => toast.error(error.message),
    });
  const apiChatReception = trpc.config.apiChatReception.useQuery();
  const reception = apiChatReception.data;
  const dropboxOAuthConfiguration = trpc.config.dropboxOAuthConfiguration.useQuery();
  const dropboxOAuthDiagnostics = trpc.config.dropboxOAuthDiagnostics.useQuery();
  const saveDropboxOAuthSecret = trpc.config.saveDropboxOAuthSecret.useMutation({
    onSuccess: async () => {
      await Promise.all([
        dropboxOAuthConfiguration.refetch(),
        dropboxOAuthDiagnostics.refetch(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const verifyApiChatReception = trpc.config.verifyApiChatReception.useMutation({
    onSuccess: async result => {
      await apiChatReception.refetch();
      toast.success(
        `Recepción verificada sobre el historial oficial (HTTP ${result.statusCode}, ${result.sampleCount} registro(s) en la muestra).`
      );
    },
    onError: error => toast.error(error.message),
  });
  const apiChatEndpoints = trpc.config.apiChatEndpoints.useQuery();
  const endpointCatalog = apiChatEndpoints.data;
  const saveApiChatEndpoints = trpc.config.saveApiChatEndpoints.useMutation({
    onSuccess: async data => {
      await apiChatEndpoints.refetch();
      if (data?.enabled) {
        toast.success("Endpoints guardados y habilitados");
      } else {
        toast.success("Endpoints guardados; pendientes de credenciales");
      }
    },
    onError: error => toast.error(error.message),
  });
  const [endpointToggles, setEndpointToggles] = useState<
    Record<string, boolean>
  >({});

  // Configuración efectiva de la cuenta del proveedor. El modo en que ApiChat
  // anuncia los adjuntos no se deduce de las pérdidas: se lee. La lectura que
  // dibuja esta tarjeta es la guardada; la verificación contra el proveedor es
  // un acto explícito del operador y queda sellada con su marca de observación.
  const apiChatAccount = trpc.config.apiChatAccount.useQuery();
  const accountNotification = endpointCatalog?.attachmentNotification;
  const verifyApiChatAccount = trpc.config.verifyApiChatAccount.useMutation({
    onSuccess: async result => {
      await Promise.all([apiChatAccount.refetch(), apiChatEndpoints.refetch()]);
      const state = result?.verdict?.state;
      if (state === "direccion_de_medios") {
        toast.success(
          "Cuenta verificada: el proveedor anunciará los adjuntos con la dirección de medios del contrato."
        );
      } else {
        toast.info(
          "Cuenta verificada: el proveedor anuncia el descriptor del archivo sin su carga."
        );
      }
    },
    onError: error => toast.error(error.message),
  });
  const setAttachmentNotification =
    trpc.config.setApiChatAttachmentNotification.useMutation({
      onSuccess: async result => {
        await Promise.all([
          apiChatAccount.refetch(),
          apiChatEndpoints.refetch(),
        ]);
        toast.success(
          result.notification.notifyAttachmentBase64
            ? "La cuenta notifica los adjuntos en base64."
            : "La cuenta notifica los adjuntos con su dirección de medios."
        );
      },
      onError: error => toast.error(error.message),
    });

  // Registro de códecs y decodificadores del transporte. El borrador conserva
  // la decisión del operador hasta que se guarda, y el resumen del servidor
  // describe el estado **guardado**, no el que se está editando.
  const codecCatalog = trpc.codecs.catalog.useQuery();
  const saveCodecs = trpc.codecs.save.useMutation({
    onSuccess: async () => {
      await codecCatalog.refetch();
      setCodecNotice("Registro de códecs guardado.");
    },
  });
  const [codecDraft, setCodecDraft] = useState<Record<string, boolean> | null>(
    null
  );
  const [codecNotice, setCodecNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!codecCatalog.data || codecDraft) return;
    setCodecDraft(
      Object.fromEntries(
        codecCatalog.data.entries.map(entry => [entry.id, entry.enabled])
      )
    );
  }, [codecCatalog.data, codecDraft]);
  const conversationActivation = trpc.config.conversationActivation.useQuery();
  const saveConversationActivation =
    trpc.config.saveConversationActivation.useMutation({
      onSuccess: async () => {
        await Promise.all([
          conversationActivation.refetch(),
          apiChatEndpoints.refetch(),
        ]);
        toast.success("Activación del servicio conversacional guardada");
      },
      onError: error => toast.error(error.message),
    });
  const [activationDraft, setActivationDraft] = useState<{
    agentEnabled: boolean;
    serviceMode: "single" | "split";
    capabilityReceive: boolean;
    capabilityReason: boolean;
    capabilitySend: boolean;
    outboxDispatchEnabled: boolean;
    memoryTurns: number;
    responseWordLimit: number;
  } | null>(null);

  useEffect(() => {
    const current = conversationActivation.data;
    if (!current) return;
    setActivationDraft({
      agentEnabled: current.agentEnabled,
      serviceMode: current.serviceMode,
      capabilityReceive: current.capabilities.receive,
      capabilityReason: current.capabilities.reason,
      capabilitySend: current.capabilities.send,
      outboxDispatchEnabled: current.outboxDispatchEnabled,
      memoryTurns: current.memoryTurns,
      responseWordLimit: current.responseWordLimit,
    });
  }, [conversationActivation.data]);

  useEffect(() => {
    if (!endpointCatalog) return;
    const next: Record<string, boolean> = {};
    for (const endpoint of endpointCatalog.endpoints) {
      next[endpoint.path] = endpoint.enabled;
    }
    setEndpointToggles(current => {
      const changed = Object.keys(next).some(
        key => (current[key] ?? true) !== next[key]
      );
      return changed ? next : current;
    });
  }, [endpointCatalog]);
  const knowledgeSettings = trpc.config.knowledgeSettings.useQuery();
  const saveKnowledgeSettings = trpc.config.saveKnowledgeSettings.useMutation({
    onSuccess: async () => {
      await knowledgeSettings.refetch();
      toast.success("Configuración de conocimiento guardada correctamente");
    },
    onError: error => toast.error(error.message),
  });
  const [knowledgeExtensions, setKnowledgeExtensions] = useState<string[]>([]);
  const [knowledgeMaxSize, setKnowledgeMaxSize] = useState("20");

  useEffect(() => {
    if (!knowledgeSettings.data) return;
    setKnowledgeExtensions(knowledgeSettings.data.allowedExtensions);
    setKnowledgeMaxSize(String(knowledgeSettings.data.maxSizeMb));
  }, [knowledgeSettings.data]);
  const importCatalog = trpc.geo.importCatalog.useMutation();
  const catalog = trpc.geo.adminCatalog.useQuery();
  const updateItem = trpc.geo.updateItem.useMutation({
    onSuccess: () => catalog.refetch(),
  });
  const [recipient, setRecipient] = useState({ label: "", phone: "" });
  const [country, setCountry] = useState("GT");
  const [essenceWordLimit, setEssenceWordLimit] = useState(550);
  const [cvAnalysisLoaded, setCvAnalysisLoaded] = useState(false);
  const [cvRequestLoaded, setCvRequestLoaded] = useState(false);
  const [catalogText, setCatalogText] = useState("");
  const [saved, setSaved] = useState(false);
  const [apiChat, setApiChat] = useState({
    mode: "native" as "native" | "legacy",
    endpoint: "https://api.apichat.io/v1/",
    connectTo: "apichat.io",
  });

  useEffect(() => {
    if (!apiChatConfiguration.data) return;
    setApiChat({
      mode: apiChatConfiguration.data.mode,
      endpoint: apiChatConfiguration.data.endpoint,
      connectTo: apiChatConfiguration.data.connectTo,
    });
  }, [apiChatConfiguration.data]);

  const persistDropboxOAuthSecret = async (
    key: "oauth_client_id" | "oauth_client_secret",
    value: string | null
  ) => {
    try {
      await saveDropboxOAuthSecret.mutateAsync({ key, value });
      toast.success(
        value ? "Credencial de Dropbox guardada" : "Credencial eliminada"
      );
      return true;
    } catch {
      return false;
    }
  };

  const persistApiChatPublicBaseUrl = async (value: string) => {
    try {
      await saveApiChatPublicBaseUrl.mutateAsync({ publicBaseUrl: value });
      toast.success(
        value.trim()
          ? "Dirección pública declarada"
          : "Dirección pública retirada"
      );
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (cvAnalysisLoaded || !cvAnalysis.data) return;
    setEssenceWordLimit(cvAnalysis.data.essenceWordLimit);
    setCvAnalysisLoaded(true);
  }, [cvAnalysis.data, cvAnalysisLoaded]);

  useEffect(() => {
    if (cvRequestLoaded || !settings.data) return;
    const rows = settings.data as Array<{
      setting_key: string;
      setting_value: string | null;
    }>;
    const savedCountry = rows.find(
      row => row.setting_key === "default_country"
    );
    if (savedCountry?.setting_value) {
      setCountry(savedCountry.setting_value);
    }
    setCvRequestLoaded(true);
  }, [settings.data, cvRequestLoaded]);

  const save = async () => {
    try {
      await saveSetting.mutateAsync({
        provider: "recruitment",
        settingKey: "default_country",
        settingValue: country.toUpperCase(),
        isSecret: false,
      });
      await Promise.all([cvAnalysis.refetch(), settings.refetch()]);
      setSaved(true);
      toast.success("Evaluación de CV guardada");
      window.setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No fue posible guardar la evaluación de CV."
      );
    }
  };
  const addRecipient = async () => {
    if (!recipient.label || !recipient.phone) return;
    await saveRecipient.mutateAsync({ ...recipient, active: true });
    setRecipient({ label: "", phone: "" });
  };
  const importData = async () => {
    try {
      await importCatalog.mutateAsync(JSON.parse(catalogText));
      setCatalogText("");
      await catalog.refetch();
    } catch {
      // Se muestra el error devuelto por el backend cuando la carga no es válida.
    }
  };

  return (
    <div className="space-y-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
          Administración
        </p>
        <h1 className="mt-2 text-4xl font-800 tracking-[-.04em] text-primary">
          Configuración
        </h1>
        <p className="mt-2 text-muted-foreground">
          Conexiones, preferencias y catálogos que sostienen la operación.
        </p>
      </div>

      <Tabs defaultValue="whatsapp" className="space-y-5">
        <TabsList className="h-auto w-full justify-start gap-2 rounded-2xl bg-muted p-1 sm:w-fit">
          <TabsTrigger value="whatsapp" className="rounded-xl px-4 py-2">
            <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
          </TabsTrigger>
          <TabsTrigger value="geo" className="rounded-xl px-4 py-2">
            <Globe2 className="mr-2 h-4 w-4" /> Catálogo
          </TabsTrigger>
          <TabsTrigger value="security" className="rounded-xl px-4 py-2">
            <ShieldCheck className="mr-2 h-4 w-4" /> Seguridad
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="space-y-5">
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl text-primary">
                    ApiChat / WhatsApp
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    El servicio conversacional recibe por el historial oficial,
                    razona con el expediente y la base de conocimiento, y
                    responde por el canal autorizado. El agente JARVI HR no
                    ofrece remuneración ni decide contratación.
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                  <Badge
                    variant={reception?.sendReady ? "default" : "outline"}
                    className="rounded-full"
                  >
                    {reception?.sendReady ? "Envío listo" : "Envío pendiente"}
                  </Badge>
                  <Badge
                    variant={reception?.receiveReady ? "default" : "outline"}
                    className="rounded-full"
                  >
                    {!reception?.receiveReady
                      ? "Recepción pendiente"
                      : reception?.receiveVerifiedAt
                        ? "Recepción verificada"
                        : "Recepción sin verificar"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-primary">
                    Modo API
                  </Label>
                  <Select
                    value={apiChat.mode}
                    onValueChange={mode =>
                      setApiChat(current => ({
                        ...current,
                        mode: mode as "native" | "legacy",
                      }))
                    }
                  >
                    <SelectTrigger className="rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="native">API nativa</SelectItem>
                      <SelectItem value="legacy">API heredada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="apichat-endpoint"
                    className="text-sm font-semibold text-primary"
                  >
                    Endpoint HTTPS
                  </Label>
                  <Input
                    id="apichat-endpoint"
                    value={apiChat.endpoint}
                    onChange={event =>
                      setApiChat(current => ({
                        ...current,
                        endpoint: event.target.value,
                      }))
                    }
                    className="rounded-2xl font-mono text-xs"
                    inputMode="url"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="apichat-connect-to"
                    className="text-sm font-semibold text-primary"
                  >
                    Conexión
                  </Label>
                  <Input
                    id="apichat-connect-to"
                    value={apiChat.connectTo}
                    onChange={event =>
                      setApiChat(current => ({
                        ...current,
                        connectTo: event.target.value,
                      }))
                    }
                    className="rounded-2xl font-mono text-xs"
                    placeholder="apichat.io"
                  />
                </div>
              </div>
              <Button
                className="rounded-full"
                disabled={
                  saveApiChatPreferences.isPending ||
                  apiChatConfiguration.isLoading
                }
                onClick={() => saveApiChatPreferences.mutate(apiChat)}
              >
                {saveApiChatPreferences.isPending ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}{" "}
                Guardar conexión
              </Button>
              <div className="rounded-2xl border border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-primary">
                      Endpoints oficiales habilitados
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Encienda o apague cada endpoint; el cambio se aplica al
                      guardar.
                    </p>
                  </div>
                  <Button
                    className="rounded-full"
                    disabled={
                      saveApiChatEndpoints.isPending ||
                      apiChatEndpoints.isLoading
                    }
                    onClick={() =>
                      saveApiChatEndpoints.mutate({
                        endpoints: (
                          endpointCatalog?.endpoints ?? []
                        ).map(endpoint => ({
                          path: endpoint.path,
                          enabled:
                            endpointToggles[endpoint.path] ?? endpoint.enabled,
                        })),
                      })
                    }
                  >
                    {saveApiChatEndpoints.isPending ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}{" "}
                    Guardar endpoints
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {(endpointCatalog?.endpoints ?? []).map(endpoint => {
                    const enabled =
                      endpointToggles[endpoint.path] ?? endpoint.enabled;
                    return (
                      <div
                        key={`${endpoint.method}-${endpoint.path}`}
                        className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/40 p-2.5"
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold text-white ${
                            endpoint.method === "GET"
                              ? "bg-sky-600"
                              : "bg-emerald-600"
                          }`}
                        >
                          {endpoint.method}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words font-mono text-xs text-primary">
                            {endpoint.path}
                          </p>
                          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                            {endpoint.description}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {ENDPOINT_CAPABILITY_LABELS[
                                endpoint.capability
                              ] ?? endpoint.capability}
                            </span>
                            {endpoint.requiredForAgent ? (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                                Requerido por el agente
                              </span>
                            ) : (
                              <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                Opcional
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {(endpoint.consumers ?? [])
                                .map(
                                  consumer =>
                                    ENDPOINT_CONSUMER_LABELS[consumer] ??
                                    consumer
                                )
                                .join(" · ")}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground/80">
                            {endpoint.conversationUse}
                          </p>
                          <p className="mt-0.5 break-words font-mono text-[10px] leading-4 text-muted-foreground/80">
                            {`/v1/${endpoint.route}`}
                          </p>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={value =>
                            setEndpointToggles(current => ({
                              ...current,
                              [endpoint.path]: value,
                            }))
                          }
                          aria-label={`Activar ${endpoint.path}`}
                          className="mt-0.5 shrink-0"
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 rounded-2xl border border-border/70 bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-semibold text-primary">
                      Capacidad del servicio conversacional
                    </h4>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px]"
                    >
                      {endpointCatalog?.conversationMode === "split"
                        ? "Despliegue separado por capacidad"
                        : "Despliegue integrado"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    Cada capacidad declara lo que realmente puede ejecutar. El
                    razonamiento no consume endpoints del proveedor; la
                    recepción y el envío sí dependen de sus rutas oficiales.
                  </p>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                    {(endpointCatalog?.capabilities ?? []).map(capability => (
                      <div
                        key={capability.capability}
                        className="rounded-xl border border-border/70 bg-card p-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <p className="text-xs font-semibold text-primary">
                            {capability.label}
                          </p>
                          <Badge
                            variant={capability.ready ? "default" : "outline"}
                            className="rounded-full text-[10px]"
                          >
                            {capability.ready ? "Listo" : "Pendiente"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                          {capability.description}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                          {capability.requirement}
                        </p>
                        {capability.disabledRequiredPaths.length ? (
                          <p className="mt-1 text-[11px] text-destructive">
                            Requiere encender{" "}
                            {capability.disabledRequiredPaths.join(", ")}.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {(endpointCatalog?.advisories ?? []).length ? (
                    <ul className="mt-2 space-y-1">
                      {(endpointCatalog?.advisories ?? []).map(advisory => (
                        <li
                          key={advisory}
                          className="text-[11px] leading-4 text-amber-900"
                        >
                          · {advisory}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {endpointCatalog?.attachmentTransport ? (
                  <div className="mt-3 rounded-2xl border border-border/70 bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Recepción de adjuntos
                      </p>
                      <Badge
                        variant="outline"
                        className={`rounded-full text-[10px] ${
                          endpointCatalog.attachmentTransport.status ===
                          "verificado"
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                            : endpointCatalog.attachmentTransport.status ===
                                "con_perdidas"
                              ? "border-rose-300 bg-rose-100 text-rose-900"
                              : "border-amber-300 bg-amber-100 text-amber-950"
                        }`}
                      >
                        {endpointCatalog.attachmentTransport.status ===
                        "verificado"
                          ? "Verificada"
                          : endpointCatalog.attachmentTransport.status ===
                              "con_perdidas"
                            ? "Con pérdidas"
                            : "Sin evidencia"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {endpointCatalog.attachmentTransport.received} recibido(s)
                      y {endpointCatalog.attachmentTransport.total} pérdida(s) en
                      las últimas {endpointCatalog.attachmentTransport.windowHours}{" "}
                      horas.
                      {endpointCatalog.attachmentTransport.lastReceivedAt
                        ? ` Última recepción: ${new Date(
                            endpointCatalog.attachmentTransport.lastReceivedAt
                          ).toLocaleString("es-GT", {
                            timeZone: "America/Guatemala",
                          })}.`
                        : ""}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {endpointCatalog.attachmentRequirement}
                    </p>
                  </div>
                ) : null}
                {/*
                  Modo en que el proveedor anuncia el adjunto. Es la
                  precondición del conducto que vive fuera del artefacto y que,
                  hasta ahora, sólo se manifestaba como pérdida ya consumada.
                  Se declara con su requisito y con la acción que la corrige.
                */}
                {accountNotification ? (
                  <div className="mt-3 rounded-2xl border border-border/70 bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Modo de notificación del proveedor
                      </p>
                      <Badge
                        variant="outline"
                        className={`rounded-full text-[10px] ${
                          accountNotification.state === "direccion_de_medios"
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                            : accountNotification.state === "descriptor_sin_carga"
                              ? "border-rose-300 bg-rose-100 text-rose-900"
                              : "border-amber-300 bg-amber-100 text-amber-950"
                        }`}
                      >
                        {accountNotification.state === "direccion_de_medios"
                          ? "Dirección de medios"
                          : accountNotification.state === "descriptor_sin_carga"
                            ? "Descriptor sin carga"
                            : "Sin verificar"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {accountNotification.requirement}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {accountNotification.action}
                    </p>
                    {accountNotification.account ? (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                        base64:{" "}
                        {String(
                          accountNotification.account.notifyAttachmentBase64
                        )}{" "}
                        · formato:{" "}
                        {String(accountNotification.account.notifyFormat)} ·
                        chatapi:{" "}
                        {String(accountNotification.account.isChatapi)} ·
                        apigraph:{" "}
                        {String(accountNotification.account.isApigraph)} ·
                        desde-mi:{" "}
                        {String(
                          accountNotification.account.notifyFromMeMessage
                        )}
                        {accountNotification.account.webhookAddress
                          ? ` · webhook: ${accountNotification.account.webhookAddress}`
                          : ""}
                        {accountNotification.account.observedAt
                          ? ` · observado: ${new Date(
                              accountNotification.account.observedAt
                            ).toLocaleString("es-GT", {
                              timeZone: "America/Guatemala",
                            })}`
                          : ""}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verifyApiChatAccount.isPending}
                        onClick={() => verifyApiChatAccount.mutate()}
                      >
                        {verifyApiChatAccount.isPending
                          ? "Consultando la cuenta…"
                          : "Leer la cuenta del proveedor"}
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          accountNotification.state === "descriptor_sin_carga"
                            ? "default"
                            : "outline"
                        }
                        disabled={setAttachmentNotification.isPending}
                        onClick={() =>
                          setAttachmentNotification.mutate({
                            enabled:
                              accountNotification.state !==
                              "descriptor_sin_carga",
                          })
                        }
                      >
                        {setAttachmentNotification.isPending
                          ? "Aplicando…"
                          : accountNotification.state === "descriptor_sin_carga"
                            ? "Anunciar con la dirección de medios"
                            : "Volver a la notificación en base64"}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {endpointCatalog && !endpointCatalog.enabled ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Los interruptores se aplicarán cuando las credenciales estén
                    configuradas y el modo sea API nativa.
                  </p>
                ) : null}
                <div className="mt-3 rounded-2xl border border-border/70 bg-muted/30 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-primary">
                        Códecs y decodificadores del transporte
                      </h4>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        Contenedor y códec por separado, agrupados por familia y
                        entregados activados. Apagar una entrada con conducto en
                        uso produce una advertencia: el efecto sería una pérdida
                        sin error.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className="rounded-full text-[10px]"
                      >
                        {codecCatalog.data?.complete ? "Completo" : "Parcial"}
                      </Badge>
                      <Button
                        size="sm"
                        disabled={!codecDraft || saveCodecs.isPending}
                        onClick={() =>
                          codecDraft &&
                          saveCodecs.mutate({ enabled: codecDraft })
                        }
                      >
                        Guardar códecs
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {(codecCatalog.data?.families ?? []).map(family => (
                      <div
                        key={family.family}
                        className="rounded-xl border border-border/60 bg-background/60 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold text-primary">
                            {family.label}
                          </p>
                          <span className="text-[10px] text-muted-foreground">
                            {family.enabled} de {family.total}
                          </span>
                        </div>
                        <ul className="mt-2 space-y-1.5">
                          {(codecCatalog.data?.entries ?? [])
                            .filter(entry => entry.family === family.family)
                            .map(entry => (
                              <li
                                key={entry.id}
                                className="flex items-start justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-[11px] font-medium">
                                    {entry.container} · {entry.codec}
                                  </p>
                                  <p className="text-[10px] leading-4 text-muted-foreground">
                                    {entry.decoder} · {entry.requirement} ·{" "}
                                    {entry.useLabel}
                                  </p>
                                </div>
                                <Switch
                                  checked={
                                    codecDraft?.[entry.id] ?? entry.enabled
                                  }
                                  aria-label={`${entry.container} ${entry.codec}`}
                                  onCheckedChange={next =>
                                    setCodecDraft(draft => ({
                                      ...(draft ?? {}),
                                      [entry.id]: next,
                                    }))
                                  }
                                />
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  {(codecCatalog.data?.advisories ?? []).length ? (
                    <ul className="mt-2 space-y-1">
                      {(codecCatalog.data?.advisories ?? []).map(advisory => (
                        <li
                          key={advisory}
                          className="text-[11px] leading-4 text-amber-900"
                        >
                          · {advisory}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {codecNotice ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {codecNotice}
                    </p>
                  ) : null}
                </div>
                <div className="mt-3 rounded-2xl border border-border/70 bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-semibold text-primary">
                      Activación del servicio conversacional
                    </h4>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px]"
                    >
                      {conversationActivation.data?.panelReady
                        ? "Configurado en el panel"
                        : "Preactivado por valores de fábrica"}
                    </Badge>
                    {conversationActivation.data?.environmentOverride ? (
                      <Badge
                        variant="outline"
                        className="rounded-full border-amber-300 text-[10px] text-amber-900"
                      >
                        Anulación por variable de entorno
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    La activación vive en esta configuración y no en variables de
                    entorno: la migración de la versión la deja encendida y cada
                    cambio queda auditado.
                  </p>
                  {activationDraft ? (
                    <>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <ActivationToggle
                          label="Agente JARVI HR"
                          description="Genera respuestas y cierra ciclos de información."
                          checked={activationDraft.agentEnabled}
                          onCheckedChange={value =>
                            setActivationDraft(current =>
                              current ? { ...current, agentEnabled: value } : current
                            )
                          }
                        />
                        <ActivationToggle
                          label="Despacho de la cola"
                          description="Despacha por WhatsApp las respuestas autorizadas."
                          checked={activationDraft.outboxDispatchEnabled}
                          onCheckedChange={value =>
                            setActivationDraft(current =>
                              current
                                ? { ...current, outboxDispatchEnabled: value }
                                : current
                            )
                          }
                        />
                        <ActivationToggle
                          label="Capacidad de recepción"
                          description="Registra lo que la persona escribe por el canal."
                          checked={activationDraft.capabilityReceive}
                          onCheckedChange={value =>
                            setActivationDraft(current =>
                              current
                                ? { ...current, capabilityReceive: value }
                                : current
                            )
                          }
                        />
                        <ActivationToggle
                          label="Capacidad de razonamiento"
                          description="Compone el expediente y verifica la conducta."
                          checked={activationDraft.capabilityReason}
                          onCheckedChange={value =>
                            setActivationDraft(current =>
                              current
                                ? { ...current, capabilityReason: value }
                                : current
                            )
                          }
                        />
                        <ActivationToggle
                          label="Capacidad de envío"
                          description="Despacha al proveedor lo que el motor encola."
                          checked={activationDraft.capabilitySend}
                          onCheckedChange={value =>
                            setActivationDraft(current =>
                              current
                                ? { ...current, capabilitySend: value }
                                : current
                            )
                          }
                        />
                        <div className="rounded-xl border border-border/70 bg-card p-2.5">
                          <p className="text-xs font-semibold text-primary">
                            Despliegue
                          </p>
                          <Select
                            value={activationDraft.serviceMode}
                            onValueChange={value =>
                              setActivationDraft(current =>
                                current
                                  ? {
                                      ...current,
                                      serviceMode: value as "single" | "split",
                                    }
                                  : current
                              )
                            }
                          >
                            <SelectTrigger className="mt-1 h-8 rounded-lg text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">
                                Integrado en la aplicación
                              </SelectItem>
                              <SelectItem value="split">
                                Separado por capacidad
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            En modo separado el barrido integrado se detiene y
                            los servicios dedicados atienden cada capacidad.
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-card p-2.5">
                          <Label className="text-xs font-semibold text-primary">
                            Historial recordado (turnos)
                          </Label>
                          <Input
                            type="number"
                            min={4}
                            max={40}
                            value={activationDraft.memoryTurns}
                            onChange={event =>
                              setActivationDraft(current =>
                                current
                                  ? {
                                      ...current,
                                      memoryTurns: Number(event.target.value),
                                    }
                                  : current
                              )
                            }
                            className="mt-1 h-8 rounded-lg text-xs"
                          />
                        </div>
                        <div className="rounded-xl border border-border/70 bg-card p-2.5">
                          <Label className="text-xs font-semibold text-primary">
                            Límite de palabras por respuesta
                          </Label>
                          <Input
                            type="number"
                            min={30}
                            max={200}
                            value={activationDraft.responseWordLimit}
                            onChange={event =>
                              setActivationDraft(current =>
                                current
                                  ? {
                                      ...current,
                                      responseWordLimit: Number(event.target.value),
                                    }
                                  : current
                              )
                            }
                            className="mt-1 h-8 rounded-lg text-xs"
                          />
                        </div>
                      </div>
                      {(conversationActivation.data?.advisories ?? []).length ? (
                        <ul className="mt-2 space-y-1">
                          {(conversationActivation.data?.advisories ?? []).map(
                            advisory => (
                              <li
                                key={advisory}
                                className="text-[11px] leading-4 text-amber-900"
                              >
                                · {advisory}
                              </li>
                            )
                          )}
                        </ul>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={
                            saveConversationActivation.isPending ||
                            conversationActivation.isLoading
                          }
                          onClick={() =>
                            saveConversationActivation.mutate(activationDraft)
                          }
                        >
                          {saveConversationActivation.isPending ? (
                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Guardar activación
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full"
                          onClick={() => {
                            const defaults = conversationActivation.data?.defaults;
                            if (!defaults) return;
                            setActivationDraft({
                              agentEnabled: defaults.agentEnabled,
                              serviceMode: defaults.serviceMode,
                              capabilityReceive: defaults.capabilityReceive,
                              capabilityReason: defaults.capabilityReason,
                              capabilitySend: defaults.capabilitySend,
                              outboxDispatchEnabled:
                                defaults.outboxDispatchEnabled,
                              memoryTurns: defaults.memoryTurns,
                              responseWordLimit: defaults.responseWordLimit,
                            });
                          }}
                        >
                          Restaurar valores de fábrica
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Cargando la activación vigente.
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-primary">
                      Recepción conversacional
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      La bandeja se alimenta por sondeo periódico del historial
                      oficial. El sello temporal solo se escribe cuando el
                      proveedor responde con el historial. Conservar el
                      endpoint de historial encendido es requisito de recepción.
                    </p>
                    {reception?.receiveVerifiedAt ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Última verificación de recepción:{" "}
                        {new Intl.DateTimeFormat("es-GT", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "America/Guatemala",
                        }).format(new Date(reception.receiveVerifiedAt))}
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Sin verificación registrada.
                      </p>
                    )}
                    {reception && !reception.historyEnabled ? (
                      <p className="mt-1 text-[11px] text-destructive">
                        El endpoint de historial está apagado: la recepción no
                        puede funcionar.
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    className="rounded-full"
                    disabled={
                      verifyApiChatReception.isPending ||
                      !reception?.receiveReady
                    }
                    onClick={() => verifyApiChatReception.mutate()}
                  >
                    {verifyApiChatReception.isPending ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}{" "}
                    Verificar recepción
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                <CredentialField
                  label="Dirección pública"
                  description="Base con la que el proveedor descarga los archivos salientes; vacía, se deduce del proxy inverso"
                  placeholder="https://su-dominio"
                  secret={false}
                  state={{
                    configured: Boolean(
                      apiChatConfiguration.data?.publicBaseUrl
                    ),
                    masked: apiChatConfiguration.data?.publicBaseUrl ?? "",
                  }}
                  pending={saveApiChatPublicBaseUrl.isPending}
                  onSave={persistApiChatPublicBaseUrl}
                  onRemove={() => persistApiChatPublicBaseUrl("")}
                />
              </div>
              <div className="rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
                Las credenciales de ApiChat se administran en «Mi cuenta»: cada
                persona guarda la suya y la de plataforma —respaldo y
                recepción— la conserva el administrador. El secreto del webhook
                sigue gobernando esta ruta de recepción y también vive allí.
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-secondary p-4 text-sm leading-6 text-secondary-foreground">
                <strong className="text-primary">Seguridad:</strong> el servidor
                cifra las credenciales con AES-256-GCM antes de guardarlas en
                PostgreSQL. El navegador recibe únicamente máscaras de
                confirmación.
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <Cloud className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl text-primary">
                    Dropbox · plataforma OAuth
                  </CardTitle>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Credencial de la aplicación para que los propietarios de
                    proyecto vinculen su Dropbox desde «Mi cuenta». El secreto
                    se cifra y el navegador solo recibe máscaras.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <CredentialField
                  label="App key de Dropbox"
                  description="Identificador público de la aplicación en Dropbox Developers"
                  placeholder="Ingrese la app key"
                  secret={false}
                  state={dropboxOAuthConfiguration.data?.clientId}
                  pending={saveDropboxOAuthSecret.isPending}
                  onSave={value =>
                    persistDropboxOAuthSecret("oauth_client_id", value)
                  }
                  onRemove={() =>
                    persistDropboxOAuthSecret("oauth_client_id", null)
                  }
                />
                <CredentialField
                  label="App secret de Dropbox"
                  description="Secreto de la aplicación; se cifra antes de guardarse"
                  placeholder="Ingrese el app secret"
                  state={dropboxOAuthConfiguration.data?.secret}
                  pending={saveDropboxOAuthSecret.isPending}
                  onSave={value =>
                    persistDropboxOAuthSecret("oauth_client_secret", value)
                  }
                  onRemove={() =>
                    persistDropboxOAuthSecret("oauth_client_secret", null)
                  }
                />
              </div>
              {dropboxOAuthDiagnostics.data ? (
                <div className="rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
                  {dropboxOAuthDiagnostics.data.ready ? (
                    <p>
                      La credencial de plataforma está completa y descifrable:
                      el vínculo desde «Mi cuenta» puede iniciarse.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {!dropboxOAuthDiagnostics.data.clientId.configured && (
                        <li>Falta la App key de Dropbox.</li>
                      )}
                      {dropboxOAuthDiagnostics.data.secret.state === "ausente" && (
                        <li>Falta el App secret de Dropbox.</li>
                      )}
                      {dropboxOAuthDiagnostics.data.secret.state ===
                        "indescifrable" && (
                        <li>
                          El App secret guardado no se descifra con la clave
                          vigente: {dropboxOAuthDiagnostics.data.secret.reason}
                        </li>
                      )}
                      {dropboxOAuthDiagnostics.data.encryptionKey.state !==
                        "lista" && (
                        <li>{dropboxOAuthDiagnostics.data.encryptionKey.message}</li>
                      )}
                    </ul>
                  )}
                </div>
              ) : null}
              <div className="rounded-2xl border border-emerald-400/20 bg-secondary p-4 text-sm leading-6 text-secondary-foreground">
                <p className="font-semibold text-primary">
                  Registro de la aplicación en Dropbox
                </p>
                <ol className="mt-2 list-decimal space-y-2 pl-5">
                  <li>
                    En Dropbox Developers cree la aplicación con{" "}
                    <span className="font-mono text-xs">Scoped access</span> y
                    acceso <span className="font-mono text-xs">App folder</span>.
                    Ese alcance concede únicamente la carpeta{" "}
                    <span className="font-mono text-xs">Aplicaciones/JARVI RH</span>{" "}
                    de cada cuenta.
                  </li>
                  <li>
                    En <span className="font-mono text-xs">Permissions</span>{" "}
                    active{" "}
                    <span className="font-mono text-xs">files.content.read</span>,{" "}
                    <span className="font-mono text-xs">files.content.write</span>{" "}
                    y{" "}
                    <span className="font-mono text-xs">files.metadata.read</span>,
                    y pulse <span className="font-mono text-xs">Submit</span>: sin
                    ellos la autorización responde{" "}
                    <span className="font-mono text-xs">invalid_scope</span>.
                  </li>
                  <li>
                    En{" "}
                    <span className="font-mono text-xs">OAuth 2 · Redirect URIs</span>{" "}
                    agregue <strong>exactamente</strong> la dirección de esta
                    instalación y guarde antes de reintentar el vínculo. Sin
                    parámetros, sin barra final y sin comodines:
                    <span className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-background px-3 py-1.5 font-mono text-xs">
                        {dropboxRedirectUri}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={copyDropboxRedirectUri}
                      >
                        {copiedDropboxRedirect ? "Copiada" : "Copiar"}
                      </Button>
                    </span>
                  </li>
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  Dropbox compara la dirección carácter por carácter. El puerto,
                  el subdominio y la ruta cuentan: un dominio distinto —una
                  dirección interna o de previsualización— reproduce el rechazo
                  «Invalid redirect_uri» al autorizar.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-xl text-primary">
                Evaluación de CV con IA
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                El agente solicita el CV al confirmar el formulario, deja el
                expediente en espera y lo recibe en el RAG Personal cuando la
                persona responde por el mismo medio.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-primary">
                  País predeterminado
                </Label>
                <Input
                  value={country}
                  onChange={e =>
                    setCountry(e.target.value.toUpperCase().slice(0, 2))
                  }
                  className="rounded-2xl"
                  placeholder="GT"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-primary">
                  Palabras de la esencia del CV
                </Label>
                <Input
                  type="number"
                  min={200}
                  max={900}
                  value={essenceWordLimit}
                  onChange={e => setEssenceWordLimit(Number(e.target.value))}
                  className="rounded-2xl"
                />
                <p className="text-xs text-muted-foreground">
                  Entre 200 y 900 palabras. El servidor aplica el límite al
                  análisis.
                </p>
              </div>
              <Button
                onClick={save}
                disabled={saveSetting.isPending}
                className="rounded-full"
              >
                <Save className="mr-2 h-4 w-4" /> Guardar evaluación de CV
              </Button>
              {saved && (
                <span className="ml-3 inline-flex items-center gap-2 text-sm text-emerald-700">
                  <Check className="h-4 w-4" /> Guardado
                </span>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-xl text-primary">
                Conocimiento de proyectos (RAG)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Límites que utiliza Administrador de Proyectos al cargar
                archivos; las alertas de carga citan estos valores.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-primary">
                  Extensiones permitidas
                </Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    "jpg",
                    "jpeg",
                    "png",
                    "mp4",
                    "mp3",
                    "doc",
                    "docx",
                    "xls",
                    "xlsx",
                    "csv",
                    "pdf",
                  ].map(extension => {
                    const enabled = knowledgeExtensions.includes(extension);
                    return (
                      <button
                        key={extension}
                        type="button"
                        aria-pressed={enabled}
                        onClick={() =>
                          setKnowledgeExtensions(current =>
                            enabled
                              ? current.filter(item => item !== extension)
                              : [...current, extension]
                          )
                        }
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${enabled ? "border-emerald-600 bg-emerald-100 font-semibold text-emerald-900" : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40"}`}
                      >
                        .{extension}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  La alerta de extensión no permitida cita esta lista como
                  referencia.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-primary">
                    Peso máximo por archivo (MB)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={knowledgeMaxSize}
                    onChange={event => setKnowledgeMaxSize(event.target.value)}
                    className="rounded-xl"
                  />
                  <p className="text-xs text-muted-foreground">
                    Entre 1 y 30 MB. La alerta de peso cita este valor en el
                    área de arrastre.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                className="rounded-full"
                disabled={
                  saveKnowledgeSettings.isPending ||
                  !knowledgeExtensions.length
                }
                onClick={() =>
                  saveKnowledgeSettings.mutate({
                    allowedExtensions: knowledgeExtensions,
                    maxSizeMb: Number(knowledgeMaxSize),
                  })
                }
              >
                <Save className="mr-2 h-4 w-4" /> Guardar configuración de
                conocimiento
              </Button>
            </CardContent>
          </Card>
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-xl text-primary">
                Números internos para alertas
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Recibirán un aviso por WhatsApp cuando un candidato avance.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={recipient.label}
                  onChange={e =>
                    setRecipient({ ...recipient, label: e.target.value })
                  }
                  placeholder="Nombre o equipo"
                  className="rounded-2xl"
                />
                <GuatemalaPhoneInput
                  value={recipient.phone}
                  onChange={phone => setRecipient({ ...recipient, phone })}
                  className="rounded-2xl"
                  ariaLabel="Teléfono interno de Guatemala"
                />
                <Button
                  onClick={addRecipient}
                  disabled={saveRecipient.isPending}
                  className="rounded-2xl"
                >
                  <Plus className="mr-2 h-4 w-4" /> Agregar
                </Button>
              </div>
              <div className="divide-y divide-border/70 rounded-2xl border border-border/70">
                {recipients.data?.length ? (
                  recipients.data.map((row: any) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between p-4"
                    >
                      <div>
                        <p className="font-semibold text-primary">
                          {row.label}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {row.phone_international}
                        </p>
                      </div>
                      <Badge className="rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                        Activo
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="p-5 text-sm text-muted-foreground">
                    Agregue el primer número interno.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="geo">
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-sky-50 text-sky-700">
                  <Globe2 className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-xl text-primary">
                    Nomenclatura de Guatemala
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Fuente inicial:{" "}
                    <a
                      className="font-semibold text-sky-700 underline"
                      href="https://www.ine.gob.gt/sistema/uploads/2016/10/28/0NiM1ouoHaN67SRO2IzXZ5RNI7FeyHpn.xls"
                      target="_blank"
                      rel="noreferrer"
                    >
                      archivo oficial del INE
                    </a>
                    .
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6">
                <div className="flex items-start gap-3">
                  <Upload className="mt-1 h-5 w-5 text-sky-700" />
                  <div>
                    <h3 className="font-semibold text-primary">
                      Importar actualización
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Pegue un JSON con `departments`, `municipalities` y
                      opcionalmente `zones`. Los códigos se preservan y los
                      nombres se actualizan sin romper respuestas históricas.
                    </p>
                  </div>
                </div>
                <Textarea
                  value={catalogText}
                  onChange={e => setCatalogText(e.target.value)}
                  rows={6}
                  className="mt-5 rounded-2xl font-mono text-xs"
                  placeholder='{"departments":[{"code":"01","name":"Guatemala"}],"municipalities":[],"zones":[]}'
                />
                <Button
                  onClick={importData}
                  disabled={importCatalog.isPending || !catalogText}
                  className="mt-4 rounded-full"
                >
                  <Upload className="mr-2 h-4 w-4" /> Importar catálogo
                </Button>
                {importCatalog.isSuccess && (
                  <p className="mt-3 text-sm text-emerald-700">
                    Catálogo importado: {importCatalog.data.departments}{" "}
                    departamentos, {importCatalog.data.municipalities}{" "}
                    municipios y {importCatalog.data.zones} zonas.
                  </p>
                )}
                {importCatalog.error && (
                  <p className="mt-3 text-sm text-red-700">
                    {importCatalog.error.message}
                  </p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <CatalogStat
                  label="Departamentos"
                  value={String(catalog.data?.departments.length ?? 22)}
                />
                <CatalogStat
                  label="Municipios"
                  value={String(catalog.data?.municipalities.length ?? "338+")}
                />
                <CatalogStat
                  label="Zonas"
                  value={String(catalog.data?.zones.length ?? "Configurable")}
                />
              </div>
              <GeoTable
                title="Departamentos"
                entity="department"
                rows={catalog.data?.departments ?? []}
                onUpdate={(id, name, active) =>
                  updateItem.mutate({ entity: "department", id, name, active })
                }
              />
              <GeoTable
                title="Municipios"
                entity="municipality"
                rows={catalog.data?.municipalities ?? []}
                onUpdate={(id, name, active) =>
                  updateItem.mutate({
                    entity: "municipality",
                    id,
                    name,
                    active,
                  })
                }
              />
              <GeoTable
                title="Zonas"
                entity="zone"
                rows={catalog.data?.zones ?? []}
                onUpdate={(id, name, active) =>
                  updateItem.mutate({ entity: "zone", id, name, active })
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card className="rounded-3xl border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-xl text-primary">
                Roles y acceso
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                La configuración de formularios queda reservada a
                administración.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Role
                icon={ShieldCheck}
                title="Administrador"
                text="Control total sobre plazas, formularios, reglas, usuarios, integraciones y catálogo."
              />
              <Role
                icon={UsersRound}
                title="Reclutador"
                text="Acceso a todas las plazas, candidatos, estados e informes. Sin configuración de campos o formularios."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CatalogStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-4">
      <p className="text-xs uppercase tracking-[.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-800 text-primary">{value}</p>
    </div>
  );
}
function GeoTable({
  title,
  entity,
  rows,
  onUpdate,
}: {
  title: string;
  entity: "department" | "municipality" | "zone";
  rows: any[];
  onUpdate: (id: number, name: string, active: boolean) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  return (
    <Card className="rounded-3xl border-0 shadow-soft">
      <CardHeader>
        <CardTitle className="text-lg text-primary">
          Mantenimiento · {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length ? (
          rows.slice(0, 25).map(row => (
            <div
              key={row.id}
              className="flex items-center gap-2 rounded-xl bg-muted/55 p-3"
            >
              <span className="w-16 font-mono text-xs text-muted-foreground">
                {row.code}
              </span>
              {editing === row.id ? (
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="h-9 rounded-xl"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
                  {row.name}
                </span>
              )}
              <Badge variant="outline" className="rounded-full">
                {row.active ? "Activo" : "Inactivo"}
              </Badge>
              {editing === row.id ? (
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    onUpdate(row.id, name, row.active);
                    setEditing(null);
                  }}
                >
                  Guardar
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    setEditing(row.id);
                    setName(row.name);
                  }}
                >
                  Editar
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => onUpdate(row.id, row.name, !row.active)}
              >
                {row.active ? "Desactivar" : "Activar"}
              </Button>
            </div>
          ))
        ) : (
          <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
            Cargue el catálogo oficial para comenzar a administrarlo.
          </p>
        )}
        {rows.length > 25 && (
          <p className="text-xs text-muted-foreground">
            Mostrando 25 registros; la API mantiene el catálogo completo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
function Role({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border border-border/70 p-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="font-semibold text-primary">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function ActivationToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card p-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-primary">{label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
      />
    </div>
  );
}
