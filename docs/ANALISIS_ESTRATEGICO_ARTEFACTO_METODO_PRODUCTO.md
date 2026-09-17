# Análisis estratégico-conceptual: artefacto, método, funciones y producto final

Fecha: 2026-09-17. Rama objetivo: `main`. Alcance referido: JARVI RH 2.0.154.
Este documento describe, en el marco de la ingeniería de software, el concepto
estratégico del **artefacto**, el **método** y las **funciones**, el **producto
final** objeto del aplicativo, y fija los marcos **epistemológico**,
**ontológico** y **fenomenológico** con respecto al usuario final y a la
organización que lo usa a nivel industrial, según lo declarado por los métodos
DORA e ISO referenciados por el proyecto.

---

## 1. Concepto estratégico del artefacto

El artefacto es **JARVI RH / Talento AISA**, un sistema sociotécnico de
reclutamiento automatizado especializado en energía solar, refrigeración
ecoeficiente y bombeo agrícola, que vincula talento técnico con proyectos
industriales de Alternativas Inteligentes, S. A. (AISA) en Guatemala.

Estratégicamente, el artefacto **no es un motor de contratación**: es una
infraestructura de **decisión asistida y gobernada**. Automatiza el trabajo
repetitivo (captura, verificación determinista, razonamiento preliminar,
solicitud de CV, trazabilidad, auditoría) **sin transferir** al modelo la
responsabilidad institucional de contratar, fijar remuneración o atribuir rasgos
psicológicos. La decisión permanece en el personal autorizado.

Su composición material:

| Capa | Tecnología | Papel estratégico |
| --- | --- | --- |
| Interfaz pública | React 19 + Tailwind 4 | Experiencia de postulación mobile-first |
| Panel interno | React + DashboardLayout | Gobierno y operación administrativa |
| API | Express 4 + tRPC 11 | Validación, autorización, transacciones |
| Datos | PostgreSQL | **Fuente de verdad** de configuración y operación |
| Evaluación | LangGraph + LangChain + OpenAI Responses API | Razonamiento estructurado y trazable |
| Mensajería | ApiChat / WhatsApp | Canal conversacional con el candidato |
| Observabilidad | Langfuse SDK 5.11.1 + OpenTelemetry | Trazas, gobernanza y auditoría |

El artefacto se concibe como **sistema híbrido de tres regímenes**:

1. **Determinismo de contrato:** Zod, listas cerradas, transacciones, bloqueos
   consultivos, reglas de descarte, política salarial y cálculo de puntuación.
2. **Inferencia probabilística:** el modelo interpreta evidencia abierta; su
   salida puede variar y **no equivale a un hecho verificado**.
3. **Gobierno humano:** una recomendación no contrata, no fija salario y no
   sustituye la entrevista ni la decisión institucional.

---

## 2. El método

El método integra **práctica de ingeniería** con **referentes normativos** de
uso industrial, sin afirmar certificación.

### 2.1 Método de construcción

- **Verificación por restricción, no por confianza:** unicidades, `CHECK`,
  claves foráneas con cascada, transacciones `BEGIN`/`COMMIT`/`ROLLBACK`,
  idempotencia por diseño (`ON CONFLICT DO NOTHING`).
- **Separación de planos:** consulta (`reviewWorkspace`), decisión
  (`setStatus`), navegación, eventos. La escritura conserva permisos, bloqueo de
  fila, transacción, auditoría y semántica de envío único.
- **Procedencia obligatoria:** modelo, configuración, resultado, actor, entidad
  y tiempo asociados a un evento reconstruible.
- **Seguridad en profundidad:** bóveda AES-256-GCM, secretos nunca en repositorio,
  poscondiciones de servidor, filtros léxicos, fallo cerrado.
- **Defensa de know-how:** el navegador recibe solo lo necesario para representar
  la pregunta; respuestas aceptadas, criterios e instrucciones permanecen en el
  servidor.

### 2.2 Método DORA (DevOps Research and Assessment)

**Naturaleza del marco.** DORA es un programa de investigación iniciado por
Google Cloud y mantenido en `dora.dev`; no ofrece una certificación de software.
Su modelo de desempeño de entrega clasifica equipos en conglomerados (Elite,
High, Medium, Low) mediante métricas observables, con respaldo académico en
Forsgren, Humble y Kim (*Accelerate*, 2018). La guía exige medir **por
aplicación o servicio** y evitar comparaciones descontextualizadas.

