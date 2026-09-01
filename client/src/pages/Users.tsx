import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { MailCheck, Plus, ShieldCheck, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const empty = { id: undefined as number | undefined, active: true, name: "", email: "", role: "reclutador" as "admin" | "reclutador" };

export default function Users() {
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery();
  const save = trpc.users.upsert.useMutation({ onSuccess: () => { toast.success("Usuario guardado"); setForm(empty); utils.users.list.invalidate(); }, onError: error => toast.error(error.message) });
  const setActive = trpc.users.setActive.useMutation({ onSuccess: () => { toast.success("Estado actualizado"); utils.users.list.invalidate(); }, onError: error => toast.error(error.message) });
  const visibleUsers = (users.data ?? []).filter(user => {
    const text = `${user.name ?? ""} ${user.email ?? ""}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (roleFilter === "all" || user.role === roleFilter) && (statusFilter === "all" || (statusFilter === "active" ? user.active : !user.active));
  });

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Control de acceso</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Usuarios y permisos</h1><p className="mt-2 max-w-2xl text-muted-foreground">Administra quién puede ingresar. Cada usuario recibe su propio código temporal en el correo registrado.</p></div>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader><CardTitle className="text-lg">Usuarios registrados</CardTitle><Input className="mt-3" placeholder="Buscar por nombre o correo" value={search} onChange={event => setSearch(event.target.value)} /><div className="mt-3 grid grid-cols-2 gap-2"><select value={roleFilter} onChange={event => setRoleFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="all">Todos los roles</option><option value="admin">Administradores</option><option value="reclutador">Reclutadores</option></select><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="all">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></div></CardHeader>
          <CardContent className="space-y-3">{users.isLoading ? <p className="text-sm text-muted-foreground">Cargando usuarios…</p> : visibleUsers.map(user => <div key={user.id} className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary">{user.role === "admin" ? <ShieldCheck className="h-4 w-4" /> : <UserCog className="h-4 w-4" />}</div><div><p className="font-semibold">{user.name}</p><p className="text-sm text-muted-foreground">{user.email}</p><div className="mt-1 flex gap-2"><Badge variant="outline">{user.role === "admin" ? "Administrador" : "Reclutador"}</Badge><Badge variant={user.active ? "default" : "secondary"}>{user.active ? "Activo" : "Inactivo"}</Badge></div></div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setSelectedUser(user)}>Detalle</Button><Button size="sm" variant="outline" onClick={() => setForm({ id: user.id, active: user.active, name: user.name ?? "", email: user.email ?? "", role: user.role === "admin" ? "admin" : "reclutador" })}>Editar</Button><Button size="sm" variant="outline" onClick={() => setActive.mutate({ id: user.id, active: !user.active })}>{user.active ? "Desactivar" : "Activar"}</Button></div></div>)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg">{form.id ? "Editar usuario" : "Nuevo usuario"}</CardTitle></CardHeader>
          <CardContent><form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(form); }}><div className="space-y-2"><Label>Nombre completo</Label><Input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></div><div className="space-y-2"><Label>Correo electrónico</Label><Input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required /></div><div className="space-y-2"><Label>Rol</Label><Select value={form.role} onValueChange={value => setForm({ ...form, role: value as "admin" | "reclutador" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reclutador">Reclutador</SelectItem><SelectItem value="admin">Administrador</SelectItem></SelectContent></Select></div><Button type="submit" disabled={save.isPending}><Plus className="mr-2 h-4 w-4" />{save.isPending ? "Guardando…" : form.id ? "Guardar cambios" : "Crear usuario"}</Button></form>{form.id && <Button className="mt-3 w-full" type="button" variant="ghost" onClick={() => setForm(empty)}>Cancelar edición</Button>}<div className="mt-6 flex items-start gap-3 rounded-xl bg-accent/40 p-4 text-sm text-muted-foreground"><MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />El usuario no recibe una contraseña. Al ingresar solicitará un código de seis dígitos en este correo.</div></CardContent>
        </Card>
        {selectedUser && <Card className="xl:col-span-2"><CardHeader><div className="flex items-center justify-between"><CardTitle className="text-lg">Detalle del usuario</CardTitle><Button variant="ghost" onClick={() => setSelectedUser(null)}>Cerrar</Button></div></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Info label="Nombre" value={selectedUser.name} /><Info label="Correo" value={selectedUser.email} /><Info label="Rol / estado" value={`${selectedUser.role === "admin" ? "Administrador" : "Reclutador"} · ${selectedUser.active ? "Activo" : "Inactivo"}`} /><Info label="Último acceso" value={selectedUser.last_signed_in ? new Date(selectedUser.last_signed_in).toLocaleString() : "Sin acceso registrado"} /><Info label="Creado" value={selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleString() : "—"} /><Info label="Actualizado" value={selectedUser.updated_at ? new Date(selectedUser.updated_at).toLocaleString() : "—"} /><div className="flex flex-wrap items-end gap-2 sm:col-span-2"><Button size="sm" variant="outline" onClick={() => setForm({ id: selectedUser.id, active: selectedUser.active, name: selectedUser.name ?? "", email: selectedUser.email ?? "", role: selectedUser.role === "admin" ? "admin" : "reclutador" })}>Editar usuario</Button><Button size="sm" variant="outline" onClick={() => setActive.mutate({ id: selectedUser.id, active: !selectedUser.active })}>{selectedUser.active ? "Desactivar usuario" : "Activar usuario"}</Button></div></CardContent></Card>}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
