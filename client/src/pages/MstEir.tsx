import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BookOpenText, Globe2, History, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type MethodologyDocument = {
  id: number;
  document_key: "siera" | "mst_eir";
  display_name: string;
  content_markdown: string;
  version: number;
  revision_count: number;
  updated_at: string | Date;
  updated_by_name: string | null;
  updated_by_email: string | null;
};

export default function MstEir() {
  const documents = trpc.mstEir.documents.useQuery();

  return (
    <div className="space-y-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">Conocimiento institucional</p>
        <h1 className="mt-2 flex items-center gap-3 text-4xl font-800 tracking-[-.04em] text-primary">
          <Globe2 className="h-9 w-9 text-emerald-700" />
          MST-EIR
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Administra la metodología SIERA y el Modelo Sistémico de Talento para Energías Inteligentes y Renovables.
        </p>
      </div>

      <Card className="rounded-3xl border-0 bg-[#0b2d4b] text-white shadow-soft dark:bg-[#162333]">
        <CardContent className="flex gap-3 p-5">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
          <p className="text-sm leading-6 text-white/75">
            El contenido completo se conserva en PostgreSQL. Cada guardado crea una nueva revisión y nunca sobrescribe el historial anterior.
          </p>
        </CardContent>
      </Card>

      {documents.isLoading && (
        <Card className="rounded-3xl border-0 shadow-soft">
          <CardContent className="p-8 text-sm text-muted-foreground">Cargando documentos…</CardContent>
        </Card>
      )}

      {documents.error && (
        <Card className="rounded-3xl border-red-200 bg-red-50 shadow-soft">
          <CardContent className="p-6 text-sm text-red-800">
            No fue posible cargar MST-EIR: {documents.error.message}
          </CardContent>
        </Card>
      )}

      {documents.data?.length === 0 && (
        <Card className="rounded-3xl border-amber-200 bg-amber-50 shadow-soft">
          <CardContent className="p-6 text-sm text-amber-900">
            Los documentos todavía no están inicializados. Ejecute el query SQL MST-EIR en la base PostgreSQL.
          </CardContent>
        </Card>
      )}

      {documents.data?.map(document => (
        <DocumentEditor
          key={document.document_key}
          document={document as MethodologyDocument}
          onSaved={() => documents.refetch()}
        />
      ))}
    </div>
  );
}

function DocumentEditor({ document, onSaved }: { document: MethodologyDocument; onSaved: () => Promise<unknown> }) {
  const [content, setContent] = useState(document.content_markdown);
  const saveDocument = trpc.mstEir.saveDocument.useMutation({
    onSuccess: async result => {
      setContent(result.content_markdown);
      await onSaved();
      toast.success(result.unchanged ? `${document.display_name} no tenía cambios` : `${document.display_name} guardado como versión ${result.version}`);
    },
    onError: error => toast.error(`No fue posible guardar ${document.display_name}: ${error.message}`),
  });

  useEffect(() => {
    setContent(document.content_markdown);
  }, [document.id, document.version, document.content_markdown]);

  const changed = content !== document.content_markdown;
  const isSiera = document.document_key === "siera";

  return (
    <Card className="rounded-3xl border-0 shadow-soft">
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex gap-3">
            <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isSiera ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"}`}>
              <BookOpenText className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-primary">{isSiera ? "1) SIERA" : "2) Modelo MST-EIR"}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{document.display_name}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full">Versión {document.version}</Badge>
            <Badge variant="outline" className="rounded-full"><History className="mr-1 h-3.5 w-3.5" />{document.revision_count} revisiones</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          rows={24}
          spellCheck
          className="min-h-[34rem] resize-y rounded-2xl font-mono text-sm leading-6"
          aria-label={`Contenido de ${document.display_name}`}
        />
        <div className="flex flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <div>
            <span>{content.length.toLocaleString("es-GT")} caracteres</span>
            <span className="mx-2">·</span>
            <span>
              Última actualización: {new Date(document.updated_at).toLocaleString("es-GT")}
              {document.updated_by_name ? ` por ${document.updated_by_name}` : " · carga inicial"}
            </span>
          </div>
          <span>{changed ? "Cambios sin guardar" : "Contenido guardado"}</span>
        </div>
        <Button
          type="button"
          onClick={() => saveDocument.mutate({
            documentKey: document.document_key,
            contentMarkdown: content,
            expectedVersion: Number(document.version),
          })}
          disabled={!changed || !content.length || content.length > 100_000 || saveDocument.isPending}
          className="rounded-full"
        >
          <Save className="mr-2 h-4 w-4" />
          {saveDocument.isPending ? "Guardando…" : isSiera ? "Guardar SIERA" : "Guardar Modelo MST-EIR"}
        </Button>
        {content.length > 100_000 && <p className="text-sm text-red-700">El documento supera el máximo de 100,000 caracteres.</p>}
      </CardContent>
    </Card>
  );
}