**Las cinco métricas canónicas y sus datos técnicos:**

| Métrica canónica | Definición | Datos requeridos |
| --- | --- | --- |
| Deployment Frequency | Despliegues exitosos a producción por período | Evento de despliegue con servicio, ambiente y sello de tiempo |
| Lead Time for Changes | Tiempo desde el commit hasta correr en producción | Marca de commit y de despliegue exitoso del mismo cambio (mediana) |
| Change Failure Rate | Proporción de cambios que causan fallo (rollback, hotfix, degradación) | Clasificación del resultado de cada despliegue y su vínculo con incidentes |
| Failed Deployment Recovery Time | Tiempo para recuperarse de un despliegue fallido | Marca de fallo y de recuperación del despliegue |
| Time to Restore Service | Tiempo desde un incidente hasta la restauración del servicio | Incidentes con `detected_at` y `restored_at` |

**Nota de alineación de nomenclatura:** la tabla interna del proyecto denomina
la quinta fila «tasa de retrabajo de despliegue»; la guía canónica la denomina
**Time to Restore Service**, mientras que **Failed Deployment Recovery Time** es
la métrica incorporada en 2024. Son métricas distintas y conviene alinear la
nomenclatura con `dora.dev`.

**Capacidades habilitadoras ≠ métricas.** El proyecto ya dispone de
**capacidades habilitadoras parciales**: control de versiones, migraciones
versionadas (diario Drizzle), pruebas automatizadas (310 de 310 Vitest, 21 de 21
caja negra) y build reproducible. Estas preparan la medición, pero no la
sustituyen.

**Por qué las cinco métricas quedan parciales o pendientes.** El repositorio no
ingiere canónicamente los eventos de despliegue e incidentes. Cada métrica exige
una tubería de datos propia:

1. **Frecuencia de despliegue:** flujo de despliegues exitosos con servicio,
   ambiente y sello de tiempo.
2. **Tiempo de entrega:** unión fiable `commit → despliegue exitoso` del mismo
   cambio; cálculo de la mediana.
3. **Tasa de fallos:** clasificación de cada despliegue como exitoso o causante
   de fallo, ligada a incidentes.
4. **Recuperación de despliegue fallido:** marcas de fallo y de recuperación del
   despliegue.
5. **Restauración del servicio:** registro de incidentes con apertura y cierre.

La condición habilitante es integrar CI/CD e incidentes que emitan esos eventos,
identificar servicio y ambiente, fijar reglas de cómputo, controlar duplicados y
mantener una serie temporal. Mientras tanto, la cobertura DORA del proyecto es de
**capacidades habilitadoras parciales**, no de métricas calculadas.

### 2.3 Método ISO

Las normas se emplean como **objetivos seleccionados de alineación**:

| Referencia | Aporte material | Brecha reconocida |
| --- | --- | --- |
| ISO/IEC 25010:2023 | Contratos tipados, cuotas, estados explícitos, responsive | Medidas de las 9 características, carga, accesibilidad |
| ISO/IEC 27001:2022 | Roles, secretos cifrados, minimización, HTTPS, Bearer | SGSI formal, inventario, riesgos, respuesta a incidentes |
| ISO 22301:2019 | Rotación de claves, deduplicación, fallo cerrado, rollback | BIA, RTO/RPO aprobados, copias verificadas, simulacros |
| ISO/IEC 42001:2023 | Límites de autoridad, procedencia, revisión humana | AIMS formal, impacto IA, monitoreo de deriva/sesgo |
| ISO/IEC/IEEE 29119-1:2022 | Caja negra sobre contratos públicos | E2E productivo completo |
| ISO/IEC 20000-1:2018 | Control de cambios y trazabilidad operativa | Gestión de servicio formal |

---

## 3. Las funciones

El sistema articula seis familias funcionales:

1. **Postulación pública:** formulario por plaza/variante, enlaces no
   enumerables de 128 bits, bloqueo de duplicados por teléfono normalizado + plaza,
   solicitud automática de CV por WhatsApp.
