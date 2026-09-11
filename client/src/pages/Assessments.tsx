import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ASSESSMENT_LEVELS, ASSESSMENT_METHODOLOGY_NOTICE } from "@shared/assessmentGovernance";
import { ArrowDown, ArrowUp, BrainCircuit, CheckCircle2, Plus, Save, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ProtocolForm = {
  id?: number;
  jobPositionId: number;
  name: string;
  level: "nivel" | "basica" | "tecnica" | "avanzada";
  assessmentType: "competencias" | "conocimiento" | "psicometrica_validada";
  executionMode: "esperar_respuesta" | "evaluacion_inmediata";
  greeting: string;
  farewell: string;
  methodology: string;
  validationEvidence: string;
};

type ItemForm = {
  id?: number;
  prompt: string;
  agentInstruction: string;
  evaluationCriterion: string;
  active: boolean;
};

const emptyItem: ItemForm = {
  prompt: "",
  agentInstruction: "",
  evaluationCriterion: "",
  active: true,
};

function protocolFromRow(row: any): ProtocolForm {
  return {
    id: row.id,
    jobPositionId: row.job_position_id,
    name: row.name,
    level: row.level,
    assessmentType: row.assessment_type,
    executionMode: row.execution_mode,
    greeting: row.greeting ?? "",
    farewell: row.farewell ?? "",
    methodology: row.methodology ?? "",
    validationEvidence: row.validation_evidence ?? "",
  };
}

export default function Assessments() {
  const utils = trpc.useUtils();
  const positions = trpc.positions.list.useQuery();
  const [positionId, setPositionId] = useState("all");
  const protocols = trpc.assessments.list.useQuery({
    positionId: positionId === "all" ? undefined : Number(positionId),
  });
  const governance = trpc.assessments.governance.useQuery();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = trpc.assessments.detail.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );
  const [protocol, setProtocol] = useState<ProtocolForm | null>(null);
  const [item, setItem] = useState<ItemForm>(emptyItem);
  const saveProtocol = trpc.assessments.upsertProtocol.useMutation({
    onSuccess: async saved => {
      toast.success(saved.id === protocol?.id ? "Protocolo guardado" : "Nueva versión guardada");
      setSelectedId(saved.id);
      await utils.assessments.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const saveItem = trpc.assessments.upsertItem.useMutation({
    onSuccess: async () => {
      setItem(emptyItem);
      await Promise.all([detail.refetch(), protocols.refetch()]);
      toast.success("Pregunta guardada");
    },
    onError: error => toast.error(error.message),
  });
  const reorder = trpc.assessments.reorderItems.useMutation({
    onSuccess: () => detail.refetch(),
    onError: error => toast.error(error.message),
  });
  const activate = trpc.assessments.activate.useMutation({
    onSuccess: async () => {
      await Promise.all([detail.refetch(), protocols.refetch()]);
      toast.success("Versión activada con evidencia registrada");
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (detail.data?.protocol) setProtocol(protocolFromRow(detail.data.protocol));
  }, [detail.data]);

  const selectedPosition = useMemo(
    () => (positions.data ?? []).find(row => row.id === Number(positionId)),
    [positionId, positions.data]
  );

  const beginProtocol = (level: ProtocolForm["level"]) => {
    if (!selectedPosition) {
      toast.error("Seleccione una plaza antes de crear la prueba");
      return;
    }
    const label = ASSESSMENT_LEVELS.find(option => option.value === level)?.label ?? "Prueba";
    setSelectedId(null);
    setProtocol({
      jobPositionId: selectedPosition.id,
      name: `${label} · ${selectedPosition.title}`,
      level,
      assessmentType: level === "tecnica" || level === "avanzada" ? "conocimiento" : "competencias",
      executionMode: "esperar_respuesta",
      greeting: "Le damos la bienvenida. A continuación se presentará una pregunta a la vez.",
      farewell: "La prueba ha finalizado. AISA revisará la evidencia antes de comunicar cualquier decisión.",
      methodology: "",
      validationEvidence: "",
    });
    setItem(emptyItem);
  };

  const moveItem = (id: number, direction: -1 | 1) => {
    if (!selectedId || !detail.data) return;
    const ids = detail.data.items.map(row => row.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ protocolId: selectedId, orderedIds: ids });
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <header>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><BrainCircuit className="h-5 w-5" /></div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">Evaluación gobernada</p>
        </div>
        <h1 className="mt-3 text-4xl font-800 tracking-[-.04em] text-primary">Pruebas psicométricas</h1>
        <p className="mt-2 max-w-4xl text-muted-foreground">Protocolos versionados por plaza, preguntas ordenadas, criterios explícitos y activación sujeta a evidencia metodológica.</p>
      </header>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <strong>Límite académico:</strong> {ASSESSMENT_METHODOLOGY_NOTICE}
      </div>

      <section className="grid gap-3 rounded-2xl border border-border/70 bg-card p-4 lg:grid-cols-[300px_repeat(4,auto)] lg:items-end">
        <div className="space-y-2">
          <Label>Plaza laboral</Label>
          <Select value={positionId} onValueChange={setPositionId}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Seleccione una plaza" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las plazas</SelectItem>
              {(positions.data ?? []).map(position => <SelectItem key={position.id} value={String(position.id)}>{position.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {ASSESSMENT_LEVELS.map(level => (
          <Button key={level.value} variant="outline" className="rounded-full" onClick={() => beginProtocol(level.value)}>
            <Plus className="mr-2 h-4 w-4" /> {level.label}
          </Button>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardHeader><CardTitle className="text-lg text-primary">Versiones registradas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(protocols.data ?? []).map(row => (
              <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full rounded-2xl border p-3 text-left ${selectedId === row.id ? "border-primary bg-primary/5" : "border-border/70 hover:bg-muted/50"}`}>
                <span className="flex items-center justify-between gap-2"><strong className="text-sm text-primary">{row.name}</strong><Badge variant="outline" className="rounded-full">{row.status}</Badge></span>
                <span className="mt-1 block text-xs text-muted-foreground">{row.position_title} · v{row.version} · {row.active_item_count}/{row.item_count} habilitadas</span>
              </button>
            ))}
            {!protocols.isLoading && !protocols.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">No existen protocolos con este filtro.</p> : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          {protocol ? (
            <Card className="rounded-3xl border-0 shadow-soft">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div><CardTitle className="text-xl text-primary">Definición versionada</CardTitle><p className="mt-1 text-sm text-muted-foreground">Editar una versión activa crea un nuevo borrador y copia sus preguntas.</p></div>
                {detail.data?.protocol.status !== "activo" && protocol.id ? <Button className="rounded-full" variant="outline" onClick={() => activate.mutate({ id: protocol.id! })} disabled={activate.isPending}><CheckCircle2 className="mr-2 h-4 w-4" /> Activar versión</Button> : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Nombre"><Input value={protocol.name} onChange={event => setProtocol({ ...protocol, name: event.target.value })} className="rounded-xl" /></Field>
                  <Field label="Plaza"><Select value={String(protocol.jobPositionId)} onValueChange={value => setProtocol({ ...protocol, jobPositionId: Number(value) })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(positions.data ?? []).map(position => <SelectItem key={position.id} value={String(position.id)}>{position.title}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Nivel"><Select value={protocol.level} onValueChange={value => setProtocol({ ...protocol, level: value as ProtocolForm["level"] })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{ASSESSMENT_LEVELS.map(level => <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Naturaleza metodológica"><Select value={protocol.assessmentType} onValueChange={value => setProtocol({ ...protocol, assessmentType: value as ProtocolForm["assessmentType"] })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="competencias">Evaluación por competencias</SelectItem><SelectItem value="conocimiento">Prueba de conocimiento</SelectItem><SelectItem value="psicometrica_validada">Psicométrica con validación documentada</SelectItem></SelectContent></Select></Field>
                  <Field label="Ejecución"><Select value={protocol.executionMode} onValueChange={value => setProtocol({ ...protocol, executionMode: value as ProtocolForm["executionMode"] })}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="esperar_respuesta">Esperar la respuesta del candidato</SelectItem><SelectItem value="evaluacion_inmediata">Evaluación inmediata</SelectItem></SelectContent></Select></Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Saludo"><Textarea value={protocol.greeting} onChange={event => setProtocol({ ...protocol, greeting: event.target.value })} rows={3} className="rounded-xl" /></Field>
                  <Field label="Despedida"><Textarea value={protocol.farewell} onChange={event => setProtocol({ ...protocol, farewell: event.target.value })} rows={3} className="rounded-xl" /></Field>
                  <Field label="Metodología"><Textarea value={protocol.methodology} onChange={event => setProtocol({ ...protocol, methodology: event.target.value })} rows={5} className="rounded-xl" placeholder="Constructo, población, administración, escala y límites" /></Field>
                  <Field label="Evidencia de validación"><Textarea value={protocol.validationEvidence} onChange={event => setProtocol({ ...protocol, validationEvidence: event.target.value })} rows={5} className="rounded-xl" placeholder="Validez, confiabilidad, equidad, adaptación y aprobación competente" /></Field>
                </div>
                <Button className="rounded-full" disabled={saveProtocol.isPending} onClick={() => saveProtocol.mutate({ ...protocol, greeting: protocol.greeting || undefined, farewell: protocol.farewell || undefined, methodology: protocol.methodology || undefined, validationEvidence: protocol.validationEvidence || undefined })}><Save className="mr-2 h-4 w-4" /> Guardar protocolo</Button>
              </CardContent>
            </Card>
          ) : <Card className="rounded-3xl border-0 shadow-soft"><CardContent className="grid min-h-[240px] place-items-center text-sm text-muted-foreground">Seleccione una versión o cree una prueba para una plaza.</CardContent></Card>}

          {protocol?.id ? (
            <Card className="rounded-3xl border-0 shadow-soft">
              <CardHeader><CardTitle className="text-xl text-primary">Preguntas e instrucciones del agente</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {(detail.data?.items ?? []).map((row, index, rows) => (
                  <div key={row.id} className="rounded-2xl border border-border/70 p-4">
                    <div className="flex items-start justify-between gap-3"><div><Badge variant="outline" className="rounded-full">{index + 1}</Badge><p className="mt-2 font-semibold text-primary">{row.prompt}</p><p className="mt-2 text-xs text-muted-foreground">Criterio: {row.evaluation_criterion}</p></div><div className="flex gap-1"><Button size="icon" variant="ghost" disabled={index === 0} onClick={() => moveItem(row.id, -1)} aria-label="Mover pregunta hacia arriba"><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={index === rows.length - 1} onClick={() => moveItem(row.id, 1)} aria-label="Mover pregunta hacia abajo"><ArrowDown className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => setItem({ id: row.id, prompt: row.prompt, agentInstruction: row.agent_instruction, evaluationCriterion: row.evaluation_criterion, active: row.active })}>Editar</Button></div></div>
                  </div>
                ))}
                <div className="rounded-2xl bg-muted/50 p-4">
                  <h3 className="font-bold text-primary">{item.id ? "Editar pregunta" : "Agregar pregunta"}</h3>
                  <div className="mt-4 grid gap-4"><Field label="Pregunta"><Textarea value={item.prompt} onChange={event => setItem({ ...item, prompt: event.target.value })} rows={3} className="rounded-xl" /></Field><div className="grid gap-4 md:grid-cols-2"><Field label="Instrucción para la IA"><Textarea value={item.agentInstruction} onChange={event => setItem({ ...item, agentInstruction: event.target.value })} rows={4} className="rounded-xl" /></Field><Field label="Criterio de evaluación"><Textarea value={item.evaluationCriterion} onChange={event => setItem({ ...item, evaluationCriterion: event.target.value })} rows={4} className="rounded-xl" /></Field></div><label className="flex items-center gap-3 text-sm"><Switch checked={item.active} onCheckedChange={active => setItem({ ...item, active })} /> Pregunta activa</label></div>
                  <div className="mt-4 flex gap-2"><Button className="rounded-full" disabled={saveItem.isPending || item.prompt.trim().length < 8 || item.agentInstruction.trim().length < 8 || item.evaluationCriterion.trim().length < 8} onClick={() => saveItem.mutate({ ...item, protocolId: protocol.id! })}><Save className="mr-2 h-4 w-4" /> Guardar pregunta</Button>{item.id ? <Button variant="ghost" onClick={() => setItem(emptyItem)}>Cancelar</Button> : null}</div>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Card className="rounded-3xl border-0 shadow-soft">
        <CardHeader><CardTitle className="flex items-center gap-2 text-xl text-primary"><ShieldCheck className="h-5 w-5" /> 64 criterios de gobierno no verificados</CardTitle><p className="text-sm text-muted-foreground">Estos criterios orientan el gobierno y la calidad; no acreditan cumplimiento ni sustituyen un estudio de validez psicométrica.</p></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(governance.data?.rules ?? []).map(rule => <div key={rule.id} className="rounded-xl border border-border/70 p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">{rule.id} · {rule.domain}</p><p className="mt-1 text-xs leading-5 text-primary">{rule.label}</p></div>)}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label className="font-semibold text-primary">{label}</Label>{children}</div>;
}
