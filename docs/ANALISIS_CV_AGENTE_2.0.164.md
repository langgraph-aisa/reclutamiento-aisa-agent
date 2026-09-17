# Evaluación de CV con IA — análisis del artefacto, el método y su lugar en la interfaz

Fecha: 2026-09-17. Rama objetivo: `main`. Versión: JARVI RH 2.0.164. Este documento
fundamenta el módulo que **solicita el CV, espera la respuesta, la recibe por el
webhook y vuelve a evaluar a la persona**, y su ubicación estratégica en la interfaz
administrativa. Declara además, sin adornos, qué parte está entregada y qué parte
permanece como incremento siguiente.

## 1. Análisis ontológico

**El expediente del CV es un objeto distinto de la postulación, y está subordinado a
ella.** La postulación (`applications`) es la relación entre una persona y una plaza;
el CV es un documento que llega *después*, por un canal conversacional, y que existe
solo porque la postulación lo solicitó. Por eso el expediente vive en
`candidate_knowledge_files` bajo el espacio de la postulación —`applications/<id>/`—
y no como un campo de la postulación. Un CV recibido sin postulación no tiene lugar
ontológico donde existir.

**La solicitud es un evento, no un mensaje.** El sistema no «manda un texto»: abre un
**ciclo de información** con la persona. Ese ciclo tiene tres estados observables —
`solicitado`, `pendiente`, `recibido`— y la razón de cada uno es verificable: la marca
`cv_request:<id>` prueba que se solicitó; la llegada de un documento con origen
`webhook` prueba que la persona respondió. El estado no se declara: se deriva de la
evidencia persistida.

**El canal es el mismo, y eso es una decisión de identidad.** El CV no se pide por
correo ni por un formulario aparte: se pide **por el mismo medio por el que la persona
postuló**. La identidad del candidato sigue siendo su WhatsApp normalizado, de modo que
la respuesta no crea una segunda persona ni un segundo expediente.

**La esencia del CV es un objeto derivado, no el CV.** El documento es la evidencia; la
esencia —hasta el límite configurado, 550 palabras por omisión— es una **representación
de trabajo** que alimenta al agente. Confundirlos sería tratar un resumen como prueba:
la esencia cita, no sustituye. El visor sigue entregando el documento íntegro.

## 2. Análisis epistemológico

**Solo se conoce lo que la persona entregó.** La esencia se genera únicamente del texto
extraído del documento recibido. Si el CV no llega, no hay esencia, no hay
re-evaluación y la ficha lo declara en lugar de inferir un perfil.

**La procedencia se conserva por construcción.** El documento entrante queda con origen
declarado (`webhook` o `manual`), con su huella `sha256` —que además impide duplicados
dentro de la postulación—, su extensión verificada por contenido y su marca temporal.
La re-evaluación no inventa procedencia: hereda la del expediente.

**El puntaje no lo fija el modelo.** La puntuación sigue siendo una suma ponderada
calculada por el servidor sobre los bloques del método, con las reglas deterministas
previas y la descalificación crítica antes de llamar al modelo. La re-evaluación
**actualiza** el puntaje con más evidencia; no delega el veredicto a la esencia.

**Un documento no extranjero al método.** El texto del CV no entra a la evaluación como
un anexo libre: entra como capa declarada del expediente, con la misma etiqueta
institucional que el resto del contexto, para que el agente pueda distinguir lo que la
persona afirmó de lo que el instrumento preguntó.

**La recepción admite todos los códecs que el propio RAG acepta.** El webhook entrega
el archivo en formato base64 —o como dato URI o URL—; el transporte canónico lo
decodifica, verifica el tipo por firma de bytes y lo escribe con su extensión final. Un
formato habilitado en la configuración del RAG se recibe; uno no habilitado permanece
en la conversación y no entra al expediente. La política de formatos tiene una sola
fuente: la configuración de conocimiento.

## 3. Análisis fenomenológico

**Lo que la persona percibe.** Quien confirma el formulario recibe, en el mismo canal,
un mensaje que agradece su participación y le pide el CV. El trato es explícito en dos
extremos: al principio se le dice qué se espera de ella y para qué; al final se le dice
que **si su perfil avanza después del análisis, el contacto ocurrirá por ese mismo
medio**. No se le promete nada más y no se le comunica ningún criterio interno.

**Lo que la persona no percibe.** El diseño del instrumento, los pesos del método, la
existencia de variantes y el hecho de que se re-evalúe con su CV son información de
gestión interna. La persona no ve su puntaje ni la esencia: ve que su CV llegó.

**Lo que el equipo de revisión percibe.** Abre la ficha y encuentra el ciclo del CV con
su estado. Cuando el documento llegó, ve la **esencia** y puede volver a evaluar con
ella. La interfaz no obliga a recordar en qué punto quedó el expediente: el estado es
visible y su causa también.

**El silencio también informa.** Un expediente solicitado y sin respuesta es un dato
operativo —la persona no respondió—, no un error del sistema. La ficha lo muestra como
espera, no como fallo.