2. **Configuración administrativa:** perfiles laborales, plazas, formularios,
   preguntas, reglas deterministas, importación Excel/CSV, catálogo INE de
   Guatemala, roles y permisos.
3. **Evaluación asistida por IA:** reglas deterministas previas (descalificación
   `hard_fail` antes de llamar al modelo), grafo LangGraph, salida estructurada,
   puntuación ponderada calculada por el servidor (nunca un total libre del
   modelo), escala de cinco estados.
4. **Revisión humana 360°:** matriz de lectura optimizada, visor de evidencia,
   traspaso conversacional, comentarios y cambios de estado auditables.
5. **Conversación (JARVI HR):** recepción, razonamiento y envío como capacidades
   separadas; cola `conversation_outbox` con `FOR UPDATE SKIP LOCKED`; memoria de
   cuatro capas; bandeja con semáforo y deduplicación por identificador.
6. **Gobierno, observabilidad y auditoría:** Langfuse + OpenTelemetry con
   política de seudonimización, `admin_activity_events`, `audit_log`, protocolos
   versionados y políticas de privacidad por minimización.

---

## 4. El producto final

El producto final es un **sistema de apoyo a la decisión de selección**, no un
decisor. Su entregable operativo para la organización es:

- un **flujo de talento trazable** de extremo a extremo: anuncio → postulación →
  evaluación determinista/probabilística → revisión humana → decisión → contacto;
- una **evidencia reconstruible** por candidato, plaza, variante y evaluación;
- una **línea base de ingeniería alineada** con objetivos ISO y prácticas DORA,
  que habilita auditoría interna, continuidad y mejora de entrega;
- una **frontera de autoridad explícita**: la IA recomienda, el humano decide.

El producto queda denominado, con precisión académica, **evaluación
conversacional por competencias o conocimiento, experimental y no decisoria**,
mientras no exista validación psicométrica externa (constructo, confiabilidad,
población, equidad, administración estandarizada).

---

## 5. Marco epistemológico

La pregunta epistemológica del sistema es: **¿qué puede saberse y con qué
garantía?**

- **Solo se conoce lo persistido.** Una celda vacía es ausencia, no evidencia
  negativa; la vista previa no emite evidencia; lo observado no es lo registrado.
- **El criterio de verdad operativa es la idempotencia.** Reimportar o reenviar
  produce el mismo estado lógico, verificado por restricción de base de datos.
- **La verdad determinista y la inferencia se separan.** El contrato tipado es
  verificable; la salida del modelo es interpretación con procedencia, no hecho.
- **La evidencia estructurada es primaria; la narración es derivada.** Los
  títulos y resúmenes son representaciones deterministas del registro, nunca un
  reemplazo generativo de la evidencia.
- **La correlación no se confunde con causalidad.** Las variantes A/B/C/D habilitan
  experimentación comparativa, pero no constituyen ensayo aleatorizado ni
  calculan significancia.

Epistemológicamente, el sistema adopta una **postura verificacionista por
construcción**: conocimiento = dato persistido + restricción satisfecha +
procedencia registrada.

---

## 6. Marco ontológico

La pregunta ontológica es: **¿qué entidades existen y cómo se relacionan?**

- **La plaza es un anuncio, no el instrumento.** `job_positions` expresa la
  oferta; `application_forms` es el instrumento de captura, 1—N con la plaza.
- **El enlace identifica el instrumento, no la plaza.** El token público designa
  una variante concreta; la plaza sigue siendo el anuncio.
- **La identidad del candidato es relacional, no atributiva.** El WhatsApp
  normalizado es clave única de relación; nunca puntúa ni es atributo de mérito.
- **La participación es entidad explícita; la respuesta es el átomo de contenido;
  la pregunta es el átomo del instrumento.** `applications` conserva la
  invariante un candidato-por-plaza; las variantes agregan participaciones, no
  duplican identidad.
- **Cuatro planos ontológicos separados:** consulta, decisión, navegación y
  eventos, para impedir que una proyección de lectura se confunda con una
  escritura de decisión.
- **PostgreSQL es la fuente de verdad única.** Langfuse opera como proyección
  analítica; su caída no bloquea el negocio.

