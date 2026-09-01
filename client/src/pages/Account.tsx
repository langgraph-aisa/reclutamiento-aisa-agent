import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Clock3, KeyRound, MailCheck, ShieldCheck } from "lucide-react";

export default function Account() {
  const session = trpc.auth.me.useQuery();
  const user = session.data;
  return (
    <div className="max-w-3xl space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Seguridad personal</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Mi cuenta</h1><p className="mt-2 text-muted-foreground">Consulta el mecanismo de acceso y los datos asociados a tu sesión.</p></div>
      <Card>
        <CardHeader><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div><CardTitle className="mt-3">Acceso sin contraseña</CardTitle><CardDescription>Cada inicio de sesión requiere un código temporal enviado al correo registrado.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Info icon={MailCheck} label="Correo de acceso" value={user?.email || "Cargando…"} />
          <Info icon={KeyRound} label="Método" value="Código de un solo uso" />
          <Info icon={ShieldCheck} label="Rol" value={user?.role === "admin" ? "Administrador" : "Reclutador"} />
          <Info icon={Clock3} label="Duración de sesión" value="12 horas" />
        </CardContent>
      </Card>
      <p className="rounded-xl bg-accent/40 p-4 text-sm leading-6 text-muted-foreground">Los códigos expiran en 10 minutos, admiten un máximo de cinco intentos y se invalidan inmediatamente después de utilizarse.</p>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return <div className="rounded-xl border border-border/70 p-4"><Icon className="h-4 w-4 text-primary" /><p className="mt-3 text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
