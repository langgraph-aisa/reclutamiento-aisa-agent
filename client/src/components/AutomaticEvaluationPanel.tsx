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
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Bot, Clock3, ListChecks, Timer } from "lucide-react";
import { useState } from "react";

/**
 * Panel del ciclo de evaluación automática.
 *
 * Muestra el estado declarado del interruptor, el instante de la última
 * evaluación completada y los dos contadores del ciclo. Los contadores son
 * **derivados**: los mueve cualquier camino de evaluación —el evento, la
 * revisión humana o el propio ciclo—, de modo que el número visible no puede
 * discrepar del estado real. No son un informe del trabajador sobre sí mismo:
 * son una manifestación de la postulación.
 *
 * Encender y apagar exigen un código que viaja por correo: es un acto de
 * consecuencia institucional y no debe depender de un clic accidental.
 */
const STATE_LABELS: Record<string, string> = {
  encendido: "Encendido",
  deteniendose: "Deteniéndose",
  apagado: "Apagado",
};

const STATE_CLASSES: Record<string, string> = {
  encendido: "border-emerald-300 bg-emerald-100 text-emerald-900",
  deteniendose: "border-amber-300 bg-amber-100 text-amber-950",
  apagado: "border-slate-300 bg-slate-100 text-slate-700",
};

function formatMoment(value: string | Date | null | undefined) {
  if (!value) return "Sin evaluación registrada";
  return new Date(value).toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
  });
}

export function AutomaticEvaluationPanel() {
  const status = trpc.evaluationAutomation.status.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const [challenge, setChallenge] = useState<{
    targetState: "encendido" | "apagado";
    emailMask: string;
    expiresInMinutes: number;
  } | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = trpc.evaluationAutomation.requestCode.useMutation({
    onSuccess: (result, variables) => {
      setNotice(null);
      setCode("");
      setChallenge({
        targetState: variables.targetState,
        emailMask: result.emailMask,
        expiresInMinutes: result.expiresInMinutes,
      });
    },
    onError: error => setNotice(error.message),
  });
  const confirm = trpc.evaluationAutomation.confirm.useMutation({
    onSuccess: result => {
      if (!result.applied) {
        setNotice(
          result.reason === "codigo_invalido"
            ? "El código no corresponde al desafío vigente."
            : result.reason === "expirado"
              ? "El código caducó. Solicite uno nuevo."
              : result.reason === "agotado"
                ? "El desafío agotó sus intentos. Solicite uno nuevo."
                : "No hay un desafío vigente. Solicite el código."
        );
        return;
      }
      setChallenge(null);
      setCode("");
      setNotice(
        result.target === "apagado"
          ? "Apagado autorizado: el ciclo se detendrá al terminar la evaluación en curso."
          : "Encendido autorizado: el ciclo toma la postulación más antigua sin evaluar."
      );
      status.refetch();
    },
    onError: error => setNotice(error.message),
  });

  if (!status.data) return null;
  const state = status.data.state;
  const counters = status.data.counters;
  const pending = Number(counters?.pending ?? 0);
  const blocked = Number(counters?.blocked ?? 0);

  return (
    <section
      aria-label="Ciclo de evaluación automática"
      className="mt-2 space-y-2 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/35 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-sidebar-foreground/85">
          <Bot className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Evaluación Automática (IA)</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2">
          <Badge
            variant="outline"
            className={`rounded-full text-[10px] ${STATE_CLASSES[state] ?? STATE_CLASSES.apagado}`}
          >
            {STATE_LABELS[state] ?? state}
          </Badge>
          <Switch
            aria-label="Interruptor del ciclo de evaluación automática"
            checked={state !== "apagado"}
            disabled={requestCode.isPending || confirm.isPending}
            onCheckedChange={next =>
              requestCode.mutate({
                targetState: next ? "encendido" : "apagado",
              })
            }
          />
        </span>
      </div>

      <p className="inline-flex items-center gap-1.5 text-[10px] text-sidebar-foreground/70">
        <Clock3 className="size-3 shrink-0" aria-hidden="true" />
        Última realizada: {formatMoment(counters?.lastEvaluationAt)}
      </p>
      <p className="inline-flex items-center gap-1.5 text-[10px] text-sidebar-foreground/70">
        <ListChecks className="size-3 shrink-0" aria-hidden="true" />
        {Number(counters?.processed ?? 0)} procesadas desde el inicio
      </p>
      <p className="inline-flex items-center gap-1.5 text-[10px] text-sidebar-foreground/70">
        <Timer className="size-3 shrink-0" aria-hidden="true" />
        {pending} pendientes en cola
        {blocked > 0 ? ` · ${blocked} no evaluable(s)` : ""}
      </p>
      {state === "deteniendose" ? (
        <p className="text-[10px] leading-4 text-amber-900">
          Apagado autorizado. El ciclo termina la evaluación en curso y se
          detiene: no se corta ningún proceso a la mitad.
        </p>
      ) : null}
      {notice ? (
        <p className="text-[10px] leading-4 text-sidebar-foreground/80">
          {notice}
        </p>
      ) : null}

      <Dialog
        open={Boolean(challenge)}
        onOpenChange={open => {
          if (!open) {
            setChallenge(null);
            setCode("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {challenge?.targetState === "apagado"
                ? "Confirmar el apagado del ciclo"
                : "Confirmar el encendido del ciclo"}
            </DialogTitle>
            <DialogDescription>
              El código se envió a {challenge?.emailMask} y expira en{" "}
              {challenge?.expiresInMinutes} minutos. No se muestra en pantalla
              ni viaja por este medio: solo por correo.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={code}
            onChange={event =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            placeholder="Código de seis dígitos"
            aria-label="Código de confirmación"
          />
          {challenge?.targetState === "apagado" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              El apagado se consuma al terminar la evaluación en curso. Hasta
              entonces el ciclo sigue trabajando y la cola conserva sus
              pendientes.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setChallenge(null);
                setCode("");
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={code.length !== 6 || confirm.isPending}
              onClick={() => confirm.mutate({ code })}
            >
              {confirm.isPending ? "Confirmando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
