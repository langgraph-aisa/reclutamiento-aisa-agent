import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Cloud,
  Database,
  FolderKanban,
  HardDrive,
  RefreshCw,
  UserRoundCog,
} from "lucide-react";
import { toast } from "sonner";

type ProjectRow = {
  id: number;
  name: string;
  storage_mode: string;
  dropbox_connection_user_id: number | null;
  created_by_user_id: number | null;
  owner_name: string | null;
  dropbox_name: string | null;
  file_count: number;
  candidate_file_count: number;
};

export default function ProjectStorage() {
  const projects = trpc.storage.projects.useQuery();
  const connectedUsers = trpc.storage.connectedUsers.useQuery();

  const setMode = trpc.storage.setProjectStorage.useMutation({
    onSuccess: async () => {
      await projects.refetch();
      toast.success("Almacenamiento del proyecto actualizado.");
    },
    onError: error => toast.error(error.message),
  });

  const assign = trpc.storage.assignProjectConnection.useMutation({
    onSuccess: async () => {
      await projects.refetch();
      toast.success("Cuenta de Dropbox del proyecto actualizada.");
    },
    onError: error => toast.error(error.message),
  });

  const migrate = trpc.storage.migrateProject.useMutation({
    onSuccess: async result => {
      await projects.refetch();
      toast.success(
        `Migración completada: ${result.copied} documento(s) copiados${
          result.failed ? `, ${result.failed} con fallo` : ""
        }.`
      );
    },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
          Custodia de documentos
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Almacenamiento por proyecto
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Decida dónde vive la base de conocimiento de cada proyecto: en el
          volumen local o en el Dropbox de la cuenta que lo respalda. Cada
          proyecto organiza su carpeta como <span className="font-medium">Proyecto/Plaza/Candidato</span>.
          Active, asigne o migre sin que los documentos ya cargados
          desaparezcan.
        </p>
      </div>

      {projects.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando proyectos…</p>
      ) : !projects.data?.length ? (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            No hay proyectos de conocimiento registrados.
          </CardContent>
        </Card>
      ) : (
        (projects.data as ProjectRow[]).map(project => (
          <Card key={project.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <FolderKanban className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <CardDescription>
                      {project.file_count} documento(s) de proyecto ·{" "}
                      {project.candidate_file_count} del RAG de candidatos
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={
                    project.storage_mode === "dropbox"
                      ? "rounded-full border-emerald-300 text-emerald-700"
                      : "rounded-full"
                  }
                >
                  {project.storage_mode === "dropbox" ? (
                    <>
                      <Cloud className="mr-1 h-3.5 w-3.5" /> Dropbox
                    </>
                  ) : (
                    <>
                      <HardDrive className="mr-1 h-3.5 w-3.5" /> Local
                    </>
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 rounded-2xl border border-border/70 p-4 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Modo de almacenamiento
                    </p>
                    <p className="font-semibold">
                      {project.storage_mode === "dropbox"
                        ? "Dropbox"
                        : "Volumen local"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <UserRoundCog className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Cuenta que lo respalda
                    </p>
                    <p className="font-semibold">
                      {project.storage_mode === "dropbox"
                        ? project.dropbox_name ??
                          project.owner_name ??
                          "Sin cuenta asignada"
                        : project.owner_name ?? "Sin propietario"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {project.storage_mode === "dropbox" ? (
                  <Button
                    variant="outline"
                    disabled={setMode.isPending}
                    onClick={() =>
                      setMode.mutate({ projectId: project.id, mode: "local" })
                    }
                  >
                    <HardDrive className="mr-2 h-4 w-4" />
                    Volver al volumen local
                  </Button>
                ) : (
                  <Button
                    disabled={setMode.isPending}
                    onClick={() =>
                      setMode.mutate({ projectId: project.id, mode: "dropbox" })
                    }
                  >
                    <Cloud className="mr-2 h-4 w-4" />
                    Activar Dropbox
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={migrate.isPending}
                  onClick={() =>
                    migrate.mutate({
                      projectId: project.id,
                      direction:
                        project.storage_mode === "dropbox"
                          ? "to_local"
                          : "to_dropbox",
                    })
                  }
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {project.storage_mode === "dropbox"
                    ? "Migrar al volumen local"
                    : "Migrar a Dropbox"}
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                  Cuenta de Dropbox asignada
                </p>
                <Select
                  value={
                    project.dropbox_connection_user_id != null
                      ? String(project.dropbox_connection_user_id)
                      : "owner"
                  }
                  onValueChange={value =>
                    assign.mutate({
                      projectId: project.id,
                      userId:
                        value === "owner" ? null : Number(value),
                    })
                  }
                >
                  <SelectTrigger className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm sm:max-w-sm">
                    <SelectValue placeholder="Seleccionar cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">
                      Creador del proyecto (por omisión)
                    </SelectItem>
                    {(connectedUsers.data ?? []).map((user: { id: number; name: string | null; email: string | null }) => (
                      <SelectItem key={user.id} value={String(user.id)}>
                        {user.name ?? user.email ?? `Usuario ${user.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Solo las cuentas que ya conectaron su Dropbox aparecen en la
                  lista. La cuenta asignada respalda la custodia cuando el modo
                  es Dropbox.
                </p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
