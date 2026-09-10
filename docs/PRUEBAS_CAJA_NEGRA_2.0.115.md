# Pruebas de caja negra · JARVI RH 2.0.115

## Alcance del cambio

La especificación cubre las superficies intervenidas por este release: tema visual global, login, portada pública, formulario de postulación, administración, Revisión Humana 360°, persistencia de preferencia y documentación. Las reglas de evaluación, los estados y la decisión humana no cambian y permanecen bajo la regresión general.

## Matriz funcional observable

| ID          | Condición inicial                                    | Estímulo                                       | Resultado observable                                                                                          | Referencia                                  |
| ----------- | ---------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| BN-AUTH-01  | Login recién abierto                                 | Inspeccionar correo                            | El campo inicia vacío, no muestra correo de ejemplo ni autocompletado definido por la aplicación              | ISO/IEC 25010:2023 · interacción            |
| BN-TEL-01   | Formulario publicado                                 | Inspeccionar teléfono                          | Se muestra la bandera de Guatemala; la caja inicia vacía y no presenta un número sugerido                     | ISO/IEC 25010:2023 · usabilidad             |
| BN-TEL-02   | Teléfono nacional válido de ocho dígitos             | Enviar postulación                             | PostgreSQL recibe el número normalizado en E.164 con prefijo `+502`                                           | ISO/IEC 25010:2023 · corrección funcional   |
| BN-GEO-01   | Catálogo migrado y activo                            | Abrir selector Zona                            | Se ofrecen valores numéricos 1–25, ordenados numéricamente y obtenidos por consulta                           | ISO/IEC 25010:2023 · completitud funcional  |
| BN-GEO-02   | Ninguna zona seleccionada                            | Elegir una zona                                | Departamento queda fijado por catálogo y se habilita la consulta de municipios pertenecientes                 | ISO/IEC 25010:2023 · controlabilidad        |
| BN-GEO-03   | Zona y departamento resueltos                        | Inspeccionar Municipio                         | El selector carga solo municipios activos del departamento y exige una selección                              | ISO/IEC 25010:2023 · adecuación funcional   |
| BN-GEO-04   | Falta cualquiera de los tres datos geográficos       | Pulsar Enviar formulario                       | El cliente impide continuar y presenta un mensaje explícito                                                   | ISO/IEC 25010:2023 · prevención de errores  |
| BN-GEO-05   | Identificadores manipulados o relación inconsistente | Invocar el endpoint de envío                   | El servidor rechaza la solicitud antes de crear candidato, postulación o respuestas                           | ISO/IEC 27001:2022 · integridad             |
| BN-GEO-06   | Relación geográfica activa y formulario completo     | Confirmar envío                                | Zona, departamento y municipio se persisten como claves foráneas en la misma transacción                      | ISO/IEC 27001:2022 · integridad             |
| BN-GEO-07   | Postulación con ubicación persistida                 | Ejecutar evaluación IA                         | El contexto estructurado incluye `ubicacionDeclarada` con nombres resueltos, sin confiar en texto del cliente | ISO/IEC/IEEE 29119-1:2022 · trazabilidad    |
| BN-CAT-01   | Administración > Configuración > Catálogo            | Abrir Nomenclatura de Guatemala                | La administración muestra las 25 zonas sembradas y conserva editar/activar/desactivar                         | ISO/IEC 25010:2023 · operabilidad           |
| BN-HOR-01   | Portada o introducción de una plaza                  | Consultar Horario de trabajo                   | Se muestra exactamente: lunes–viernes 9:00–18:00 y sábado 8:00–12:00                                          | ISO/IEC/IEEE 29119-1:2022 · consistencia    |
| BN-HOME-01  | Plaza publicada en portada                           | Inspeccionar acción Aplicar ahora              | No aparece el texto “Inicia el formulario en esta misma pestaña.”                                             | ISO/IEC 25010:2023 · concisión              |
| BN-DARK-01  | Cualquier ruta en Day                                | Activar el control de tema                     | Fondo, tarjetas, controles, tablas, mensajes y bordes adoptan Dark Dimmed con roles funcionales AISA          | ISO/IEC 25010:2023 · accesibilidad          |
| BN-DARK-02  | Dark Dimmed activo                                   | Activar nuevamente el control                  | Se aplica Dark High Contrast con bordes, texto y foco reforzados, y el tercer uso retorna a Day               | WCAG 2.2 · contraste/foco                   |
| BN-DARK-03  | Cualquier tema alternativo activo                    | Navegar entre rutas públicas y administrativas | La preferencia persiste sin destello claro y el logotipo transparente usa su versión clara sin placa blanca   | ISO/IEC 25010:2023 · fiabilidad/interacción |
| BN-DARK-04  | Paleta Dark Dimmed cargada                           | Ejecutar oráculo de contraste                  | Texto principal, secundario y teal sobre fondo global superan 4.5:1; controles y foco conservan al menos 3:1  | WCAG 2.2 · 1.4.3 y 1.4.11                   |
| BN-STATE-01 | Listado o detalle con estado                         | Inspeccionar publicación, revisión, IA o error | Cada señal conserva nombre y, cuando aplica, icono o forma; ninguna decisión depende únicamente del color     | WCAG 2.2 · 1.4.1                            |
| BN-LEG-01   | Postulación histórica sin referencias geográficas    | Consultar candidatos existentes                | La lectura permanece operativa; la obligatoriedad se aplica a nuevos envíos                                   | ISO/IEC 25010:2023 · compatibilidad         |
| BN-DOC-01   | Repositorio en versión vigente                       | Ejecutar puerta de release                     | README, pie, gobierno, hoja de validación y caja negra indican `JARVI RH 2.0.115`                             | ISO/IEC/IEEE 29119-1:2022 · trazabilidad    |

## Pruebas automatizadas

| Comando                          | Oráculo                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm release:verify`            | Versión, historial, documentos y dependencias auditadas están sincronizados         |
| `pnpm release:bump -- --dry-run` | El siguiente parche calculado es `2.0.116`                                          |
| `pnpm test:black-box`            | Contratos observables de identidad, geografía, tema, artefacto y README son exactos |
| `pnpm test`                      | Normalización `+502`, relación geográfica y endpoints conservan la regresión        |
| `pnpm check`                     | Cliente, tRPC, servidor y esquema mantienen contratos TypeScript consistentes       |
| `pnpm build`                     | El artefacto de producción se genera con la versión vigente                         |

## Criterio de aprobación

El release se aprueba únicamente cuando todos los comandos terminan con código cero. La verificación visual posterior al despliegue debe ejecutar BN-AUTH-01 a BN-LEG-01 en Day, Dark Dimmed y Dark High Contrast. El tema alternativo se presenta como personalización de luminancia, contraste y confort; no como tratamiento ni garantía médica de reducción de fatiga. Las referencias WCAG e ISO son guía metodológica y no constituyen certificación formal.
