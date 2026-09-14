export const ASSESSMENT_LEVELS = [
  { value: "nivel", label: "Prueba de nivel" },
  { value: "basica", label: "Prueba básica" },
  { value: "tecnica", label: "Prueba técnica" },
  { value: "avanzada", label: "Prueba avanzada" },
] as const;

export type GovernanceAccent = {
  /** Marco exterior de la categoría. */
  frame: string;
  /** Título de la categoría. */
  header: string;
  /** Etiqueta y distintivo de la categoría. */
  chip: string;
  /** Punto de color del distintivo. */
  dot: string;
};

export type GovernanceControlDefinition = {
  label: string;
  summary: string;
  traceSurface: string;
};

export type GovernanceDomainDefinition = {
  code: string;
  label: string;
  summary: string;
  accent: GovernanceAccent;
  controls: GovernanceControlDefinition[];
};

const governanceDomains: GovernanceDomainDefinition[] = [
  {
    code: "GOB",
    label: "Gobierno",
    summary:
      "El propósito de uso, la responsabilidad y la vigencia se aprueban antes de publicar el instrumento.",
    accent: {
      frame: "border-amber-300/70 bg-amber-50/40",
      header: "text-amber-900",
      chip: "border-amber-200 bg-amber-100/70 text-amber-900",
      dot: "bg-amber-500",
    },
    controls: [
      {
        label: "Propósito de uso definido y aprobado",
        summary:
          "El protocolo declara qué decisión respalda y qué autoridad la aprueba antes de su publicación.",
        traceSurface: "Apertura de traza de evaluación con versión del protocolo",
      },
      {
        label: "Responsable humano identificado",
        summary:
          "Cada versión designa a la persona responsable de su contenido y de su vigencia.",
        traceSurface: "Identificador de autor responsable en los metadatos de la traza",
      },
      {
        label: "Alcance poblacional documentado",
        summary:
          "Se describe la población destinataria y las exclusiones conocidas del alcance.",
        traceSurface: "Clasificación de la sesión con plaza y perfil vinculados",
      },
      {
        label: "Decisión automatizada expresamente limitada",
        summary:
          "El sistema clasifica y propone revisión; no decide contratación por sí mismo.",
        traceSurface: "Guardrail de política salarial y cierre del grafo de evaluación",
      },
      {
        label: "Riesgos de uso registrados",
        summary:
          "Los riesgos conocidos quedan anotados junto con su mitigación declarada.",
        traceSurface: "Evento de error clasificado sin exponer secretos",
      },
      {
        label: "Excepciones sometidas a revisión",
        summary:
          "Toda excepción al procedimiento pasa por revisión humana documentada.",
        traceSurface: "Span de traspaso humano con precondición verificada",
      },
      {
        label: "Retención y eliminación documentadas",
        summary:
          "Se define cuánto se conserva cada registro y cómo se elimina de forma verificable.",
        traceSurface: "Bitácora de borrado con desafío por código temporal",
      },
      {
        label: "Revisión periódica programada",
        summary:
          "La vigencia se revisa en intervalos declarados y con evidencia registrada.",
        traceSurface: "Correlación de fecha y versión en la bitácora de actividad",
      },
    ],
  },
  {
    code: "CON",
    label: "Constructo",
    summary:
      "Delimita qué se evalúa y qué queda expresamente fuera del alcance del instrumento.",
    accent: {
      frame: "border-indigo-300/70 bg-indigo-50/40",
      header: "text-indigo-900",
      chip: "border-indigo-200 bg-indigo-100/70 text-indigo-900",
      dot: "bg-indigo-500",
    },
    controls: [
      {
        label: "Constructo laboral definido operacionalmente",
        summary:
          "El rasgo evaluado se describe mediante conductas observables del puesto.",
        traceSurface: "Instrucción versionada del nodo evaluador del grafo",
      },
      {
        label: "Dimensiones diferenciadas sin ambigüedad",
        summary:
          "Las dimensiones se separan y no se funden en una puntuación opaca.",
        traceSurface: "Desglose de bloques en la salida estructurada del grafo",
      },
      {
        label: "Indicadores observables vinculados al puesto",
        summary:
          "Cada indicador deriva de responsabilidades reales del perfil laboral.",
        traceSurface: "Metadatos de vinculación entre plaza y perfil laboral",
      },
      {
        label: "Contenido ajeno al constructo excluido",
        summary:
          "Se retira el contenido que no mide la competencia declarada.",
        traceSurface: "Validación determinista previa a la ejecución del grafo",
      },
      {
        label: "Inferencias clínicas expresamente prohibidas",
        summary:
          "La interfaz impide conclusiones sobre salud mental de la persona.",
        traceSurface: "Política de redacción aplicada a los metadatos de la traza",
      },
      {
        label: "Inferencias emocionales no validadas prohibidas",
        summary:
          "No se deduce estado emocional a partir de la conversación registrada.",
        traceSurface: "Política de redacción aplicada a los metadatos de la traza",
      },
      {
        label: "Hipótesis y límites documentados",
        summary:
          "Se declaran los supuestos y aquello que el instrumento no puede afirmar.",
        traceSurface: "Versión del protocolo y de la instrucción en la traza",
      },
      {
        label: "Evidencia de validez identificada",
        summary:
          "Se referencia la evidencia disponible y sus carencias conocidas.",
        traceSurface: "Evidencia metodológica asociada al protocolo activo",
      },
    ],
  },
  {
    code: "PUE",
    label: "Relación con el puesto",
    summary:
      "Vincula cada pregunta con el perfil, las responsabilidades y los requisitos del puesto.",
    accent: {
      frame: "border-emerald-300/70 bg-emerald-50/40",
      header: "text-emerald-900",
      chip: "border-emerald-200 bg-emerald-100/70 text-emerald-900",
      dot: "bg-emerald-500",
    },
    controls: [
      {
        label: "Perfil laboral vigente vinculado",
        summary:
          "El protocolo se asocia a un perfil laboral vigente y localizable.",
        traceSurface: "Metadatos de plaza, perfil y versión en la traza",
      },
      {
        label: "Responsabilidad del puesto trazada",
        summary:
          "Cada pregunta se justifica desde una responsabilidad del puesto.",
        traceSurface: "Metadatos de vinculación entre pregunta y responsabilidad",
      },
      {
        label: "Requisito obligatorio trazado",
        summary:
          "Los requisitos obligatorios del perfil se reflejan en la evaluación.",
        traceSurface: "Validación determinista de requisitos antes del grafo",
      },
      {
        label: "Nivel de dificultad justificado",
        summary:
          "La dificultad declarada responde al nivel del puesto solicitado.",
        traceSurface: "Nivel del protocolo registrado en la traza",
      },
      {
        label: "Pregunta vinculada a competencia definida",
        summary:
          "Toda pregunta pertenece a una competencia declarada del perfil.",
        traceSurface: "Metadatos de competencia por ítem en la traza",
      },
      {
        label: "Criterio de evaluación observable",
        summary:
          "El criterio describe una conducta verificable y no una impresión.",
        traceSurface: "Criterio versionado del nodo evaluador",
      },
      {
        label: "Relevancia empresarial documentada",
        summary:
          "La utilidad de la evaluación para el puesto queda documentada.",
        traceSurface: "Resumen de contribución generado por el agente",
      },
      {
        label: "Revisión de experto del puesto registrada",
        summary:
          "Una persona experta revisa la vinculación con el puesto y la firma.",
        traceSurface: "Identificador de revisor en la bitácora de actividad",
      },
    ],
  },
  {
    code: "ITE",
    label: "Ítems",
    summary:
      "Asegura preguntas claras, formales y reproducibles para la población destinataria.",
    accent: {
      frame: "border-violet-300/70 bg-violet-50/40",
      header: "text-violet-900",
      chip: "border-violet-200 bg-violet-100/70 text-violet-900",
      dot: "bg-violet-500",
    },
    controls: [
      {
        label: "Una idea completa por pregunta",
        summary:
          "Cada pregunta aborda una sola idea y evita la ambigüedad.",
        traceSurface: "Instrucción versionada del nodo evaluador",
      },
      {
        label: "Instrucción inequívoca y formal",
        summary:
          "La instrucción usa tratamiento formal y admite una única interpretación.",
        traceSurface: "Verificación de tratamiento formal durante la compilación",
      },
      {
        label: "Lenguaje comprensible para la población",
        summary:
          "El vocabulario se adapta al nivel educativo de la población destinataria.",
        traceSurface: "Versión del protocolo y de la instrucción en la traza",
      },
      {
        label: "Ausencia de contenido discriminatorio",
        summary:
          "Se excluye contenido capaz de discriminar por atributos ajenos al puesto.",
        traceSurface: "Política de redacción y revisión humana del contenido",
      },
      {
        label: "Ausencia de atributos sensibles",
        summary:
          "No se consultan atributos sensibles sin base legal declarada.",
        traceSurface: "Minimización de metadatos y de datos sensibles",
      },
      {
        label: "Opciones mutuamente coherentes",
        summary:
          "Las opciones de respuesta son excluyentes y comparables entre sí.",
        traceSurface: "Validación determinista de respuestas aceptadas",
      },
      {
        label: "Orden versionado y reproducible",
        summary:
          "El orden de las preguntas se versiona y se reproduce igual en cada sesión.",
        traceSurface: "Orden de ítems y versión registrados en la traza",
      },
      {
        label: "Criterio separado de la respuesta",
        summary:
          "El criterio de evaluación no se entrega al navegador de la persona.",
        traceSurface: "Propiedad intelectual protegida en la carga pública",
      },
    ],
  },
  {
    code: "ADM",
    label: "Administración",
    summary:
      "La ejecución de la sesión, la reanudación y el traspaso a una persona se ordenan en la versión.",
    accent: {
      frame: "border-sky-300/70 bg-sky-50/40",
      header: "text-sky-900",
      chip: "border-sky-200 bg-sky-100/70 text-sky-900",
      dot: "bg-sky-500",
    },
    controls: [
      {
        label: "Saludo institucional versionado",
        summary:
          "El saludo pertenece a la versión y se reproduce sin variaciones.",
        traceSurface: "Versión del protocolo en la traza de sesión",
      },
      {
        label: "Despedida institucional versionada",
        summary:
          "La despedida pertenece a la versión y se conserva íntegra.",
        traceSurface: "Versión del protocolo en la traza de sesión",
      },
      {
        label: "Modo de ejecución explícito",
        summary:
          "El modo de espera o de evaluación inmediata queda declarado.",
        traceSurface: "Modo de ejecución registrado en la traza",
      },
      {
        label: "Una pregunta activa a la vez",
        summary:
          "La sesión mantiene una sola pregunta activa en cada momento.",
        traceSurface: "Estado del grafo y avance de ítems",
      },
      {
        label: "Reanudación idempotente de sesión",
        summary:
          "Retomar una sesión no duplica preguntas ni respuestas registradas.",
        traceSurface: "Reintentos limitados e idempotentes del grafo",
      },
      {
        label: "Finalización persistida y verificable",
        summary:
          "El cierre de la sesión se persiste con evidencia consultable.",
        traceSurface: "Persistencia y clasificación final en la traza",
      },
      {
        label: "Traspaso humano con precondición",
        summary:
          "El traspaso a una persona exige una condición verificada previamente.",
        traceSurface: "Span de traspaso humano con precondición",
      },
      {
        label: "Accesibilidad de interacción comprobada",
        summary:
          "La interacción admite canales y formatos accesibles a la población.",
        traceSurface: "Cobertura de canales registrada por operación",
      },
    ],
  },
  {
    code: "PUN",
    label: "Puntuación y equidad",
    summary:
      "Documenta el cálculo, la incertidumbre y la equidad de la puntuación obtenida.",
    accent: {
      frame: "border-rose-300/70 bg-rose-50/40",
      header: "text-rose-900",
      chip: "border-rose-200 bg-rose-100/70 text-rose-900",
      dot: "bg-rose-500",
    },
    controls: [
      {
        label: "Escala y ponderación documentadas",
        summary:
          "La escala y el peso de cada componente quedan documentados.",
        traceSurface: "Uso y parámetros de modelo registrados en la traza",
      },
      {
        label: "Regla de cálculo determinista",
        summary:
          "La puntuación se calcula con una regla reproducible y auditable.",
        traceSurface: "Cálculo determinista previo a la clasificación",
      },
      {
        label: "Datos faltantes diferenciados de fallos",
        summary:
          "La ausencia de un dato no se interpreta como error de la persona.",
        traceSurface: "Clasificación de errores y de respuestas incompletas",
      },
      {
        label: "Incertidumbre visible para revisión",
        summary:
          "La incertidumbre del resultado se muestra a quien revisa la postulación.",
        traceSurface: "Nivel de confianza y motivo en la salida del grafo",
      },
      {
        label: "Comparabilidad entre versiones controlada",
        summary:
          "Se controla la comparación entre versiones distintas del protocolo.",
        traceSurface: "Versión de formulario y de protocolo en la evaluación",
      },
      {
        label: "Impacto adverso evaluado periódicamente",
        summary:
          "Se revisa de forma periódica si el resultado perjudica a algún grupo.",
        traceSurface: "Agregados de clasificación disponibles para revisión",
      },
      {
        label: "Adaptación cultural y lingüística revisada",
        summary:
          "La adaptación al contexto y al idioma se revisa y se documenta.",
        traceSurface: "Ambiente y versión lingüística en la traza",
      },
      {
        label: "Decisión final reservada al equipo humano",
        summary:
          "La decisión final permanece en el equipo humano responsable.",
        traceSurface: "Estado final sujeto a revisión humana",
      },
    ],
  },
  {
    code: "OBS",
    label: "Observabilidad",
    summary:
      "Registra modelo, instrucción, consumo, errores y cambios de cada ejecución.",
    accent: {
      frame: "border-cyan-300/70 bg-cyan-50/40",
      header: "text-cyan-900",
      chip: "border-cyan-200 bg-cyan-100/70 text-cyan-900",
      dot: "bg-cyan-500",
    },
    controls: [
      {
        label: "Modelo y versión registrados",
        summary:
          "Cada ejecución registra el modelo y la versión utilizados.",
        traceSurface: "Generación con modelo y versión en la traza",
      },
      {
        label: "Instrucción y versión registradas",
        summary:
          "La instrucción aplicada queda identificada con su versión.",
        traceSurface: "Nombre y versión de la observación en Langfuse",
      },
      {
        label: "Correlación técnica por ejecución",
        summary:
          "Cada ejecución conserva un identificador de correlación consultable.",
        traceSurface: "Identificador de traza y de span por operación",
      },
      {
        label: "Consumo y latencia medidos",
        summary:
          "El consumo y la latencia se registran sin datos personales.",
        traceSurface: "Uso y duración agregados en la traza",
      },
      {
        label: "Errores clasificados sin secretos",
        summary:
          "Los errores se clasifican por código seguro y sin credenciales.",
        traceSurface: "Evento de error redactado antes de exportar",
      },
      {
        label: "Reintentos limitados e idempotentes",
        summary:
          "Los reintentos están acotados y no duplican operaciones.",
        traceSurface: "Intentos y ranura de credencial en la traza",
      },
      {
        label: "Cambios incluidos en bitácora",
        summary:
          "Los cambios de configuración se registran en la bitácora institucional.",
        traceSurface: "Correlación de configuración en la bitácora de actividad",
      },
      {
        label: "Indicadores operativos disponibles",
        summary:
          "Existen indicadores de error, latencia y costo consultables.",
        traceSurface: "Tableros y alertas de Langfuse por ambiente",
      },
    ],
  },
  {
    code: "SUP",
    label: "Supervisión y seguridad",
    summary:
      "Protege datos, credenciales y decisiones con supervisión humana permanente.",
    accent: {
      frame: "border-red-300/70 bg-red-50/40",
      header: "text-red-900",
      chip: "border-red-200 bg-red-100/70 text-red-900",
      dot: "bg-red-500",
    },
    controls: [
      {
        label: "Oferta salarial automática bloqueada",
        summary:
          "El agente no puede ofrecer condiciones salariales por sí mismo.",
        traceSurface: "Guardrail de política salarial dentro del grafo",
      },
      {
        label: "Datos sensibles minimizados",
        summary:
          "Se recolecta solo el dato necesario para la finalidad declarada.",
        traceSurface: "Redacción de entradas y salidas antes de exportar",
      },
      {
        label: "Acceso sujeto a rol",
        summary:
          "El acceso a la información exige un rol autorizado y verificable.",
        traceSurface: "Control de rol previo a cada procedimiento",
      },
      {
        label: "Credenciales cifradas y enmascaradas",
        summary:
          "Las credenciales se cifran y nunca se devuelven al navegador.",
        traceSurface: "Claves ausentes en la traza exportada",
      },
      {
        label: "Archivos sometidos a cuota y tipo",
        summary:
          "Los archivos adjuntos respetan cuota y tipo permitidos.",
        traceSurface: "Tipo y tamaño de operación registrados",
      },
      {
        label: "Anulación humana siempre disponible",
        summary:
          "Una persona puede detener o corregir el proceso en cualquier momento.",
        traceSurface: "Span de anulación y de traspaso humano",
      },
      {
        label: "Incidente con ruta de escalamiento",
        summary:
          "Todo incidente declara una ruta de escalamiento responsable.",
        traceSurface: "Código de error con ruta de escalamiento",
      },
      {
        label: "Aprobación metodológica anterior a publicación",
        summary:
          "La publicación exige aprobación metodológica previa y registrada.",
        traceSurface: "Estado de activación con evidencia registrada",
      },
    ],
  },
];

