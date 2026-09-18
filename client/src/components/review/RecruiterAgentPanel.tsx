import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Bot, Loader2, Paperclip, Send } from "lucide-react";
import { useRef, useState } from "react";

/**
 * Agente del reclutador.
 *
 * Es el agente **interior** que auxilia a analizar al candidato de esta
 * postulación. Su alcance es deliberado: consulta y responde; **no modifica
 * ninguna opción de la interfaz**. El historial pertenece al candidato, de modo
 * que al salir y volver se ve exactamente la conversación de esa postulación.
 *
 * La luz del cuadro de preguntas no es decorativa: **verde recorriendo** cuando
 * el agente está listo, **rojo** mientras espera la respuesta del modelo. Como
 * se deriva de la mutación en curso, no puede mentir.
 */
export function RecruiterAgentPanel({ applicationId }: { applicationId: number }) {
  const thread = trpc.recruiterAgent.thread.useQuery(
    { applicationId },
    { refetchInterval: 20_000, retry: false }
  );
  const ask = trpc.recruiterAgent.ask.useMutation({
    onSuccess: async () => {
      setQuestion("");
      setNotice(null);
      await thread.refetch();
    },
    onError: error => setNotice(error.message),
  });
  const setModel = trpc.recruiterAgent.setModel.useMutation({
    onSuccess: () => thread.refetch(),
  });
  const upload = trpc.candidateKnowledge.upload.useMutation({
    onSuccess: () => setNotice("Documento incorporado al RAG personal."),
    onError: error => setNotice(error.message),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const waiting = ask.isPending;
  const messages = thread.data?.messages ?? [];

  function attach(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1]! : "";
      if (!base64) {
        setNotice("No fue posible leer el archivo.");
        return;
      }
      upload.mutate({
        applicationId,
        fileName: file.name.slice(0, 260),
        base64,
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <section
      aria-label="Agente del reclutador"
      className="rounded-2xl border border-border/70 bg-card p-3 shadow-sm sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold text-primary">
          Agente del reclutador
        </p>
        <Badge variant="outline" className="rounded-full text-[10px]">
          Solo consulta · no modifica la evaluación
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          Conocimiento limitado a este candidato
        </span>
      </div>

      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Pregunte por la evidencia del expediente, sus riesgos o su encaje
            con la plaza. El agente responde con lo que el expediente sostiene y
            declara lo que no registra.
          </p>
        ) : (
          messages.map(message => (
            <div
              key={message.id}
              className={
                message.author === "jarvi"
                  ? "rounded-xl border border-primary/20 bg-primary/5 px-3 py-2"
                  : "rounded-xl border border-border/70 bg-muted/40 px-3 py-2"
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-semibold">
                  {message.author === "jarvi"
                    ? "JARVI HR"
                    : message.actorName || "Reclutador"}
                </span>
                <span>
                  {new Date(message.createdAt).toLocaleString("es-GT", {
                    timeZone: "America/Guatemala",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                {message.author === "jarvi" && message.keySource === "backup" ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-amber-300 bg-amber-100 text-[9px] text-amber-950"
                  >
                    credencial de respaldo
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-5">
                {message.body}
              </p>
            </div>
          ))
        )}
      </div>

      <div
        className={`mt-3 rounded-2xl border p-2 transition-colors ${
          waiting
            ? "agent-waiting border-rose-300 bg-rose-50"
            : "agent-ready border-emerald-300 bg-emerald-50"
        }`}
      >
        <Textarea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (question.trim() && !waiting)
                ask.mutate({ applicationId, question: question.trim() });
            }
          }}
          rows={2}
          maxLength={4_000}
          placeholder={
            waiting
              ? "El agente está respondiendo…"
              : "Pregunte sobre el candidato (Enter para enviar)"
          }
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="mt-1 flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) attach(file);
              event.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="mr-1.5 h-3.5 w-3.5" />
            )}
            Adjuntar al expediente
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {waiting
              ? "Esperando al modelo…"
              : "Listo para responder"}
          </span>
          <Button
            size="sm"
            className="ml-auto rounded-full"
            disabled={waiting || !question.trim()}
            onClick={() =>
              ask.mutate({ applicationId, question: question.trim() })
            }
          >
            {waiting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Preguntar
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Modelo de esta conversación
        </span>
        <Select
          value={thread.data?.model ?? ""}
          onValueChange={value =>
            setModel.mutate({ applicationId, model: value || null })
          }
        >
          <SelectTrigger className="h-8 w-56 rounded-full text-xs">
            <SelectValue placeholder="Modelo institucional" />
          </SelectTrigger>
          <SelectContent>
            {(thread.data?.models ?? []).map(model => (
              <SelectItem key={model} value={model} className="text-xs">
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground">
          El catálogo lo declara el servidor; el método de evaluación no cambia.
        </span>
      </div>

      {notice ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{notice}</p>
      ) : null}
    </section>
  );
}
