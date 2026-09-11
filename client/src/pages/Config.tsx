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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { GuatemalaPhoneInput } from "@/components/GuatemalaPhoneInput";
import {
  Check,
  CheckCircle2,
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

type ApiChatSecretKey =
  | "client_id"
  | "token"
  | "account_id"
  | "webhook_secret";

const defaultMessage = `Hola {{nombre}}, muchas gracias por su solicitud de empleo.

Le saludamos de parte de AISA Solar. Dando seguimiento a su solicitud de empleo para la plaza “{{plaza}}”, por este medio agradeceríamos que pudiera enviarnos su CV para que sea evaluado por nuestro equipo de Recursos Humanos.

Quedamos atentos a recibirlo. ¡Muchas gracias por su interés en formar parte de AISA Solar!`;

export default function Config() {
  const recipients = trpc.config.recipients.useQuery();
  const apiChatConfiguration = trpc.config.apiChatConfiguration.useQuery();
  const saveRecipient = trpc.config.saveRecipient.useMutation({
    onSuccess: () => recipients.refetch(),
  });
  const saveSetting = trpc.config.saveSetting.useMutation();
  const saveApiChatPreferences = trpc.config.saveApiChatPreferences.useMutation(
    {
      onSuccess: async () => {
        await apiChatConfiguration.refetch();
        toast.success("Configuración de ApiChat guardada");
      },
      onError: error => toast.error(error.message),
    }
  );
  const saveApiChatSecret = trpc.config.saveApiChatSecret.useMutation({
    onSuccess: async () => {
      await apiChatConfiguration.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const verifyApiChat = trpc.config.verifyApiChat.useMutation({
    onSuccess: result => {
      if (result.isConnected)
        toast.success("ApiChat está conectado y disponible");
      else
        toast.info(
          "Las credenciales son válidas; la instancia todavía no está conectada"
        );
    },
    onError: error => toast.error(error.message),
  });
  const importCatalog = trpc.geo.importCatalog.useMutation();
  const catalog = trpc.geo.adminCatalog.useQuery();
  const updateItem = trpc.geo.updateItem.useMutation({
    onSuccess: () => catalog.refetch(),
  });
  const [recipient, setRecipient] = useState({ label: "", phone: "" });
  const [country, setCountry] = useState("GT");
  const [message, setMessage] = useState(defaultMessage);
  const [catalogText, setCatalogText] = useState("");
  const [saved, setSaved] = useState(false);
  const [apiChat, setApiChat] = useState({
    mode: "native" as "native" | "legacy",
    endpoint: "https://api.apichat.io/v1/sendText",
    connectTo: "apichat.io",
    webhookUrl: "",
  });

  useEffect(() => {
    if (!apiChatConfiguration.data) return;
    setApiChat({
      mode: apiChatConfiguration.data.mode,
      endpoint: apiChatConfiguration.data.endpoint,
      connectTo: apiChatConfiguration.data.connectTo,
      webhookUrl: apiChatConfiguration.data.webhookUrl,
    });
  }, [apiChatConfiguration.data]);

  const persistApiChatSecret = async (
    key: ApiChatSecretKey,
    value: string | null
  ) => {
    try {
      await saveApiChatSecret.mutateAsync({ key, value });
      toast.success(
        value ? "Credencial cifrada y guardada" : "Credencial eliminada"
      );
      return true;
    } catch {
      return false;
    }
  };

  const save = async () => {
    await saveSetting.mutateAsync({
      provider: "recruitment",
      settingKey: "default_country",
      settingValue: country.toUpperCase(),
      isSecret: false,
    });
    await saveSetting.mutateAsync({
      provider: "recruitment",
      settingKey: "whatsapp_message",
      settingValue: message,
      isSecret: false,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
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
                    El backend envía directamente la solicitud de CV cuando se
                    selecciona “Solicitar CV por WhatsApp”.
                  </p>
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
                <div className="space-y-2">
                  <Label
                    htmlFor="apichat-webhook"
                    className="text-sm font-semibold text-primary"
                  >
                    URL del webhook
                  </Label>
                  <Input
                    id="apichat-webhook"
                    value={apiChat.webhookUrl}
                    onChange={event =>
                      setApiChat(current => ({
                        ...current,
                        webhookUrl: event.target.value,
                      }))
                    }
                    className="rounded-2xl font-mono text-xs"
                    inputMode="url"
                    placeholder="https://…/webhook/apichat/incoming"
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
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                <CredentialField
                  label="Client ID"
                  description="Identificador de la API nativa"
                  placeholder="Ingrese el Client ID"
                  state={apiChatConfiguration.data?.secrets.client_id}
                  pending={
                    saveApiChatSecret.isPending || verifyApiChat.isPending
                  }
                  onSave={value => persistApiChatSecret("client_id", value)}
                  onRemove={() => persistApiChatSecret("client_id", null)}
                  onVerify={() => verifyApiChat.mutate()}
                />
                <CredentialField
                  label="Token"
                  description="Credencial obligatoria de ApiChat"
                  placeholder="Ingrese el token"
                  state={apiChatConfiguration.data?.secrets.token}
                  pending={
                    saveApiChatSecret.isPending || verifyApiChat.isPending
                  }
                  onSave={value => persistApiChatSecret("token", value)}
                  onRemove={() => persistApiChatSecret("token", null)}
                  onVerify={() => verifyApiChat.mutate()}
                />
                <CredentialField
                  label="ID de cuenta"
                  description="Solo se utiliza en el modo heredado"
                  placeholder="Ingrese el ID de cuenta"
                  state={apiChatConfiguration.data?.secrets.account_id}
                  pending={
                    saveApiChatSecret.isPending || verifyApiChat.isPending
                  }
                  onSave={value => persistApiChatSecret("account_id", value)}
                  onRemove={() => persistApiChatSecret("account_id", null)}
                />
                <CredentialField
                  label="Secreto del webhook"
                  description="Mínimo 32 caracteres; compartido únicamente con el adaptador n8n"
                  placeholder="Ingrese un secreto aleatorio"
                  state={apiChatConfiguration.data?.secrets.webhook_secret}
                  pending={
                    saveApiChatSecret.isPending || verifyApiChat.isPending
                  }
                  onSave={value =>
                    persistApiChatSecret("webhook_secret", value)
                  }
                  onRemove={() =>
                    persistApiChatSecret("webhook_secret", null)
                  }
                />
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
              <CardTitle className="text-xl text-primary">
                Preferencias de comunicación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
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
                    Mensaje base
                  </Label>
                  <Textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={7}
                    className="rounded-2xl"
                  />
                  <p className="text-xs text-muted-foreground">
                    Debe conservar las variables {"{{nombre}}"} y {"{{plaza}}"}.
                    Cada plaza puede personalizar su mensaje.
                  </p>
                </div>
              </div>
              <Button
                onClick={save}
                disabled={saveSetting.isPending}
                className="rounded-full"
              >
                <Save className="mr-2 h-4 w-4" /> Guardar preferencias
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

function CredentialField({
  label,
  description,
  placeholder,
  state,
  pending,
  onSave,
  onRemove,
  onVerify,
}: {
  label: string;
  description: string;
  placeholder: string;
  state?: { configured: boolean; masked: string | null };
  pending: boolean;
  onSave: (value: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onVerify?: () => void;
}) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="font-semibold text-primary">{label}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Badge
          variant="outline"
          className={
            state?.configured
              ? "rounded-full border-emerald-300 text-emerald-700"
              : "rounded-full"
          }
        >
          {state?.configured ? "Configurada" : "Pendiente"}
        </Badge>
      </div>
      {state?.configured && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
          {state.masked}
        </p>
      )}
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={event => setValue(event.target.value)}
          className="rounded-xl pr-10 font-mono text-xs"
          autoComplete="new-password"
          placeholder={
            state?.configured ? "Ingrese una nueva para rotar" : placeholder
          }
        />
        <button
          type="button"
          className="absolute right-3 top-2.5 text-muted-foreground hover:text-primary"
          onClick={() => setVisible(current => !current)}
          aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={pending || value.trim().length < 3}
          onClick={async () => {
            if (await onSave(value.trim())) {
              setValue("");
              setVisible(false);
            }
          }}
        >
          <Save className="mr-2 h-3.5 w-3.5" /> Guardar
        </Button>
        {onVerify && state?.configured && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={onVerify}
          >
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Verificar
          </Button>
        )}
        {state?.configured && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => void onRemove()}
            aria-label={`Eliminar ${label}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
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