export const ASSESSMENT_GOVERNANCE_DOMAINS = governanceDomains.map(domain => ({
  code: domain.code,
  label: domain.label,
  summary: domain.summary,
  accent: { ...domain.accent },
  controlCount: domain.controls.length,
}));

export const ASSESSMENT_GOVERNANCE_RULES = governanceDomains.flatMap(domain =>
  domain.controls.map((control, index) => ({
    id: `${domain.code}-${String(index + 1).padStart(2, "0")}`,
    domain: domain.label,
    domainCode: domain.code,
    label: control.label,
    summary: control.summary,
    traceSurface: control.traceSurface,
  }))
);

if (ASSESSMENT_GOVERNANCE_RULES.length !== 64) {
  throw new Error(
    "El catálogo de gobierno debe contener exactamente 64 criterios."
  );
}

export const GOVERNANCE_MONITORING_NOTICE =
  "Cada política describe un criterio de gobierno y declara la superficie observable que permite verificarla. El registro de trazabilidad respalda la auditoría interna; no acredita cumplimiento normativo ni sustituye una revisión independiente.";

export const ASSESSMENT_METHODOLOGY_NOTICE =
  "Una pregunta generada por IA, una conversación adaptativa o una puntuación de 0 a 100 no constituyen por sí mismas una prueba psicométrica. La activación requiere constructo, validez para el uso y población, confiabilidad, equidad, estandarización, adaptación lingüística y supervisión competente documentadas.";

