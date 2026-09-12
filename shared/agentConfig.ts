export const AGENT_MODELS = [
  { value: "gpt-6-astra", label: "GPT-6 Astra · máxima capacidad" },
  { value: "gpt-5.5", label: "GPT-5.5 · razonamiento avanzado" },
  { value: "gpt-5.2", label: "GPT-5.2 · razonamiento avanzado" },
  { value: "gpt-5-mini", label: "GPT-5 mini · equilibrio costo/velocidad" },
  { value: "gpt-4.1", label: "GPT-4.1 · seguimiento de instrucciones" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini · respuesta rápida" },
  { value: "gpt-4o-mini", label: "GPT-4o mini · opción económica" },
] as const;

export const OPENAI_TRANSCRIPTION_MODELS = [
  {
    value: "gpt-4o-mini-transcribe",
    label: "GPT-4o mini Transcribe · opción económica",
  },
  {
    value: "gpt-4o-transcribe",
    label: "GPT-4o Transcribe · mayor precisión",
  },
  { value: "whisper-1", label: "Whisper 1 · compatibilidad heredada" },
] as const;

export const OPENAI_TTS_MODELS = [
  { value: "gpt-4o-mini-tts", label: "GPT-4o mini TTS · recomendado" },
  { value: "tts-1", label: "TTS 1 · baja latencia" },
  { value: "tts-1-hd", label: "TTS 1 HD · mayor calidad" },
] as const;

export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export const OPENAI_API_ENDPOINTS = {
  responses: "https://api.openai.com/v1/responses",
  transcriptions: "https://api.openai.com/v1/audio/transcriptions",
  speech: "https://api.openai.com/v1/audio/speech",
} as const;

export const LANGFUSE_CLOUD_BASE_URLS = [
  "https://us.cloud.langfuse.com",
  "https://cloud.langfuse.com",
  "https://jp.cloud.langfuse.com",
  "https://hipaa.cloud.langfuse.com",
] as const;

export const LANGFUSE_CAPTURE_MODES = ["metadata_only", "redacted"] as const;

export const OPENAI_TRANSCRIPTION_EXTENSIONS = [
  "flac",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "ogg",
  "wav",
  "webm",
] as const;

export const OPENAI_SPEECH_FORMATS = [
  "mp3",
  "opus",
  "aac",
  "flac",
  "wav",
  "pcm",
] as const;

export const ACTIVITY_SUMMARY_WORD_LIMIT = 33;
export const ACTIVITY_TITLE_WORD_LIMIT = 11;
export const JARVI_HR_IDENTITY_EMAIL = "adminit@aisa.com.gt";

export const SALARY_GOVERNANCE_POLICY = `REGLA INALTERABLE DE REMUNERACIÓN: el agente de IA no debe ofrecer, prometer, negociar, sugerir ni inventar salarios, rangos, prestaciones o propuestas económicas. La Gerencia comunica cualquier oferta únicamente durante una entrevista personal. La expectativa salarial del candidato solo puede registrarse cuando aparece de manera explícita en su CV o en un mensaje emitido por la persona; si no existe evidencia literal, debe permanecer en cero y marcarse como no declarada.`;

export const EVALUATION_BLOCKS = [
  {
    id: "identificacion_ajuste",
    label: "Identificación del ajuste",
    weight: 10,
    purpose: "Determina la compatibilidad general con la plaza.",
  },
  {
    id: "evidencia_experiencia",
    label: "Evidencia de experiencia",
    weight: 20,
    purpose: "Comprueba experiencia real y verificable.",
  },
  {
    id: "competencias",
    label: "Competencias técnicas/comerciales",
    weight: 25,
    purpose: "Evaluación de las competencias centrales del puesto.",
  },
  {
    id: "disponibilidad_logistica",
    label: "Disponibilidad y logística",
    weight: 10,
    purpose: "Valora transporte, licencia, horarios y ubicación.",
  },
  {
    id: "riesgos_brechas",
    label: "Riesgos o brechas",
    weight: 20,
    purpose:
      "Identifica deficiencias, inconsistencias o requisitos no comprobados.",
  },
  {
    id: "dictamen_ia",
    label: "Dictamen IA",
    weight: 15,
    purpose: "Integra la evidencia y genera la recomendación final.",
  },
] as const;

export const SCORE_BANDS = [
  {
    min: 90,
    max: 100,
    label: "Precalificado prioritario",
    status: "pre_calificado_prioritario",
  },
  {
    min: 80,
    max: 89,
    label: "Precalificado",
    status: "pre_calificado",
  },
  {
    min: 70,
    max: 79,
    label: "Precalificado condicionado",
    status: "pre_calificado_condicionado",
  },
  {
    min: 60,
    max: 69,
    label: "Revisión humana",
    status: "pendiente_revision_humana",
  },
  {
    min: 0,
    max: 59,
    label: "No precalificado",
    status: "no_calificado",
  },
] as const;

export const DEFAULT_AGENT_INSTRUCTIONS = `Evalúe cada postulación con un modelo porcentual de 100 puntos. No dependa del número exacto de palabras de cada respuesta: asigne el peso según la importancia de la evidencia para la decisión de preselección.

Use estos seis bloques:
1. Identificación del ajuste: 10 %.
2. Evidencia de experiencia: 20 %.
3. Competencias técnicas/comerciales: 25 %.
4. Disponibilidad y logística: 10 %.
5. Riesgos o brechas: 20 %.
6. Dictamen IA: 15 %.

El dictamen debe sintetizar las cinco dimensiones anteriores, citar únicamente evidencia presente en la postulación y separar hechos de inferencias. Entregue una puntuación de 0 a 100 y aplique esta interpretación: 90–100 Precalificado prioritario; 80–89 Precalificado; 70–79 Precalificado condicionado; 60–69 Revisión humana; 0–59 No precalificado.

Una causa crítica de descalificación prevalece siempre sobre el promedio. No infiera edad, género, etnia, religión, salud, discapacidad, orientación sexual, situación familiar ni cualquier otro atributo sensible. Si falta evidencia, indíquelo como requisito por validar.`;

export const DEFAULT_METHODOLOGY_INTERPRETATION = `El mayor peso corresponde a competencias técnicas/comerciales (25 %) porque son el núcleo del desempeño profesional. La evidencia de experiencia (20 %) y la identificación de riesgos o brechas (20 %) tienen el mismo peso porque el sistema debe demostrar tanto lo que el candidato puede hacer como aquello que todavía debe validarse.

El dictamen IA (15 %) no es una opinión independiente: es la síntesis razonada de las cinco dimensiones anteriores.

Para auditoría humana, la IA entrega una puntuación de 0 a 100 y una explicación basada en evidencia. Una causa crítica de descalificación prevalece sobre el promedio cuando exista incumplimiento comprobado de un requisito indispensable del puesto.

El esquema toma MST-EIR/ITEI como referencia para valorar conocimiento, práctica, resolución de problemas, seguridad, competencias digitales y contexto profesional. La recomendación automatizada es apoyo a la preselección y conserva revisión humana.`;

export type AgentModel = (typeof AGENT_MODELS)[number]["value"];
export type OpenAiTranscriptionModel =
  (typeof OPENAI_TRANSCRIPTION_MODELS)[number]["value"];
export type OpenAiTtsModel = (typeof OPENAI_TTS_MODELS)[number]["value"];
export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];
export type LangfuseCloudBaseUrl = (typeof LANGFUSE_CLOUD_BASE_URLS)[number];
export type LangfuseCaptureMode = (typeof LANGFUSE_CAPTURE_MODES)[number];
export type AgentPreferences = {
  model: AgentModel;
  psychometricModel: AgentModel;
  activitySummaryModel: AgentModel;
  transcriptionModel: OpenAiTranscriptionModel;
  ttsModel: OpenAiTtsModel;
  ttsVoice: OpenAiTtsVoice;
  audioMaxMb: number;
  documentMaxMb: number;
  instructions: string;
  summaryWordLimit: number;
  useMethodologies: boolean;
  useResponsesApi: boolean;
  methodologyInterpretation: string;
  langfuseEnabled: boolean;
  langfuseBaseUrl: LangfuseCloudBaseUrl;
  langfuseEnvironment: string;
  langfuseCaptureMode: LangfuseCaptureMode;
  langfuseSampleRate: number;
};

export const DEFAULT_AGENT_SETTINGS: AgentPreferences = {
  model: "gpt-5.2",
  psychometricModel: "gpt-4.1-mini",
  activitySummaryModel: "gpt-4o-mini",
  transcriptionModel: "gpt-4o-mini-transcribe",
  ttsModel: "gpt-4o-mini-tts",
  ttsVoice: "coral",
  audioMaxMb: 5,
  documentMaxMb: 5,
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  summaryWordLimit: 180,
  useMethodologies: true,
  useResponsesApi: false,
  methodologyInterpretation: DEFAULT_METHODOLOGY_INTERPRETATION,
  langfuseEnabled: true,
  langfuseBaseUrl: "https://us.cloud.langfuse.com",
  langfuseEnvironment: "production",
  langfuseCaptureMode: "metadata_only",
  langfuseSampleRate: 1,
};
