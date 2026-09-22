import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Cloud, Clock3, KeyRound, MailCheck, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

export default function Account() {
  const session = trpc.auth.me.useQuery();
  const drive = trpc.drive.connection.useQuery();
  const unlinkDrive = trpc.drive.unlink.useMutation({
    onSuccess: async () => {
      await drive.refetch();
      toast.success("Google Drive desconectado");
    },
    onError: error => toast.error(error.message),
  });
  const user = session.data;

  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get("drive");
    if (!outcome) return;
    if (outcome === "linked")
      toast.success("Google Drive vinculado correctamente");
    else if (outcome === "unconfigured")
      toast.info(
        "Falta la credencial de plataforma de Google Drive en Configuración."
      );
    else if (outcome === "denied")
      toast.info("No autorizó el acceso a Google Drive.");
    else if (outcome === "state")
      toast.error("El estado de la autorización no es válido.");
    else if (outcome === "error")
      toast.error("No fue posible vincular Google Drive.");
    const url = new URL(window.location.href);
    url.searchParams.delete("drive");
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
          <CardTitle className="mt-3">Google Drive</CardTitle>
          <CardDescription>
            Autorice su Drive personal para custodiar los documentos del RAG de
            los proyectos de los que es propietario. El acceso se limita a los
            archivos que usted elija y puede retirarlo cuando quiera.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 p-4">
            <div className="min-w-0">
              <p className="font-semibold text-primary">Conexión de Drive</p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {drive.data?.configured && drive.data.email
                  ? drive.data.email
                  : "Sin cuenta vinculada."}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                drive.data?.configured
                  ? "rounded-full border-emerald-300 text-emerald-700"
                  : "rounded-full"
              }
            >
              {drive.data?.configured ? "Configurada" : "Pendiente"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-full"
              onClick={() => {
                window.location.href = "/api/drive/oauth/start";
              }}
            >
              <Cloud className="mr-2 h-4 w-4" />
              {drive.data?.configured
                ? "Vincular otra cuenta de Drive"
                : "Conectar mi Drive"}
            </Button>
            {drive.data?.configured ? (
              <Button
                variant="outline"
                className="rounded-full text-destructive hover:text-destructive"
                disabled={unlinkDrive.isPending}
                onClick={() => unlinkDrive.mutate()}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            ) : null}
          </div>
          <p className="rounded-xl bg-accent/40 p-4 text-sm leading-6 text-muted-foreground">
            La credencial se cifra en el servidor y nunca se devuelve al
            navegador. Al desconectar, la aplicación revoca el acceso sin tocar
            los archivos de su Drive.
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
