# Observabilidad Langfuse en vivo · JARVI RH 2.0.131

Fecha de control: 2026-09-11. Alcance: backend TypeScript, LangGraph, OpenAI, ApiChat y servicios de audio. Este documento describe controles técnicos verificables; no constituye certificación ISO, validación jurídica ni garantía absoluta de disponibilidad.

## Resultado arquitectónico

JARVI RH utiliza el SDK modular de Langfuse 5.11.1 sobre OpenTelemetry. El proveedor se configura con credenciales cifradas recuperadas exclusivamente desde PostgreSQL y se inicializa antes de que el servidor acepte tráfico. La ausencia o indisponibilidad de Langfuse degrada la telemetría a una operación nula y no interrumpe postulaciones, mensajería ni revisión humana.

La jerarquía observable conserva, según la operación:

1. una traza raíz para la evaluación, edición asistida, webhook o acción de servicio;
2. spans para carga, validación determinista, grafo, herramientas, persistencia y entrega externa;
3. generaciones para llamadas reales de modelo, con modelo, latencia, consumo y estado;
4. eventos de error clasificados sin propagar credenciales ni mensajes privados;
5. identificadores de usuario, sesión y entidad derivados mediante HMAC, no mediante datos personales en claro.

## Configuración y custodia

Las claves `LANGFUSE_PUBLIC_KEY` y `LANGFUSE_SECRET_KEY` se guardan por separado desde Administración > Agente de IA LangGraph. El navegador nunca vuelve a recibir el secreto: solo obtiene estado y máscara. El servidor cifra cada valor con AES-256-GCM, AAD por proveedor y clave, y la raíz dedicada `AGENT_SETTINGS_ENCRYPTION_KEY`.

Las preferencias no secretas son:

| Preferencia | Contrato |
| --- | --- |
| Activación | Encendido o apagado explícito de exportación |
| Región | US, EU, Japón o HIPAA mediante origen HTTPS cerrado |
| Ambiente | Identificador validado, por ejemplo `production` |
| Protección | `metadata_only` por defecto o contenido anonimizado |
| Muestreo | De 1 % a 100 %; producción inicial usa 100 % para auditoría |

El cambio de configuración o la rotación de credenciales se realiza bajo exclusión mutua. Primero se verifican las nuevas claves; después se vacía y cierra el exportador anterior, y finalmente se publica el nuevo proveedor. Si la prevalidación falla, se conserva el proveedor válido anterior y nunca se mezclan dos proyectos.

## Minimización y redacción

El modo predeterminado `metadata_only` sustituye entradas y salidas por marcadores de política. El modo `redacted` aplica redacción recursiva antes de exportar. Ambos bloquean patrones de API keys, secretos, autorización, correo, teléfono y otros campos identificables definidos por la política. Las etiquetas y metadatos usan una lista permitida y límites de tamaño.

No deben exportarse nombres, teléfonos, correos, CV, respuestas literales, audios, transcripciones completas, tokens de integración ni cuerpos del webhook. Se permiten identificadores seudónimos, operación, nodo, modelo, versión, ranura de credencial, intentos, conteos, duración, uso, clasificación, resultado y clase de error.

La seudonimización reduce exposición, pero no vuelve anónimos todos los datos. La retención, acceso, residencia regional y eliminación deben aprobarse organizacionalmente en Langfuse antes de procesar tráfico real.

## Inicio, verificación y cierre

Al iniciar:

1. se abre PostgreSQL;
2. se recuperan preferencias y secretos cifrados;
3. se valida la región y se autentica el proyecto;
4. se registra el proveedor OpenTelemetry y el procesador Langfuse;
5. únicamente entonces se habilita la escucha HTTP.

El botón **Verificar conexión Langfuse** exige que ambas tarjetas indiquen **Configurada**. La verificación consulta el proyecto mediante la API pública, emite `langfuse-connection-verification` y fuerza el envío. El identificador mostrado permite localizar esa primera traza inmediatamente en Langfuse.