export const PSYCHOMETRIC_EVIDENCE_TERMS = [
  "constructo",
  "validez",
  "confiabilidad",
  "población",
  "equidad",
  "estandarización",
  "aprobación",
] as const;

function normalizedEvidence(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

export function missingPsychometricEvidenceTerms(value: string) {
  const normalized = normalizedEvidence(value);
  return PSYCHOMETRIC_EVIDENCE_TERMS.filter(
    term => !normalized.includes(normalizedEvidence(term))
  );
}

export const ASSESSMENT_STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  activo: "Activo",
  retirado: "Retirado",
};

export const ASSESSMENT_DELETE_TITLE_WORD_LIMIT = 11;
export const ASSESSMENT_DELETE_CODE_TTL_MINUTES = 10;
export const ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS = 5;
export const ASSESSMENT_DELETE_CODE_RESEND_SECONDS = 60;

export type AssessmentDeleteTarget = {
  name: string;
  version: number;
  status: string;
  itemCount?: number | null;
  activeItemCount?: number | null;
};

function deleteTargetNameWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(word => /[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/.test(word));
}

/**
 * Título descriptivo de la acción de borrado, compuesto en tiempo de ejecución
 * a partir del estado, la versión y el nombre registrados; nunca excede el
 * límite institucional de palabras y no incluye texto fijo por protocolo.
 */
