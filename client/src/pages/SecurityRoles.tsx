import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Eye, EyeOff, ScrollText, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Roles de seguridad.
 *
 * El permiso es **por usuario**: cada cuenta recibe exactamente lo que la
 * institución le concede, y sin concesión no hay acceso. El administrador
 * conserva todo por rol y sus casillas no se editan, de modo que un error no
 * puede dejarlo fuera de la administración.
 *
 * Toda edición y toda eliminación —el cambio de permisos entre ellas— exige un
 * código que viaja **solo por correo**: la vista no lo muestra ni lo recibe.
 */

type Action = "view" | "read" | "write" | "edit" | "delete";
type Grant = Record<Action, boolean>;
type Scope = "modulo" | "recurso";

const ACTIONS: Action[] = ["read", "write", "edit", "delete"];
const EMPTY: Grant = {
  view: false,
  read: false,
  write: false,
  edit: false,
  delete: false,
};

const ACTION_LABELS: Record<Action, string> = {
  view: "Vista",
  read: "Lectura",
  write: "Escritura",
  edit: "Edición",
  delete: "Eliminación",
};

const SCOPE_LABELS: Record<Scope, string> = {
  modulo: "Módulos del menú",
  recurso: "Dominios de la base",
};

function mapKey(scope: Scope, key: string) {
  return `${scope}:${key}`;
}

function formatMoment(value: string | Date) {
  return new Date(value).toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
  });
}