La ontología del sistema **espeja la ontología del dominio organizacional**: la
distinción anuncio/instrumento/candidato/participación refleja la estructura real
del proceso de selección, no una abstracción arbitraria.

---

## 7. Marco fenomenológico

La pregunta fenomenológica es: **¿qué experimenta cada usuario y cómo se le
respeta?**

- **El candidato no ve un experimento: ve una oportunidad.** Recibe un enlace,
  una plaza y un formulario; la variante, el diseño comparativo y el criterio de
  evaluación le son invisibles. No se le etiqueta ni se le expone la maquinaria
  interna.
- **La persona administradora ve antes de decidir.** La previsualización
  reproduce el formulario público con la misma fuente de datos; la continuidad
  entre lo aprobado y lo publicado es idéntica, no reinterpretada.
- **El revisor humano atraviesa evidencia, no opinión.** La matriz 360° presenta
  nota IA, razonamiento, motivo y respuestas; el visor es de solo lectura para
  proteger la procedencia.
- **Apagar es reversible y no destructivo.** El interruptor cierra acceso sin
  borrar evidencia; el candidato recibe un mensaje claro y no detalles internos.
- **La trazabilidad es la forma del respeto.** Cada participación identifica su
  formulario y versión; la auditoría registra actor y conteos **sin replicar
  respuestas ni datos confidenciales**.

En conjunto, el sistema diseña la experiencia para que la **opacidad técnica** sea
completa (el candidato no conoce el mecanismo) y la **transparencia decisoria**
también (el revisor sí conoce la evidencia), mientras la **privacidad** es un
compromiso estructural, no una preferencia.

---

## 8. Con respecto al usuario final y la organización (nivel industrial)

### 8.1 Usuario final (candidato)

- Identidad por WhatsApp normalizado; sin inferencias de emoción, personalidad,
  salud mental o atributos protegidos desde voz, escritura o tiempos.
- Telemetría **minimizada**: se excluyen contenidos de formularios, pulsaciones,
  portapapeles, credenciales y cuerpos de CV/audio.
- Expectativa salarial solo ante declaración explícita; negaciones y cifras de
  ventas/presupuestos no se interpretan como salario.

### 8.2 Organización (AISA)

- La autoridad de contratar y fijar remuneración **nunca se delega al modelo**.
- Gobierno de IA con revisión humana obligatoria y límites de autoridad
  configurables (ISO/IEC 42001, alineación parcial).
- Residencia industrial: desplegable en EasyPanel sobre VPS con PostgreSQL,
  despliegue separado por capacidades y artefacto único autocertificado.
- Aplicación metodológica —no certificación— de ISO/IEC 25010, 27001, 22301,
  42001, 29119 y 20000-1, y de prácticas DORA como capacidades habilitadoras.

### 8.3 Síntesis industrial

| Dimensión | Usuario final | Organización |
| --- | --- | --- |
| Ontológica | Candidato = identidad relacional | Plaza/Formulario/Participación = dominio explícito |
| Epistemológica | Solo se conoce lo declarado | Solo se conoce lo persistido y trazado |
| Fenomenológica | Oportunidad, no experimento | Decisión informada, no automatizada |
| Normativa | Privacidad y no-discriminación | ISO/DORA como referencia, sin certificación |

---

## 9. Dictamen

El artefacto JARVI RH / Talento AISA es un **sistema de reclutamiento asistido y
gobernado** cuya estrategia consiste en **industrializar el trabajo repetitivo
preservando la decisión humana**. Su método combina determinismo contractual,
inferencia probabilística trazable y gobierno humano; su epistemología exige
evidencia persistida y procedencia; su ontología separa con precisión anuncio,
instrumento, identidad y participación; su fenomenología hace invisible el
mecanismo al candidato y transparente la evidencia al revisor. Respecto a DORA e
ISO, constituye una **línea base de ingeniería alineada con objetivos
seleccionados**, no una certificación ni una medición DORA completa. El producto
final es, en términos estrictos, **apoyo a la decisión de selección con
evaluación conversacional experimental y no decisoria**, cuya validez industrial
depende de los procesos organizacionales, la evidencia longitudinal y la
evaluación independiente que exceden la entrega de código.
