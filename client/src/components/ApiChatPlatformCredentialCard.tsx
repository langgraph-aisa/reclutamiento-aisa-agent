import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CredentialField } from "@/components/CredentialField";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type PlatformApiChatSecretKey =
  | "client_id"
  | "token"
  | "account_id"
  | "webhook_secret";

/**
 * Administración de la credencial de plataforma de ApiChat.
 *
 * Vive en la hoja de auditoría del canal porque es la pieza que explica sus
 * fallos: un token retirado produce exactamente las pérdidas de recepción y los
 * fallos de entrega que la hoja mide, de modo que administrarla lejos del
 * síntoma obligaba a corregir en una hoja lo que se diagnosticaba en otra.
 *
 * Solo la ve la administración: la identidad institucional no la administra el
 * reclutador, y su hoja no declara una capacidad que no gobierna.
 */
export function ApiChatPlatformCredentialCard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // La consulta se habilita solo para la administración: sin ese rol el campo
  // ni siquiera se solicita al servidor.
  const apiChatUser = trpc.config.apiChatUserConfiguration.useQuery(undefined, {
    enabled: isAdmin,
  });
  const apiChatPlatform = trpc.config.apiChatConfiguration.useQuery(undefined, {
    enabled: isAdmin,
  });
  const savePlatformApiChatSecret = trpc.config.saveApiChatSecret.useMutation({
    onSuccess: async () => {
      await Promise.all([apiChatUser.refetch(), apiChatPlatform.refetch()]);
    },
    onError: error => toast.error(error.message),
  });
  const verifyApiChat = trpc.config.verifyApiChat.useMutation({
    onSuccess: result => {
      if (result.isConnected)
        toast.success("ApiChat está conectado y disponible");
      else
        toast.info(
          "Las credenciales son válidas; la instancia todavía no está conectada"
        );
    },
    onError: error => toast.error(error.message),
  });

  const persistPlatformApiChatSecret = async (
    key: PlatformApiChatSecretKey,
    value: string | null
  ) => {
    try {
      await savePlatformApiChatSecret.mutateAsync({ key, value });
      toast.success(
        value
          ? "Credencial de plataforma guardada"
          : "Credencial de plataforma eliminada"
      );
      return true;
    } catch {
      return false;
    }
  };

  if (!isAdmin) return null;

  const apiChatLegacy = apiChatUser.data?.mode === "legacy";

  return (
    <Card>
      <CardHeader>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <CardTitle className="mt-3">
          ApiChat · credencial de plataforma
        </CardTitle>
        <CardDescription>
          Credencial de la institución: gobierna la recepción de mensajes y el
          webhook, y respalda a quien no configuró la suya. El secreto del
          webhook debe coincidir con el ?key= de la dirección registrada en
          ApiChat.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {apiChatLegacy ? (
          <CredentialField
            label="ID de cuenta"
            description="Solo se utiliza en el modo heredado"
            placeholder="Ingrese el ID de cuenta"
            state={apiChatPlatform.data?.secrets.account_id}
            pending={savePlatformApiChatSecret.isPending}
            onSave={value => persistPlatformApiChatSecret("account_id", value)}
            onRemove={() => persistPlatformApiChatSecret("account_id", null)}
          />
        ) : (
          <CredentialField
            label="Client ID"
            description="Identificador de la API nativa"
            placeholder="Ingrese el Client ID"
            state={apiChatPlatform.data?.secrets.client_id}
            pending={
              savePlatformApiChatSecret.isPending || verifyApiChat.isPending
            }
            onSave={value => persistPlatformApiChatSecret("client_id", value)}
            onRemove={() => persistPlatformApiChatSecret("client_id", null)}
            onVerify={() => verifyApiChat.mutate({ scope: "plataforma" })}
          />
        )}
        <CredentialField
          label="Token"
          description="Credencial obligatoria de ApiChat"
          placeholder="Ingrese el token"
          state={apiChatPlatform.data?.secrets.token}
          pending={
            savePlatformApiChatSecret.isPending || verifyApiChat.isPending
          }
          onSave={value => persistPlatformApiChatSecret("token", value)}
          onRemove={() => persistPlatformApiChatSecret("token", null)}
          onVerify={() => verifyApiChat.mutate({ scope: "plataforma" })}
        />
        <CredentialField
          label="Secreto del webhook"
          description="Credencial que el artefacto exige en la ruta de recepción; debe coincidir con el ?key= de la dirección registrada en ApiChat"
          placeholder="Ingrese el secreto entrante"
          state={apiChatPlatform.data?.secrets.webhook_secret}
          pending={savePlatformApiChatSecret.isPending}
          onSave={value =>
            persistPlatformApiChatSecret("webhook_secret", value)
          }
          onRemove={() =>
            persistPlatformApiChatSecret("webhook_secret", null)
          }
        />
      </CardContent>
    </Card>
  );
}
