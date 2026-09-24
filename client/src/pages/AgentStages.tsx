import { Badge } from "@/components/ui/badge";
import { AutomaticEvaluationPanel } from "@/components/AutomaticEvaluationPanel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CalendarDays, GripVertical, Save } from "lucide-react";
import { type DragEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import type { AgentStageKey } from "../../../server/agentStages";

type StageView = {
  key: AgentStageKey;
  order: number;
  name: string;
  description: string;
  messageKeys: string[];
  enabled: boolean;
};

const MESSAGE_LABELS: Record<string, string> = {
  bienvenida_formulario: "Mensaje de bienvenida",
  solicitud_cv: "Mensaje de solicitud de CV",
  confirmacion_cv: "Mensaje de confirmación de recepción",
  pregunta_salario: "Pregunta de expectativa salarial",
  confirmacion_salario: "Confirmación del registro",
  aviso_contacto: "Aviso de contacto",
};

export default function AgentStages() {
  const configuration = trpc.agentStages.configuration.useQuery();
  const save = trpc.agentStages.save.useMutation({
    onSuccess: async () => {
      toast.success("Etapas del agente actualizadas.");
      await configuration.refetch();
    },
    onError: error => toast.error(error.message),
  });

  // La evaluación automática y el comportamiento del agente son modos
  // excluyentes: con el ciclo automático activo, el flujo de etapas queda
  // bloqueado y deshabilitado de forma automática.
  const automationStatus = trpc.evaluationAutomation.status.useQuery(
    undefined,
    {
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
      retry: false,
    }
  );
  const flowBlocked =
    (automationStatus.data?.state ?? "apagado") !== "apagado";

  // Cuando la evaluación automática toma el control, el flujo queda apagado y
  // las nueve etapas deshabilitadas en la interfaz.
  useEffect(() => {
    if (!flowBlocked) return;
    setFlowEnabled(false);
    setEnabled(current =>
      Object.fromEntries(Object.keys(current).map(key => [key, false]))
    );
    configuration.refetch();
  }, [flowBlocked, configuration]);

  const [flowEnabled, setFlowEnabled] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [order, setOrder] = useState<AgentStageKey[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({
    bienvenida_formulario: "",
    solicitud_cv: "",
    confirmacion_cv: "",
    pregunta_salario: "",
    confirmacion_salario: "",
    aviso_contacto: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [draggingKey, setDraggingKey] = useState<AgentStageKey | null>(null);

  useEffect(() => {
    if (loaded || !configuration.data) return;
    setFlowEnabled(configuration.data.flowEnabled);
    setEnabled({ ...configuration.data.enabled });
    setOrder(
      configuration.data.order?.length
        ? [...configuration.data.order]
        : (configuration.data.stages as StageView[]).map(stage => stage.key)
    );
    setMessages({
      bienvenida_formulario:
        configuration.data.messages.bienvenida_formulario,
      solicitud_cv: configuration.data.messages.solicitud_cv,
      confirmacion_cv: configuration.data.messages.confirmacion_cv,
      pregunta_salario: configuration.data.messages.pregunta_salario,
      confirmacion_salario: configuration.data.messages.confirmacion_salario,
      aviso_contacto: configuration.data.messages.aviso_contacto,
    });
    setLoaded(true);
  }, [configuration.data, loaded]);

  const moveStage = (sourceKey: AgentStageKey, targetKey: AgentStageKey) => {
    if (!sourceKey || sourceKey === targetKey) return;
    setOrder(current => {
      const next = [...current];
      const from = next.indexOf(sourceKey);
      const to = next.indexOf(targetKey);
      if (from < 0 || to < 0) return current;
      next.splice(from, 1);
      next.splice(to, 0, sourceKey);
      return next;
    });
  };

  const handleDragStart =
    (key: AgentStageKey) => (event: DragEvent<HTMLLIElement>) => {
      setDraggingKey(key);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
    };

  const handleDragOver = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop =
    (targetKey: AgentStageKey) => (event: DragEvent<HTMLLIElement>) => {
      event.preventDefault();
      if (draggingKey) moveStage(draggingKey, targetKey);
    };

  const submit = () => {
    save.mutate({
      flowEnabled,
      enabled,
      order,
      messages: {
        bienvenida_formulario: messages.bienvenida_formulario,
        solicitud_cv: messages.solicitud_cv,
        confirmacion_cv: messages.confirmacion_cv,
        pregunta_salario: messages.pregunta_salario,
        confirmacion_salario: messages.confirmacion_salario,
        aviso_contacto: messages.aviso_contacto,
      },
    });
  };

  if (configuration.isLoading) {
    return (
      <div className="max-w-3xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Cargando etapas del agente…
        </p>
      </div>
    );
  }

  const stages = (configuration.data?.stages ?? []) as StageView[];
  const stageByKey = new Map(stages.map(stage => [stage.key, stage]));
  const ordered = order.length
    ? order
        .map(key => stageByKey.get(key))
        .filter((stage): stage is StageView => Boolean(stage))
    : stages;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            Comportamiento del agente
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Etapas de la IA
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            El ciclo completo del agente conversacional, en su orden de
            ejecución. Arrastre una etapa para reordenarla, active o apague cada
            etapa y ajuste los mensajes que emite de forma directa.
          </p>
        </div>

        <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-xl text-primary">
                Ciclo exacto del agente
              </CardTitle>
              <CardDescription>
                Arrastre una etapa para reacomodar el ciclo; el interruptor
                gobierna su ejecución.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  flowBlocked
                    ? "rounded-full border-slate-300 text-slate-700"
                    : flowEnabled
                      ? "rounded-full border-emerald-300 text-emerald-700"
                      : "rounded-full"
                }
              >
                {flowBlocked
                  ? "Bloqueado"
                  : flowEnabled
                    ? "Comportamiento activo"
                    : "Comportamiento apagado"}
              </Badge>
              <Switch
                checked={flowEnabled && !flowBlocked}
                disabled={flowBlocked || save.isPending}
                onCheckedChange={value => setFlowEnabled(value)}
                aria-label="Comportamiento del agente"
              />
            </div>
          </div>
          {flowBlocked ? (
            <p className="text-sm leading-6 text-muted-foreground">
              La evaluación automática está activa: el flujo de etapas quedó
              deshabilitado de forma automática y todas sus etapas están
              bloqueadas. Apague la evaluación automática para devolver el
              control al ciclo exacto del agente.
            </p>
          ) : !flowEnabled ? (
            <p className="text-sm leading-6 text-muted-foreground">
              El comportamiento del agente está apagado: no ejecuta ninguna
              acción del ciclo —ni bienvenida, ni preguntas, ni solicitud de CV,
              ni cierre—. Puede editar las etapas y los mensajes mientras tanto.
            </p>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              Encendido, el agente determinista ejecuta exactamente el paso 1,
              luego el 2, el 3, el 4, el 5, el 6, el 7, el 8 y termina con el 9:
              no puede hacer nada más que estas nueve etapas.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <ol className="space-y-0">
            {ordered.map((stage, index) => (
              <li
                key={stage.key}
                className="relative"
                draggable
                onDragStart={handleDragStart(stage.key)}
                onDragOver={handleDragOver}
                onDrop={handleDrop(stage.key)}
                onDragEnd={() => setDraggingKey(null)}
              >
                {index < ordered.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[1.25rem] top-10 h-[calc(100%-1.5rem)] w-px bg-border"
                  />
                )}
                <div
                  className={`relative flex gap-4 pb-5 ${
                    draggingKey === stage.key ? "opacity-60" : ""
                  }`}
                >
                  <div
                    className={`z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      stage.enabled
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div className="flex-1 cursor-grab space-y-3 rounded-2xl border border-border/70 bg-card p-4 active:cursor-grabbing">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <GripVertical
                          aria-hidden
                          className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                        />
                        <div>
                          <p className="font-semibold leading-tight">
                            {stage.name}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {stage.description}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            stage.enabled
                              ? "rounded-full border-emerald-300 text-emerald-700"
                              : "rounded-full"
                          }
                        >
                          {stage.enabled ? "Habilitada" : "Deshabilitada"}
                        </Badge>
                        <Switch
                          checked={stage.enabled && !flowBlocked}
                          disabled={flowBlocked}
                          onCheckedChange={value =>
                            setEnabled(current => ({
                              ...current,
                              [stage.key]: value,
                            }))
                          }
                          aria-label={`Alternar la etapa ${stage.name}`}
                        />
                      </div>
                    </div>
                    {stage.messageKeys.length > 0 && (
                      <div className="space-y-3 border-t border-border/60 pt-3">
                        {stage.messageKeys.map(messageKey => (
                          <div key={messageKey} className="space-y-1.5">
                            <Label className="text-sm font-semibold text-primary">
                              {MESSAGE_LABELS[messageKey] ?? messageKey}
                            </Label>
                            <Textarea
                              value={messages[messageKey] ?? ""}
                              onChange={event =>
                                setMessages(current => ({
                                  ...current,
                                  [messageKey]: event.target.value,
                                }))
                              }
                              rows={2}
                              className="rounded-xl"
                            />
                            <p className="text-xs text-muted-foreground">
                              Admite las variables {"{{nombre}}"}, {"{{plaza}}"}{" "}
                              y {"{{monto}}"}.
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button
          onClick={submit}
          disabled={save.isPending}
          className="rounded-full"
        >
          <Save className="mr-2 h-4 w-4" /> Guardar cambios
        </Button>
        <p className="text-sm text-muted-foreground">
          Las etapas guardadas se aplican al siguiente turno del agente.
        </p>
      </div>
      </div>
      <div className="space-y-4 lg:sticky lg:top-20">
        <AutomaticEvaluationPanel />
      </div>
    </div>
  );
}