export default function SecurityRoles() {
  const users = trpc.users.list.useQuery();
  const [userId, setUserId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, Grant>>({});
  const [code, setCode] = useState("");
  const [asking, setAsking] = useState<{
    emailMask: string;
    expiresInMinutes: number;
  } | null>(null);

  useEffect(() => {
    if (userId === null && users.data?.length) setUserId(users.data[0].id);
  }, [users.data, userId]);

  const overview = trpc.security.overview.useQuery(
    { userId: userId ?? 0 },
    { enabled: Boolean(userId) }
  );
  const requestCode = trpc.security.requestCode.useMutation({
    onSuccess: result => {
      setCode("");
      setAsking({
        emailMask: result.emailMask,
        expiresInMinutes: result.expiresInMinutes,
      });
    },
    onError: error => toast.error(error.message),
  });
  const confirm = trpc.security.confirm.useMutation({
    onSuccess: () => {
      toast.success("Permisos guardados.");
      setAsking(null);
      setCode("");
      overview.refetch();
    },
    onError: error => toast.error(error.message),
  });

  // El borrador se siembra desde lo guardado y se conserva mientras se edita.
  const loaded = overview.data?.permissions;
  useEffect(() => {
    if (!loaded) return;
    setDraft(Object.fromEntries(Object.entries(loaded)));
  }, [loaded]);

  const isAdmin = overview.data?.account?.role === "admin";
  const rows = useMemo(() => {
    const modules = (overview.data?.modules ?? []).map(module => ({
      scope: "modulo" as Scope,
      key: module.key,
      label: module.label,
      note: "",
    }));
    const resources = (overview.data?.resources ?? []).map(resource => ({
      scope: "recurso" as Scope,
      key: resource.key,
      label: resource.label,
      note: resource.note,
    }));
    return { modules, resources };
  }, [overview.data]);

  function grantOf(scope: Scope, key: string): Grant {
    return draft[mapKey(scope, key)] ?? EMPTY;
  }

  function toggle(scope: Scope, key: string, action: Action, next: boolean) {
    setDraft(current => {
      const keyName = mapKey(scope, key);
      const base = current[keyName] ?? EMPTY;
      const updated: Grant = { ...base, [action]: next };
      // Apagar la vista retira también la lectura: un módulo que no se ve no
      // puede leerse, y dejar la lectura encendida produciría un permiso que
      // la interfaz no puede ejercer.
      if (action === "view" && !next) updated.read = false;
      if (action === "read" && next) updated.view = true;
      return { ...current, [keyName]: updated };
    });
  }

  function save() {
    if (!userId) {
      toast.error("Seleccione un usuario.");
      return;
    }
    if (isAdmin) {
      toast.error("El administrador conserva todos los permisos.");
      return;
    }
    requestCode.mutate({ userId });
  }

  function submit() {
    if (!userId) return;
    const grants = [...rows.modules, ...rows.resources].map(row => ({
      scope: row.scope,
      key: row.key,
      grant: grantOf(row.scope, row.key),
    }));
    confirm.mutate({ userId, code, grants });
  }

  function renderGrid(
    title: string,
    scope: Scope,
    list: Array<{ key: string; label: string; note: string }>
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-y-1.5">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 font-semibold">Entrada</th>
                {ACTIONS.map(action => (
                  <th key={action} className="px-2 text-center font-semibold">
                    {ACTION_LABELS[action]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(row => {
                const grant = grantOf(scope, row.key);
                return (
                  <tr key={row.key} className="bg-muted/30">
                    <td className="rounded-l-lg px-2 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`${grant.view ? "Quitar" : "Conceder"} la vista de ${row.label}`}
                          aria-pressed={grant.view}
                          disabled={isAdmin}
                          onClick={() =>
                            toggle(scope, row.key, "view", !grant.view)
                          }
                          className="text-primary disabled:opacity-40"
                        >
                          {grant.view ? (
                            <Eye className="h-4 w-4" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {row.label}
                          </p>
                          {row.note ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {row.note}
                            </p>
                          ) : (
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {row.key}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    {ACTIONS.map(action => (
                      <td
                        key={action}
                        className="px-2 py-2 text-center last:rounded-r-lg"
                      >
                        <Switch
                          aria-label={`${ACTION_LABELS[action]} de ${row.label}`}
                          checked={grant[action]}
                          disabled={isAdmin}
                          onCheckedChange={next =>
                            toggle(scope, row.key, action, next)
                          }
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
          Seguridad del administrador
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Roles de Seguridad
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          El permiso se concede por usuario y por entrada. Apagar la vista
          retira la entrada del menú de esa cuenta; sin concesión no hay acceso.
          El administrador conserva todo por rol. Toda edición y toda
          eliminación exigen un código enviado al correo registrado.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {renderGrid(SCOPE_LABELS.modulo, "modulo", rows.modules)}
          {renderGrid(SCOPE_LABELS.recurso, "recurso", rows.resources)}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usuario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={userId ? String(userId) : ""}
                onValueChange={value => setUserId(Number(value))}
              >
                <SelectTrigger aria-label="Usuario al que se conceden los permisos">
                  <SelectValue placeholder="Seleccione un usuario" />
                </SelectTrigger>
                <SelectContent>
                  {(users.data ?? []).map(user => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      {user.name} · {user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {overview.data?.account ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {overview.data.account.role === "admin"
                      ? "Administrador AISA"
                      : "Reclutador"}
                  </Badge>
                  {isAdmin ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ShieldCheck className="h-3 w-3" /> Permisos completos
                      por rol
                    </span>
                  ) : null}
                </div>
              ) : null}
              <Button
                className="w-full"
                onClick={save}
                disabled={!userId || requestCode.isPending}
              >
                {requestCode.isPending
                  ? "Solicitando código…"
                  : "Guardar configuración"}
              </Button>
              {isAdmin ? (
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Las casillas del administrador no se editan: un error aquí
                  dejaría a la institución sin administración.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="h-4 w-4" /> Log Usuarios · últimas 20
                acciones
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-2 overflow-y-auto">
              {(overview.data?.recentActions ?? []).length ? (
                (overview.data?.recentActions ?? []).map(entry => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border/70 px-2.5 py-2"
                  >
                    <p className="truncate font-mono text-[11px]">
                      {entry.action}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {entry.entity_type} · {entry.entity_id} ·{" "}
                      {formatMoment(entry.created_at)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sin acciones registradas para esta cuenta.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={Boolean(asking)}
        onOpenChange={open => {
          if (!open) {
            setAsking(null);
            setCode("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar los permisos</DialogTitle>
            <DialogDescription>
              El código se envió a {asking?.emailMask} y expira en{" "}
              {asking?.expiresInMinutes} minutos. No se muestra en pantalla ni
              viaja por este medio: solo por correo. El desafío admite cinco
              intentos.
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
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAsking(null);
                setCode("");
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={code.length !== 6 || confirm.isPending}
              onClick={submit}
            >
              {confirm.isPending ? "Guardando…" : "Confirmar y guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
