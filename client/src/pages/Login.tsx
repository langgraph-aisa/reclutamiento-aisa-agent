import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowRight, KeyRound, MailCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("adminit@aisa.com.gt");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");

  const requestCode = trpc.auth.requestLoginCode.useMutation({
    onSuccess: result => {
      setStep("code");
      toast.success(`Código enviado a ${result.email}`);
    },
    onError: error => toast.error(error.message),
  });
  const verifyCode = trpc.auth.verifyLoginCode.useMutation({
    onSuccess: () => {
      toast.success("Acceso verificado");
      setLocation("/admin");
    },
    onError: error => toast.error(error.message),
  });

  const request = () => requestCode.mutate({ email });

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl items-center gap-10 lg:grid-cols-[1fr_440px]">
        <section className="hidden lg:block">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Talento Claro · acceso seguro</p>
          <h1 className="max-w-xl text-5xl font-semibold tracking-[-0.05em] text-foreground">Configura evaluaciones laborales con trazabilidad.</h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">El panel centraliza plazas, formularios, perfiles, candidatos y decisiones de evaluación en un espacio protegido.</p>
          <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 text-primary" />Cada ingreso se confirma con un código temporal enviado al correo registrado.</div>
        </section>
        <Card className="border-border/70 shadow-xl shadow-primary/5">
          <CardHeader className="space-y-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">{step === "email" ? <MailCheck className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}</div>
            <CardTitle className="text-2xl">{step === "email" ? "Solicitar código de acceso" : "Verificar código"}</CardTitle>
            <CardDescription>{step === "email" ? "Ingresa el correo asociado a tu cuenta activa." : "Escribe el código de seis dígitos enviado por correo. Expira en 10 minutos."}</CardDescription>
          </CardHeader>
          <CardContent>
            {step === "email" ? (
              <form className="space-y-5" onSubmit={event => { event.preventDefault(); request(); }}>
                <div className="space-y-2"><Label htmlFor="email">Correo electrónico</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
                <Button className="w-full" type="submit" disabled={requestCode.isPending}>{requestCode.isPending ? "Enviando…" : "Enviar código"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </form>
            ) : (
              <form className="space-y-5" onSubmit={event => { event.preventDefault(); verifyCode.mutate({ email, code }); }}>
                <div className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">Código enviado a <strong className="text-foreground">{email}</strong></div>
                <div className="space-y-2"><Label htmlFor="code">Código de acceso</Label><Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" className="text-center text-2xl tracking-[0.35em]" required /></div>
                <Button className="w-full" type="submit" disabled={verifyCode.isPending || code.length !== 6}>{verifyCode.isPending ? "Verificando…" : "Ingresar"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
                <Button type="button" variant="outline" className="w-full" disabled={requestCode.isPending} onClick={request}>{requestCode.isPending ? "Reenviando…" : "Reenviar código"}</Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => { setStep("email"); setCode(""); }}><ArrowLeft className="mr-2 h-4 w-4" />Cambiar correo</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