## 4. Análisis de ingeniería

**Reutilización antes que invención.** El módulo se apoya en lo ya verificado: el
transporte canónico en base64 con detección por contenido (`base64Transport.ts`), el
almacén del RAG del candidato (`candidateKnowledge.ts`), la solicitud idempotente con
marca única (`cvRequest.ts`) y el evaluador gobernado con bloques ponderados
(`agentEvaluator.ts`).

**La configuración vive en la base, no en el código.** El mensaje de agradecimiento, el
aviso de contacto y la extensión de la esencia se leen de `integration_settings` con el
proveedor `recruitment`. El texto institucional por omisión vive en el servidor y se
publica a la hoja administrativa con la misma consulta que lo gobierna, de modo que la
institución ajusta el trato sin desplegar código.

**El cierre no puede romper el despacho.** El cierre editorial se compone con la
**misma lectura** que ya alimenta el mensaje —sin consultas adicionales— y la guardia
salarial se evalúa **antes de tocar la base**: una plantilla que ofrezca remuneración se
rechaza sin efectos laterales. La puerta de release blinda ese orden.

**Sin migración en el alcance entregado.** La capa de configuración, el cierre
compuesto y el estado del expediente se resuelven con estructuras existentes.

**Incremento entregado en 2.0.165.** La generación de la esencia, su almacenamiento y
la re-evaluación que actualiza el puntaje se entregaron: la migración
`0027_candidate_cv_essence.sql` agrega la esencia y su estado a
`candidate_knowledge_files`; `analyzeCandidateCvEssence` la genera por fragmentos con
el límite de la configuración y deja asiento propio; y el evaluador incorpora el
expediente del candidato como capa declarada, de modo que la re-evaluación que ya
existía pasa a contar con el CV y actualiza el puntaje.

## 5. Estrategia de propiedad intelectual

**El know-how no se distribuye.** Pesos, bandas, criterios e instrucciones del agente
permanecen fuera del paquete del cliente y se sirven en respuestas autenticadas
(2.0.162). El prompt de la esencia del CV pertenece a esa misma frontera: vive en el
servidor y no viaja al navegador.

**La esencia es una representación interna.** El texto de la esencia alimenta al agente
y se muestra en la ficha administrativa. No se expone a la persona postulante, no se
publica en el canal y no se devuelve por el webhook.

**El canal no revela el método.** El mensaje de solicitud y su cierre declaran qué se
espera y cómo seguirá el contacto. No declaran criterios, pesos, variantes ni la
existencia de una re-evaluación automática.

**La evidencia es de la institución y de la persona.** El documento recibido pertenece
al expediente de la postulación; la institución conserva su huella para evitar
duplicados y su auditoría registra la recepción sin replicar el contenido en los
asientos.

## 6. Ubicación estratégica en la interfaz

**La configuración en `Configuración`.** El módulo se llama **«Evaluación de CV con
IA»** y reúne lo que la institución decide: el mensaje base de solicitud, el mensaje de
agradecimiento con sus parámetros `{{nombre}}` y `{{plaza}}`, el aviso de contacto por
el mismo medio y la extensión de la esencia. Es un módulo de **trato y umbral**, no de
operación diaria: por eso vive en configuración y no en la bandeja.

**El resultado en la ficha del candidato.** El análisis del CV se lee junto a
`Formularios y anuncios · respuestas`, porque ambos son la misma cosa vista desde dos
momentos: lo que la persona respondió al postular y lo que entregó después. Ponerlos
vecinos evita que el revisor recorra dos pantallas para reconstruir un mismo expediente.

**El estado antes que el contenido.** El panel declara primero el estado del ciclo
(solicitado, pendiente, recibido) y después la esencia. Un expediente sin CV no muestra
un panel vacío: muestra la espera con su causa.

**La conversación no se duplica.** La llegada del CV ya es visible en la bandeja de
WhatsApp del candidato. El panel de análisis no la repite: informa el hecho —el
documento entró al expediente— y ofrece la esencia y la re-evaluación, que es lo que la
conversación no puede dar.

**Una sola acción de decisión.** El panel no decide el estado de la postulación: la
decisión sigue en el encabezado de identidad y su registro en la bitácora. El panel de
CV **propone re-evaluar**, no decide.

## 7. Límites declarados

El alcance entregado en 2.0.164 comprende la configuración editorial del módulo, la
composición del cierre institucional en el mensaje de solicitud y la derivación del
estado del expediente. **2.0.165 añade** la generación de la esencia por fragmentos, su
persistencia y la inyección del expediente como capa declarada del evaluador, con el
panel de análisis en la ficha junto a las respuestas de formularios. **No comprende**
una validación psicométrica del CV, una interpretación automática de su contenido más
allá de lo que el agente pueda razonar con el texto analizado, ni una re-evaluación
automática al recibir el documento: la re-evaluación se solicita desde la ficha y queda
registrada. La re-evaluación con CV **no sustituye** la revisión humana: la alimenta.
