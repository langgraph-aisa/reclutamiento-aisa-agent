# Pruebas de caja negra · JARVI RH 2.0.112

## Alcance del cambio

La superficie modificada es el README académico-comercial y su metadata de release. Los casos visuales de tema, menú, resumen de repositorio y revisión humana se conservan como regresión heredada; los contratos de negocio no modificados permanecen cubiertos por la suite general.

## Matriz funcional observable

| ID        | Condición inicial                        | Estímulo                                     | Resultado observable                                                                                      | Referencia                                    |
| --------- | ---------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| BN-UI-01  | Sesión autenticada, tema claro           | Pulsar el control junto al usuario           | Fondo, tarjetas, controles y menú cambian a paleta oscura; el control anuncia “Cambiar a modo claro”      | ISO/IEC 25010:2023 · usabilidad/accesibilidad |
| BN-UI-02  | Tema oscuro activo                       | Recargar o navegar entre módulos             | El tema oscuro permanece sin salto funcional y no se alteran filtros, formularios ni mutaciones           | ISO/IEC 25010:2023 · fiabilidad               |
| BN-UI-03  | Tema oscuro persistido                   | Abrir una pestaña nueva                      | La clase oscura se aplica antes del montaje React, evitando destello claro inicial                        | ISO/IEC 25010:2023 · interacción              |
| BN-UI-04  | Menú expandido                           | Colapsar y expandir                          | El fondo lateral conserva contraste respecto al contenido; iconos y herramienta de tema siguen accesibles | ISO/IEC 25010:2023 · adaptabilidad            |
| BN-UI-05  | Menú expandido                           | Inspeccionar pie de usuario                  | Se muestran `JARVI RH 2.0.112`, rama, hash, GitHub, porcentaje y lenguajes; ningún secreto aparece        | ISO/IEC 27001:2022 · confidencialidad         |
| BN-UI-06  | Build en `main` sin divergencia          | Desplegar el commit                          | El resumen indica rama `main` y 100 % sincronizado; el hash coincide con el artefacto                     | ISO/IEC/IEEE 29119-1:2022 · trazabilidad      |
| BN-UI-07  | Detalle de candidato en modo oscuro      | Abrir “Cambio humano”                        | Panel, select, comentario y botón conservan legibilidad y la misma operación de guardado                  | ISO/IEC 25010:2023 · adecuación funcional     |
| BN-UI-08  | Cualquier tema                           | Provocar una confirmación o error controlado | La notificación adopta el tema activo y conserva mensaje/semántica                                        | ISO/IEC 25010:2023 · interacción              |
| BN-UI-09  | Viewports 360, 768, 1024, 1366 y 1920 px | Abrir/cerrar menú y alternar tema            | No aparece desbordamiento horizontal nuevo; controles táctiles conservan área utilizable                  | ISO/IEC 25010:2023 · flexibilidad             |
| BN-DOC-01 | README en GitHub                         | Abrir la portada                             | Logo y personaje cargan desde PNG locales; el personaje usa 240 px y conserva la razón intrínseca 2:3     | ISO/IEC 25010:2023 · interacción              |
| BN-DOC-02 | Corpus documental completo               | Contar cuerpo y bibliografía por separado    | El cuerpo tiene 2.400–2.700 palabras; hay 36 referencias y 19 fuentes de API/infraestructura/modelos      | ISO/IEC/IEEE 29119-1:2022 · completitud       |
| BN-DOC-03 | Introducción comercial                   | Contar posicionamiento y keywords            | La frase contiene 35 palabras y aparecen las diez expresiones SEO suministradas                           | ISO/IEC 25010:2023 · adecuación funcional     |
| BN-DOC-04 | Matriz de aseguramiento                  | Revisar afirmaciones ISO y APA               | Declara alineación metodológica sin certificación y utiliza APA 7.ª como edición oficial vigente          | ISO/IEC 27001:2022 · información documentada  |

## Pruebas automatizadas

| Comando                                | Oráculo                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm test:black-box`                  | Release, secuencia, temas, extensión, recursos y referencias son exactos |
| `pnpm release:verify`                  | README, gobierno, dependencias y versión canónica están sincronizados    |
| `pnpm release:verify -- --compare-git` | Cada push a `main` incrementa exactamente la versión esperada            |
| `pnpm test`                            | No existe regresión observable en endpoints y políticas existentes       |
| `pnpm check`                           | Los contratos TypeScript permanecen consistentes                         |
| `pnpm build`                           | El artefacto cliente/servidor se genera con metadata Git embebida        |

## Criterio de aprobación

El release se aprueba cuando todos los comandos terminan con código cero y los casos visuales mantienen operación equivalente en ambos temas. La aplicación de estas referencias ISO es metodológica y no representa certificación formal.
