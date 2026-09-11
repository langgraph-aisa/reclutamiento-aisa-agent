export const ASSESSMENT_LEVELS = [
  { value: "nivel", label: "Prueba de nivel" },
  { value: "basica", label: "Prueba básica" },
  { value: "tecnica", label: "Prueba técnica" },
  { value: "avanzada", label: "Prueba avanzada" },
] as const;

const governanceDomains = [
  {
    code: "GOB",
    label: "Gobierno",
    controls: [
      "Propósito de uso definido y aprobado",
      "Responsable humano identificado",
      "Alcance poblacional documentado",
      "Decisión automatizada expresamente limitada",
      "Riesgos de uso registrados",
      "Excepciones sometidas a revisión",
      "Retención y eliminación documentadas",
      "Revisión periódica programada",
    ],
  },
  {
    code: "CON",
    label: "Constructo",
    controls: [
      "Constructo laboral definido operacionalmente",
      "Dimensiones diferenciadas sin ambigüedad",
      "Indicadores observables vinculados al puesto",
      "Contenido ajeno al constructo excluido",
      "Inferencias clínicas expresamente prohibidas",
      "Inferencias emocionales no validadas prohibidas",
      "Hipótesis y límites documentados",
      "Evidencia de validez identificada",
    ],
  },
  {
    code: "PUE",
    label: "Relación con el puesto",
    controls: [
      "Perfil laboral vigente vinculado",
      "Responsabilidad del puesto trazada",
      "Requisito obligatorio trazado",
      "Nivel de dificultad justificado",
      "Pregunta vinculada a competencia definida",
      "Criterio de evaluación observable",
      "Relevancia empresarial documentada",
      "Revisión de experto del puesto registrada",
    ],
  },
  {
    code: "ITE",
    label: "Ítems",
    controls: [
      "Una idea completa por pregunta",
      "Instrucción inequívoca y formal",
      "Lenguaje comprensible para la población",
      "Ausencia de contenido discriminatorio",
      "Ausencia de atributos sensibles",
      "Opciones mutuamente coherentes",
      "Orden versionado y reproducible",
      "Criterio separado de la respuesta",
    ],
  },
  {
    code: "ADM",
    label: "Administración",
    controls: [
      "Saludo institucional versionado",
      "Despedida institucional versionada",
      "Modo de ejecución explícito",
      "Una pregunta activa a la vez",
      "Reanudación idempotente de sesión",
      "Finalización persistida y verificable",
      "Traspaso humano con precondición",
      "Accesibilidad de interacción comprobada",
    ],
  },
  {
    code: "PUN",
    label: "Puntuación y equidad",
    controls: [
      "Escala y ponderación documentadas",
      "Regla de cálculo determinista",
      "Datos faltantes diferenciados de fallos",
      "Incertidumbre visible para revisión",
      "Comparabilidad entre versiones controlada",
      "Impacto adverso evaluado periódicamente",
      "Adaptación cultural y lingüística revisada",
      "Decisión final reservada al equipo humano",
    ],
  },
  {
    code: "OBS",
    label: "Observabilidad",
    controls: [
      "Modelo y versión registrados",
      "Instrucción y versión registradas",
      "Correlación técnica por ejecución",
      "Consumo y latencia medidos",
      "Errores clasificados sin secretos",
      "Reintentos limitados e idempotentes",
      "Cambios incluidos en bitácora",
      "Indicadores operativos disponibles",
    ],
  },
  {
    code: "SUP",
    label: "Supervisión y seguridad",
    controls: [
      "Oferta salarial automática bloqueada",
      "Datos sensibles minimizados",
      "Acceso sujeto a rol",
      "Credenciales cifradas y enmascaradas",
      "Archivos sometidos a cuota y tipo",
      "Anulación humana siempre disponible",
      "Incidente con ruta de escalamiento",
      "Aprobación metodológica anterior a publicación",
    ],
  },
] as const;

export const ASSESSMENT_GOVERNANCE_RULES = governanceDomains.flatMap(
  domain =>
    domain.controls.map((label, index) => ({
      id: `${domain.code}-${String(index + 1).padStart(2, "0")}`,
      domain: domain.label,
      label,
    }))
);

if (ASSESSMENT_GOVERNANCE_RULES.length !== 64) {
  throw new Error("El catálogo de gobierno debe contener exactamente 64 criterios.");
}

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
