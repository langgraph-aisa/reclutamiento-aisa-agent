import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CredentialField } from "@/components/CredentialField";
import { trpc } from "@/lib/trpc";
import { Cloud, Clock3, KeyRound, MailCheck, MessageCircle, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

type UserApiChatSecretKey = "client_id" | "token" | "account_id";

export default function Account() {
  const session = trpc.auth.me.useQuery();
  const user = session.data;
  const dropbox = trpc.storage.connection.useQuery();
  const unlinkDropbox = trpc.storage.unlink.useMutation({
    onSuccess: async () => {
      await dropbox.refetch();
      toast.success("Dropbox desconectado");
    },
    onError: error => toast.error(error.message),
  });
  const apiChatUser = trpc.config.apiChatUserConfiguration.useQuery();
  const saveUserApiChatSecret = trpc.config.saveApiChatUserSecret.useMutation({
    onSuccess: async () => {
      await apiChatUser.refetch();
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

  const persistUserApiChatSecret = async (
    key: UserApiChatSecretKey,
    value: string | null
  ) => {
    try {
      await saveUserApiChatSecret.mutateAsync({ key, value });
      toast.success(
        value ? "Credencial de ApiChat guardada" : "Credencial eliminada"
      );
      return true;
    } catch {
      return false;
    }
  };

  const apiChatLegacy = apiChatUser.data?.mode === "legacy";

  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("dropbox");
    if (!outcome) return;
    if (outcome === "linked")
      toast.success("Dropbox vinculado correctamente");
    else if (outcome === "unconfigured")
      toast.info(
        "Falta la credencial de plataforma de Dropbox en Configuración."
      );
    else if (outcome === "denied")
      toast.info("No autorizó el acceso a Dropbox.");
    else if (outcome === "state")
      toast.error("El estado de la autorización no es válido.");
    else if (outcome === "exchange")
      toast.error(
        "Dropbox autorizó el acceso pero rechazó el canje del código; vuelva a intentar el vínculo."
      );
    else if (outcome === "storage")
      toast.error(
        "Dropbox autorizó el acceso pero no fue posible guardar el vínculo; reintente o revise la configuración."
      );
    else if (outcome === "error")
      toast.error("No fue posible vincular Dropbox.");
    const url = new URL(window.location.href);
    url.searchParams.delete("dropbox");
    window.history.replaceState({}, "", url.toString());
  }, []);

  return (
    <div className="max-w-3xl space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Seguridad personal</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Mi cuenta</h1><p className="mt-2 text-muted-foreground">Consulte el mecanismo de acceso y los datos asociados a su sesión.</p></div>
      <Card>
        <CardHeader><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div><CardTitle className="mt-3">Acceso sin contraseña</CardTitle><CardDescription>Cada inicio de sesión requiere un código temporal enviado al correo registrado.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Info icon={MailCheck} label="Correo de acceso" value={user?.email || "Cargando…"} />
          <Info icon={KeyRound} label="Método" value="Código de un solo uso" />
          <Info icon={ShieldCheck} label="Rol" value={user?.role === "admin" ? "Administrador" : "Reclutador"} />
          <Info icon={Clock3} label="Duración de sesión" value="12 horas" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <Cloud className="h-5 w-5" />
          </div>
          <CardTitle className="mt-3">Dropbox</CardTitle>
          <CardDescription>
            Autorice su Dropbox personal para custodiar los documentos del RAG de
            los proyectos de los que es propietario. La aplicación solo accede a
            su carpeta <span className="font-medium">Aplicaciones/JARVI RH</span>{" "}
            y puede retirar el acceso cuando quiera.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-primary">Conexión de Dropbox</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {dropbox.data?.configured && dropbox.data.email
                  ? dropbox.data.email
                  : "Sin cuenta vinculada."}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                dropbox.data?.configured
                  ? "rounded-full border-emerald-300 text-emerald-700"
                  : "rounded-full"
              }
            >
              {dropbox.data?.configured ? "Configurada" : "Pendiente"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-full"
              onClick={() => {
                window.location.href = "/api/dropbox/oauth/start";
              }}
            >
              <Cloud className="mr-2 h-4 w-4" />
              {dropbox.data?.configured
                ? "Vincular otra cuenta de Dropbox"
                : "Conectar mi Dropbox"}
            </Button>
            {dropbox.data?.configured ? (
              <Button
                variant="outline"
                className="rounded-full text-destructive hover:text-destructive"
                disabled={unlinkDropbox.isPending}
                onClick={() => unlinkDropbox.mutate()}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            ) : null}
          </div>
          <p className="rounded-xl bg-accent/40 p-4 text-sm leading-6 text-muted-foreground">
            La credencial se cifra en el servidor y nunca se devuelve al
            navegador. Al desconectar, la aplicación revoca el acceso sin tocar
            los archivos de su Dropbox. Si Dropbox responde «Invalid
            redirect_uri» al autorizar, la dirección de retorno registrada no
            coincide con la de esta instalación: el administrador la corrige en
            Configuración.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
            <MessageCircle className="h-5 w-5" />
          </div>
          <CardTitle className="mt-3">ApiChat</CardTitle>
          <CardDescription>
            Guarde su propia credencial de ApiChat para que los envíos que usted
            firma —y la respuesta del agente en los proyectos que respalda—
            viajen con su identidad. Sin credencial propia completa rige la
            credencial de plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-primary">Credencial propia</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {apiChatUser.data?.credentialSource === "usuario"
                  ? "Sus envíos viajan con su credencial."
                  : apiChatUser.data?.credentialSource === "plataforma"
                    ? "Sin credencial propia completa: rige la de plataforma."
                    : "No hay credencial propia ni de plataforma: el envío no puede operar."}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                apiChatUser.data?.configured
                  ? "rounded-full border-emerald-300 text-emerald-700"
                  : "rounded-full"
              }
            >
              {apiChatUser.data?.configured ? "Propia" : "Respaldo"}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {apiChatLegacy ? (
              <CredentialField
                label="ID de cuenta"
                description="Identificador de su cuenta en el modo heredado"
                placeholder="Ingrese su ID de cuenta"
                state={apiChatUser.data?.secrets.account_id}
                pending={
                  saveUserApiChatSecret.isPending || verifyApiChat.isPending
                }
                onSave={value => persistUserApiChatSecret("account_id", value)}
                onRemove={() => persistUserApiChatSecret("account_id", null)}
                onVerify={() => verifyApiChat.mutate({ scope: "usuario" })}
              />
            ) : (
              <CredentialField
                label="Client ID"
                description="Identificador de su cuenta en la API nativa"
                placeholder="Ingrese su Client ID"
                state={apiChatUser.data?.secrets.client_id}
                pending={
                  saveUserApiChatSecret.isPending || verifyApiChat.isPending
                }
                onSave={value => persistUserApiChatSecret("client_id", value)}
                onRemove={() => persistUserApiChatSecret("client_id", null)}
                onVerify={() => verifyApiChat.mutate({ scope: "usuario" })}
              />
            )}
            <CredentialField
              label="Token"
              description="Credencial obligatoria de ApiChat"
              placeholder="Ingrese su token"
              state={apiChatUser.data?.secrets.token}
              pending={
                saveUserApiChatSecret.isPending || verifyApiChat.isPending
              }
              onSave={value => persistUserApiChatSecret("token", value)}
              onRemove={() => persistUserApiChatSecret("token", null)}
              onVerify={() => verifyApiChat.mutate({ scope: "usuario" })}
            />
          </div>
          <p className="rounded-xl bg-accent/40 p-4 text-sm leading-6 text-muted-foreground">
            La credencial se cifra en el servidor y nunca se devuelve al
            navegador. La recepción de mensajes y el webhook se rigen por la
            credencial de plataforma, que la administración mantiene en
            Auditoría de ApiChat.
          </p>
        </CardContent>
      </Card>
      <p className="rounded-xl bg-accent/40 p-4 text-sm leading-6 text-muted-foreground">Los códigos expiran en 10 minutos, admiten un máximo de cinco intentos y se invalidan inmediatamente después de utilizarse.</p>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return <div className="rounded-xl border border-border/70 p-4"><Icon className="h-4 w-4 text-primary" /><p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
