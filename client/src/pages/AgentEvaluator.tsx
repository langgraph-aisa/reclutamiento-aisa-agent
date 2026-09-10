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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AGENT_MODELS,
  DEFAULT_AGENT_SETTINGS,
  EVALUATION_BLOCKS,
  SCORE_BANDS,
  type AgentPreferences,
} from "@shared/agentConfig";
import {
  Activity,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  RotateCcw,
  Save,
  ShieldCheck,
  Telescope,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SecretKey =
  | "openai_api_key"
  | "openai_api_key_backup"
  | "langfuse_public_key"
  | "langfuse_secret_key";

export default function AgentEvaluator() {
  const configuration = trpc.agent.configuration.useQuery();
  const [preferences, setPreferences] = useState<AgentPreferences>(
    DEFAULT_AGENT_SETTINGS
  );
  const savePreferences = trpc.agent.savePreferences.useMutation({
    onSuccess: async () => {
      await configuration.refetch();
      toast.success("Configuración del agente guardada");
    },
    onError: error => toast.error(error.message),
  });
  const saveSecret = trpc.agent.saveSecret.useMutation({
    onSuccess: async () => {
      await configuration.refetch();
    },
    onError: error => toast.error(error.message),
  });
  const verifyOpenAI = trpc.agent.verifyOpenAI.useMutation({
    onSuccess: result =>
      toast.success(`Conexión verificada con ${result.model}`),
    onError: error => toast.error(error.message),
  });
  const verifyLangfuse = trpc.agent.verifyLangfuse.useMutation({
    onSuccess: result =>
      toast.success(
        `Langfuse verificado · ${result.projects} proyecto${result.projects === 1 ? "" : "s"}`
      ),
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!configuration.data) return;
    setPreferences({
      model: configuration.data.model,
      instructions: configuration.data.instructions,
      summaryWordLimit: configuration.data.summaryWordLimit,
      useMethodologies: configuration.data.useMethodologies,
      useResponsesApi: configuration.data.useResponsesApi,
      methodologyInterpretation: configuration.data.methodologyInterpretation,
      langfuseBaseUrl: configuration.data.langfuseBaseUrl,
      langfuseEnvironment: configuration.data.langfuseEnvironment,
    });
  }, [configuration.data]);

  const persistSecret = async (key: SecretKey, value: string | null) => {
    try {
      await saveSecret.mutateAsync({ key, value });
      toast.success(
        value ? "Credencial protegida y guardada" : "Credencial eliminada"
      );
      return true;
    } catch {
      return false;
    }
  };
  const ready = Boolean(
    preferences.useResponsesApi &&
      (configuration.data?.secrets.openai_api_key.configured ||
        configuration.data?.secrets.openai_api_key_backup.configured)
  );

  return (
    <div className="mx-auto max-w-7xl space-y-7 pb-12">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
              Inteligencia operativa
            </p>
          </div>
          <h1 className="mt-3 text-4xl font-800 tracking-[-.04em] text-primary">
            Agente de IA LangGraph
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Gobierno, metodología y observabilidad de la evaluación automática
            de postulaciones.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge
            className={
              ready
                ? "rounded-full bg-emerald-100 px-4 py-2 text-emerald-800 hover:bg-emerald-100"
                : "rounded-full bg-amber-100 px-4 py-2 text-amber-900 hover:bg-amber-100"
            }
          >
            <Activity className="mr-2 h-4 w-4" />
            {ready ? "Agente habilitado" : "Configuración pendiente"}
          </Badge>
          <Button
            className="rounded-full"
            disabled={savePreferences.isPending || configuration.isLoading}
            onClick={() => savePreferences.mutate(preferences)}
          >
            <Save className="mr-2 h-4 w-4" />
            Guardar configuración
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.12fr_.88fr]">
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader>
            <SectionTitle
              icon={KeyRound}
              title="OpenAI y rotación de credenciales"
              description="Máximo de dos API keys. El servidor intenta la principal y sustituye por el respaldo si la llamada falla."
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label className="font-semibold text-primary">
                Modelo de evaluación
              </Label>
              <Select
                value={preferences.model}
                onValueChange={model =>
                  setPreferences(current => ({
                    ...current,
                    model: model as AgentPreferences["model"],
                  }))
                }
              >
                <SelectTrigger className="rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_MODELS.map(model => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">
                La verificación confirma que la credencial tiene acceso al
                modelo seleccionado.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <SecretField
                label="API Key"
                description="Credencial principal"
                placeholder="sk-proj-…"
                state={configuration.data?.secrets.openai_api_key}
                pending={saveSecret.isPending || verifyOpenAI.isPending}
                onSave={value => persistSecret("openai_api_key", value)}
                onRemove={() => persistSecret("openai_api_key", null)}
                onVerify={() => verifyOpenAI.mutate({ slot: "primary" })}
              />
              <SecretField
                label="API Key Back Up"
                description="Credencial de continuidad"
                placeholder="sk-proj-…"
                state={configuration.data?.secrets.openai_api_key_backup}
                pending={saveSecret.isPending || verifyOpenAI.isPending}
                onSave={value => persistSecret("openai_api_key_backup", value)}
                onRemove={() => persistSecret("openai_api_key_backup", null)}
                onVerify={() => verifyOpenAI.mutate({ slot: "backup" })}
              />
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm leading-6 text-emerald-950">
              Las claves se cifran en el servidor y nunca se devuelven al
              navegador. Los valores visibles son únicamente máscaras de
              confirmación.
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader>
            <SectionTitle
              icon={Workflow}
              title="Motor y referencias"
              description="Controles explícitos para habilitar el agente y sus fuentes metodológicas."
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <ControlSwitch
              icon={ShieldCheck}
              title="Usar SIERA y MST-EIR"
              description="Incorpora los documentos institucionales vigentes como método de referencia."
              checked={preferences.useMethodologies}
              onCheckedChange={checked =>
                setPreferences(current => ({
                  ...current,
                  useMethodologies: checked,
                }))
              }
            />
            <ControlSwitch
              icon={Workflow}
              title="Habilitar OpenAI Responses API"
              description="Ejecuta salida estructurada mediante LangChain y un flujo controlado de LangGraph."
              checked={preferences.useResponsesApi}
              onCheckedChange={checked =>
                setPreferences(current => ({
                  ...current,
                  useResponsesApi: checked,
                }))
              }
            />
            <div className="rounded-2xl bg-muted/55 p-4 text-sm leading-6 text-muted-foreground">
              Los descartes deterministas se evalúan antes de la IA. Una causa
              crítica configurada prevalece sobre cualquier promedio y el resto
              de decisiones permanece sujeto a auditoría humana.
            </div>
            {configuration.data?.updatedAt ? (
              <p className="text-xs text-muted-foreground">
                Último mantenimiento:{" "}
                {new Date(configuration.data.updatedAt).toLocaleString("es-GT")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader>
          <SectionTitle
            icon={Telescope}
            title="Instrucciones de evaluación del agente"
            description="Directriz editable que gobierna el análisis, la evidencia y el dictamen."
          />
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_210px]">
            <div className="space-y-2">
              <Label className="font-semibold text-primary">
                Instrucciones de evaluación
              </Label>
              <Textarea
                rows={14}
                value={preferences.instructions}
                onChange={event =>
                  setPreferences(current => ({
                    ...current,
                    instructions: event.target.value,
                  }))
                }
                className="rounded-2xl leading-6"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-primary">
                Máximo de palabras del resumen
              </Label>
              <Input
                type="number"
                min={50}
                max={1000}
                value={preferences.summaryWordLimit}
                onChange={event =>
                  setPreferences(current => ({
                    ...current,
                    summaryWordLimit: Number(event.target.value),
                  }))
                }
                className="rounded-2xl"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Rango admitido: 50 a 1,000 palabras. El servidor aplica el
                límite al resultado final.
              </p>
              <Button
                variant="outline"
                className="mt-3 w-full rounded-full"
                onClick={() =>
                  setPreferences(current => ({
                    ...current,
                    instructions: DEFAULT_AGENT_SETTINGS.instructions,
                  }))
                }
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Restaurar directriz
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/70">
            <div className="grid grid-cols-[1fr_90px] bg-primary px-4 py-3 dark:bg-neutral-950 text-xs font-semibold uppercase tracking-wider text-white sm:grid-cols-[1.1fr_100px_1.8fr]">
              <span>Bloque de evaluación</span>
              <span>Peso</span>
              <span className="hidden sm:block">Función</span>
            </div>
            {EVALUATION_BLOCKS.map(block => (
              <div
                key={block.id}
                className="grid grid-cols-[1fr_90px] gap-2 border-t border-border/60 px-4 py-3 text-sm sm:grid-cols-[1.1fr_100px_1.8fr]"
              >
                <span className="font-semibold text-primary">
                  {block.label}
                </span>
                <span className="font-semibold text-emerald-700">
                  {block.weight} %
                </span>
                <span className="hidden text-muted-foreground sm:block">
                  {block.purpose}
                </span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_90px] border-t border-border bg-muted/60 px-4 py-3 text-sm font-bold text-primary sm:grid-cols-[1.1fr_100px_1.8fr]">
              <span>Total</span>
              <span>100 %</span>
              <span className="hidden sm:block">Puntuación ponderada</span>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              className="rounded-full"
              disabled={savePreferences.isPending}
              onClick={() => savePreferences.mutate(preferences)}
            >
              <Save className="mr-2 h-4 w-4" />
              Guardar instrucciones y metodología
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader>
            <CardTitle className="text-xl text-primary">
              Interpretación metodológica editable
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Contexto académico aplicado junto con la directriz principal.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              rows={16}
              value={preferences.methodologyInterpretation}
              onChange={event =>
                setPreferences(current => ({
                  ...current,
                  methodologyInterpretation: event.target.value,
                }))
              }
              className="rounded-2xl leading-6"
            />
            <div className="flex flex-wrap gap-2">
              {SCORE_BANDS.map(band => (
                <Badge
                  key={band.min}
                  variant="outline"
                  className="rounded-full"
                >
                  {band.min}–{band.max} · {band.label}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader>
            <SectionTitle
              icon={Telescope}
              title="Observabilidad Langfuse"
              description="Credenciales de mantenimiento, trazabilidad técnica y monitoreo del agente."
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <SecretField
              label="LANGFUSE_PUBLIC_KEY"
              description="Identificador público del proyecto"
              placeholder="pk-lf-…"
              state={configuration.data?.secrets.langfuse_public_key}
              pending={saveSecret.isPending}
              onSave={value => persistSecret("langfuse_public_key", value)}
              onRemove={() => persistSecret("langfuse_public_key", null)}
            />
            <SecretField
              label="LANGFUSE_SECRET_KEY"
              description="Credencial secreta del proyecto"
              placeholder="sk-lf-…"
              state={configuration.data?.secrets.langfuse_secret_key}
              pending={saveSecret.isPending}
              onSave={value => persistSecret("langfuse_secret_key", value)}
              onRemove={() => persistSecret("langfuse_secret_key", null)}
            />
            <div className="space-y-2">
              <Label className="font-semibold text-primary">
                LANGFUSE_BASE_URL
              </Label>
              <Input
                value={preferences.langfuseBaseUrl}
                onChange={event =>
                  setPreferences(current => ({
                    ...current,
                    langfuseBaseUrl: event.target.value,
                  }))
                }
                className="rounded-2xl font-mono text-xs"
                placeholder="https://cloud.langfuse.com"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-primary">
                LANGFUSE_TRACING_ENVIRONMENT
              </Label>
              <Input
                value={preferences.langfuseEnvironment}
                onChange={event =>
                  setPreferences(current => ({
                    ...current,
                    langfuseEnvironment: event.target.value,
                  }))
                }
                className="rounded-2xl font-mono text-xs"
                placeholder="production"
              />
              <p className="text-xs text-muted-foreground">
                Separa las trazas por ambiente, por ejemplo: production, staging
                o development.
              </p>
            </div>
            <Button
              className="w-full rounded-full"
              disabled={savePreferences.isPending || configuration.isLoading}
              onClick={() => savePreferences.mutate(preferences)}
            >
              <Save className="mr-2 h-4 w-4" />
              Guardar configuración Langfuse
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-full"
              disabled={verifyLangfuse.isPending}
              onClick={() => verifyLangfuse.mutate()}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Verificar conexión Langfuse
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              La traza omite nombre, teléfono, correo y respuestas del
              candidato; registra solamente identificador técnico, modelo,
              resultado y estado.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof KeyRound;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <CardTitle className="text-xl text-primary">{title}</CardTitle>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function ControlSwitch({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-border/70 p-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <Label className="font-semibold text-primary">{title}</Label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </div>
  );
}

function SecretField({
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
    <div className="space-y-3 rounded-2xl border border-border/70 p-4">
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
      {state?.configured ? (
        <p className="rounded-xl bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground">
          {state.masked}
        </p>
      ) : null}
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          value={value}
          onChange={event => setValue(event.target.value)}
          className="rounded-xl pr-10 font-mono text-xs"
          autoComplete="new-password"
          placeholder={
            state?.configured ? "Ingresar una nueva para rotar" : placeholder
          }
        />
        <button
          type="button"
          className="absolute right-3 top-2.5 text-muted-foreground hover:text-primary"
          onClick={() => setVisible(current => !current)}
          aria-label={visible ? "Ocultar credencial" : "Mostrar credencial"}
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
          disabled={pending || value.trim().length < 8}
          onClick={async () => {
            if (await onSave(value.trim())) {
              setValue("");
              setVisible(false);
            }
          }}
        >
          <Save className="mr-2 h-3.5 w-3.5" /> Guardar
        </Button>
        {onVerify && state?.configured ? (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={pending}
            onClick={onVerify}
          >
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Verificar
          </Button>
        ) : null}
        {state?.configured ? (
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
        ) : null}
      </div>
    </div>
  );
}
