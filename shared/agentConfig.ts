export const AGENT_MODELS = [
  { value: "gpt-6-astra", label: "GPT-6 Astra · máxima capacidad" },
  { value: "gpt-5.5", label: "GPT-5.5 · razonamiento avanzado" },
  { value: "gpt-5.2", label: "GPT-5.2 · razonamiento avanzado" },
  { value: "gpt-5-mini", label: "GPT-5 mini · equilibrio costo/velocidad" },
  { value: "gpt-4.1", label: "GPT-4.1 · seguimiento de instrucciones" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini · respuesta rápida" },
  { value: "gpt-4o-mini", label: "GPT-4o mini · opción económica" },
] as const;

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
    purpose: "Evalúa las competencias centrales del puesto.",
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
  { min: 90, max: 100, label: "Precalificado prioritario" },
  { min: 80, max: 89, label: "Precalificado" },
  { min: 70, max: 79, label: "Precalificado condicionado" },
  { min: 60, max: 69, label: "Revisión humana" },
  { min: 0, max: 59, label: "No precalificado" },
] as const;

export const DEFAULT_AGENT_INSTRUCTIONS = `Evalúa cada postulación con un modelo porcentual de 100 puntos. No dependas del número exacto de palabras de cada respuesta: asigna el peso según la importancia de la evidencia para la decisión de preselección.

Usa estos seis bloques:
1. Identificación del ajuste: 10 %.
2. Evidencia de experiencia: 20 %.
3. Competencias técnicas/comerciales: 25 %.
4. Disponibilidad y logística: 10 %.
5. Riesgos o brechas: 20 %.
6. Dictamen IA: 15 %.

El dictamen debe sintetizar las cinco dimensiones anteriores, citar únicamente evidencia presente en la postulación y separar hechos de inferencias. Entrega una puntuación de 0 a 100 y aplica esta interpretación: 90–100 Precalificado prioritario; 80–89 Precalificado; 70–79 Precalificado condicionado; 60–69 Revisión humana; 0–59 No precalificado.

Una causa crítica de descalificación prevalece siempre sobre el promedio. No infieras edad, género, etnia, religión, salud, discapacidad, orientación sexual, situación familiar ni cualquier otro atributo sensible. Si falta evidencia, indícalo como requisito por validar.`;

export const DEFAULT_METHODOLOGY_INTERPRETATION = `El mayor peso corresponde a competencias técnicas/comerciales (25 %) porque son el núcleo del desempeño profesional. La evidencia de experiencia (20 %) y la identificación de riesgos o brechas (20 %) tienen el mismo peso porque el sistema debe demostrar tanto lo que el candidato puede hacer como aquello que todavía debe validarse.

El dictamen IA (15 %) no es una opinión independiente: es la síntesis razonada de las cinco dimensiones anteriores.

Para auditoría humana, la IA entrega una puntuación de 0 a 100 y una explicación basada en evidencia. Una causa crítica de descalificación prevalece sobre el promedio cuando exista incumplimiento comprobado de un requisito indispensable del puesto.

El esquema toma MST-EIR/ITEI como referencia para valorar conocimiento, práctica, resolución de problemas, seguridad, competencias digitales y contexto profesional. La recomendación automatizada es apoyo a la preselección y conserva revisión humana.`;

export type AgentModel = (typeof AGENT_MODELS)[number]["value"];
export type AgentPreferences = {
  model: AgentModel;
  instructions: string;
  summaryWordLimit: number;
  useMethodologies: boolean;
  useResponsesApi: boolean;
  methodologyInterpretation: string;
  langfuseBaseUrl: string;
};

export const DEFAULT_AGENT_SETTINGS: AgentPreferences = {
  model: "gpt-5.2",
  instructions: DEFAULT_AGENT_INSTRUCTIONS,
  summaryWordLimit: 180,
  useMethodologies: true,
  useResponsesApi: false,
  methodologyInterpretation: DEFAULT_METHODOLOGY_INTERPRETATION,
  langfuseBaseUrl: "https://cloud.langfuse.com",
};
