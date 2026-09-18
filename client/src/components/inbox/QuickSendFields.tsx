import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter } from "@/components/ui/dialog";
import { Crosshair, FileUp, Mic, Paperclip, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Campos de envío saliente de la bandeja.
 *
 * Reúne las tres formas de adjuntar contenido sin exigir que el operador pegue
 * una dirección: un archivo arrastrado o elegido del equipo, una nota de voz
 * grabada con el micrófono y una ubicación compartida por el navegador. El
 * contenido viaja al servidor en base64 y es él quien lo publica con una
 * capacidad firmada antes de anunciarlo al proveedor.
 */
export type QuickSendPayload =
  | { kind: "file"; dataBase64: string; fileName: string; caption?: string }
  | { kind: "ptt"; dataBase64: string; mimeType: string; fileName: string }
  | {
      kind: "location";
      latitude: number;
      longitude: number;
      address?: string;
    };

type QuickSendKind = "file" | "ptt" | "location";

type QuickSendFieldsProps = {
  kind: QuickSendKind;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (payload: QuickSendPayload) => void;
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

function extensionForMimeType(mimeType: string) {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mp4")) return "m4a";
  if (base.includes("mpeg")) return "mp3";
  if (base.includes("wav")) return "wav";
  return "webm";
}

function preferredAudioType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? "";
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(new Error("No fue posible leer el contenido seleccionado."));
    reader.readAsDataURL(blob);
  });
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function QuickSendFields({
  kind,
  pending,
  onCancel,
  onSubmit,
}: QuickSendFieldsProps) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const clipRef = useRef<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);

  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [address, setAddress] = useState("");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const releaseClip = useCallback(() => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipRef.current = null;
    setClipUrl(null);
    setSeconds(0);
  }, [clipUrl]);

  const stopMicrophone = useCallback(() => {
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    micStreamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopMicrophone();
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    };
  }, [stopMicrophone, clipUrl]);

  const acceptFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    if (candidate.size > MAX_FILE_BYTES) {
      toast.error("El archivo supera el límite de 20 MB.");
      return;
    }
    setFile(candidate);
  };

  const startRecording = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("El navegador no admite la grabación de voz.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const preferred = preferredAudioType();
      const recorder = new MediaRecorder(
        stream,
        preferred ? { mimeType: preferred } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopMicrophone();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size === 0) {
          toast.error("No se capturó audio. Verifique el micrófono.");
          return;
        }
        if (blob.size > MAX_AUDIO_BYTES) {
          toast.error("La nota de voz supera el límite de 16 MB.");
          return;
        }
        releaseClip();
        clipRef.current = blob;
        setClipUrl(URL.createObjectURL(blob));
      };
      recorderRef.current = recorder;
      setSeconds(0);
      setRecording(true);
      recorder.start();
    } catch {
      toast.error("No fue posible acceder al micrófono.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const useCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("El navegador no admite compartir la ubicación.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocating(false);
        toast.success("Ubicación capturada. Revise y envíe.");
      },
      () => {
        setLocating(false);
        toast.error("No fue posible obtener la ubicación del dispositivo.");
      },
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  };

  const submit = async () => {
    if (kind === "file") {
      if (!file) {
        toast.error("Adjunte un archivo para enviar.");
        return;
      }
      const dataBase64 = await blobToBase64(file);
      onSubmit({
        kind: "file",
        dataBase64,
        fileName: file.name,
        caption: caption.trim() || undefined,
      });
      return;
    }
    if (kind === "ptt") {
      const blob = clipRef.current;
      if (!blob) {
        toast.error("Grabe una nota de voz para enviar.");
        return;
      }
      const dataBase64 = await blobToBase64(blob);
      const mimeType = blob.type || "audio/webm";
      onSubmit({
        kind: "ptt",
        dataBase64,
        mimeType,
        fileName: `nota-de-voz.${extensionForMimeType(mimeType)}`,
      });
      return;
    }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      toast.error("Indique una latitud y una longitud válidas.");
      return;
    }
    onSubmit({
      kind: "location",
      latitude: lat,
      longitude: lon,
      address: address.trim() || undefined,
    });
  };

  return (
    <>
      {kind === "file" ? (
        <div className="space-y-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInput.current?.click();
              }
            }}
            onDragOver={event => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => {
              event.preventDefault();
              setDragging(false);
              acceptFile(event.dataTransfer.files?.[0]);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-primary/60"
            }`}
          >
            <FileUp className="h-6 w-6 text-primary" />
            <p className="text-sm font-semibold">
              Arrastre el archivo aquí
            </p>
            <p className="text-xs text-muted-foreground">
              o haga clic para elegirlo desde su equipo
            </p>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={event => acceptFile(event.target.files?.[0])}
            />
          </div>
          {file ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-muted/55 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSize(file.size)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full"
                onClick={() => setFile(null)}
                aria-label="Quitar archivo"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Texto adjunto</Label>
            <Textarea
              value={caption}
              onChange={event => setCaption(event.target.value)}
              rows={2}
              placeholder="Opcional"
            />
          </div>
        </div>
      ) : kind === "ptt" ? (
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-muted-foreground/20 p-6">
            <Button
              type="button"
              variant={recording ? "destructive" : "default"}
              className="h-16 w-16 rounded-full"
              disabled={pending}
              onClick={recording ? stopRecording : startRecording}
              aria-label={recording ? "Detener grabación" : "Grabar nota de voz"}
            >
              {recording ? (
                <Square className="h-6 w-6" />
              ) : (
                <Mic className="h-6 w-6" />
              )}
            </Button>
            <p className="text-sm font-semibold">
              {recording
                ? `Grabando… ${formatDuration(seconds)}`
                : clipUrl
                  ? "Nota de voz lista"
                  : "Grabe su nota de voz"}
            </p>
            <p className="text-xs text-muted-foreground">
              {recording
                ? "Hable con claridad y detenga al terminar."
                : "Use el micrófono del equipo; la grabación se adjunta a la conversación."}
            </p>
          </div>
          {clipUrl ? (
            <div className="flex items-center gap-3 rounded-2xl bg-muted/55 p-3">
              <audio controls src={clipUrl} className="h-9 w-full" />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full"
                onClick={releaseClip}
                aria-label="Descartar nota de voz"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-2xl"
            disabled={locating || pending}
            onClick={useCurrentLocation}
          >
            <Crosshair className="mr-2 h-4 w-4" />
            {locating ? "Obteniendo ubicación…" : "Usar mi ubicación actual"}
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Latitud</Label>
              <Input
                value={latitude}
                onChange={event => setLatitude(event.target.value)}
                inputMode="decimal"
                placeholder="-90 a 90"
              />
            </div>
            <div className="space-y-2">
              <Label>Longitud</Label>
              <Input
                value={longitude}
                onChange={event => setLongitude(event.target.value)}
                inputMode="decimal"
                placeholder="-180 a 180"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Dirección</Label>
              <Input
                value={address}
                onChange={event => setAddress(event.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          disabled={pending || recording}
          onClick={() => void submit()}
          className="rounded-full"
        >
          {pending ? "Enviando…" : "Enviar"}
        </Button>
      </DialogFooter>
    </>
  );
}