Ante `SIGTERM` o `SIGINT`, el servidor deja de aceptar solicitudes, fuerza el envío de spans pendientes y cierra el SDK con tiempo acotado. Un fallo de exportación se registra por código seguro, sin volcar objetos que puedan contener secretos.

## Cobertura de ejecución

| Superficie | Evidencia observable |
| --- | --- |
| Evaluación LangGraph | Ejecución raíz, validación determinista, nodos, generación, parseo, política salarial, persistencia y clasificación |
| Responses API editorial | Modelo, versión de política, campo procesado, resultado y consumo; nunca texto público candidato antes de redacción |
| Webhook ApiChat | Recepción, autenticación, normalización, deduplicación, cuarentena y persistencia mediante huellas |
| Solicitud de CV y bandeja | Preparación, entrega, reintento y resultado del proveedor sin teléfono ni mensaje |
| Transcripción y TTS | Tipo de operación, modelo, tamaño, formato, ranura, consumo disponible y estado; nunca audio o texto completo |

Los errores deterministas —por ejemplo, postulación inexistente, evidencia insuficiente o política salarial— se representan como guardrails o spans fallidos aunque no exista llamada a modelo. Así se evita confundir “sin consumo” con “sin ejecución”.

## Protocolo de despliegue

1. Rote en Langfuse las credenciales que hayan sido compartidas en capturas o canales no secretos; no reutilice las claves expuestas.
2. Despliegue 2.0.131 con `AGENT_SETTINGS_ENCRYPTION_KEY` estable y PostgreSQL disponible. No agregue claves Langfuse a EasyPanel ni al repositorio.
3. Guarde individualmente la clave pública y la secreta; confirme que ambas tarjetas cambien de **Pendiente** a **Configurada**.
4. Seleccione la región exacta del proyecto, `production`, `metadata_only`, muestreo de 100 % y active las trazas.
5. Guarde la configuración y ejecute **Verificar conexión Langfuse**. Busque el identificador de la traza diagnóstica en el proyecto correcto.
6. Ejecute una evaluación controlada y una operación de cada servicio habilitado; confirme jerarquía, latencia, uso, errores y ausencia de datos personales.
7. Configure en Langfuse tableros, presupuesto y alertas de tasa de error, latencia y costo según la capacidad del plan contratado.
8. Observe al menos una ventana operativa y documente responsable, evidencia, hora, ambiente y decisión de promoción.

## Rollback

Desactive **Enviar trazas en vivo** y guarde. La lógica de negocio continuará sin exportación. Si se revierte el artefacto, vacíe primero las trazas pendientes, conserve las credenciales cifradas y no elimine evidencia de auditoría hasta que la política de retención lo autorice. La versión 2.0.131 no requiere una migración destructiva para Langfuse.

## Criterios de aceptación de caja negra

- Las dos credenciales pendientes impiden verificar y explican la acción requerida.
- Una clave, región o proyecto incorrectos producen un error seguro y no una falsa confirmación.
- Una verificación válida crea y vacía una traza diagnóstica localizable.
- Una rotación válida cambia de proyecto sin reiniciar y sin enviar spans nuevos al proyecto anterior.
- `metadata_only` no transmite entradas ni salidas literales.
- La redacción elimina credenciales, correo y teléfono en objetos anidados.
- El muestreo respeta el intervalo permitido y 100 % conserva todas las ejecuciones elegibles.
- La caída de Langfuse no bloquea el resultado funcional del agente.
- El cierre ordenado intenta vaciar la cola y finaliza dentro del límite operativo.
- El repositorio, el bundle del cliente y los mensajes de error no contienen claves reales.

## Referencias técnicas primarias

- [Compatibilidad y ciclo de vida de Langfuse](https://langfuse.com/docs/compatibility)
- [SDK de observabilidad JavaScript/TypeScript](https://langfuse.com/docs/observability/sdk/overview)
- [Integración de LangGraph](https://langfuse.com/integrations/frameworks/langgraph)
- [Integración de OpenAI para JavaScript](https://langfuse.com/integrations/model-providers/openai-js)
- [Regiones de datos de Langfuse Cloud](https://langfuse.com/security/data-regions)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