export function assessmentDeleteAlertTitle(target: AssessmentDeleteTarget) {
  const statusLabel = (
    ASSESSMENT_STATUS_LABELS[target.status] ?? target.status
  ).toLowerCase();
  const head = ["Eliminar", statusLabel, `v${target.version}`, "de"];
  const tail = ["confirmada", "por", "código"];
  const nameBudget = Math.max(
    1,
    ASSESSMENT_DELETE_TITLE_WORD_LIMIT - head.length - tail.length
  );
  const words = deleteTargetNameWords(target.name);
  const truncated = words.length > nameBudget;
  const namePart = `${words.slice(0, nameBudget).join(" ")}${truncated ? "…" : ""}`;
  return [...head, namePart, ...tail].join(" ");
}

/**
 * Descripción generada desde el registro seleccionado: referencia, estado,
 * versión, preguntas y exigencia del código temporal. Ninguna oración depende
 * de valores literales del protocolo.
 */
export function assessmentDeleteAlertDescription(
  target: AssessmentDeleteTarget
) {
  const statusLabel = (
    ASSESSMENT_STATUS_LABELS[target.status] ?? target.status
  ).toLowerCase();
  const reference = `${target.name} · v${target.version} · ${statusLabel}.`;
  const items =
    target.itemCount != null
      ? `Contiene ${target.itemCount} preguntas registradas y ${target.activeItemCount ?? 0} habilitadas, que se eliminarán junto con la definición versionada.`
      : "Las preguntas asociadas y la definición de esta versión se eliminarán de forma permanente.";
  const requirement =
    "El borrado exige un código temporal de seis dígitos enviado al correo registrado de la sesión actual.";
  return [reference, items, requirement].join(" ");
}
