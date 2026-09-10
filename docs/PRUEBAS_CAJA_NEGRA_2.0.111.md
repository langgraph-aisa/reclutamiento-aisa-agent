# Pruebas de caja negra · JARVI RH 2.0.111

## Alcance del cambio

Se prueban únicamente las superficies modificadas en este release: selector claro/oscuro, persistencia visual, menú retráctil, resumen de release/repositorio, panel humano del detalle de candidato y notificaciones. Los contratos de negocio no modificados permanecen cubiertos por la regresión existente.

## Matriz funcional observable

| ID       | Condición inicial                        | Estímulo                                     | Resultado observable                                                                                      | Referencia                                    |
| -------- | ---------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| BN-UI-01 | Sesión autenticada, tema claro           | Pulsar el control junto al usuario           | Fondo, tarjetas, controles y menú cambian a paleta oscura; el control anuncia “Cambiar a modo claro”      | ISO/IEC 25010:2023 · usabilidad/accesibilidad |
| BN-UI-02 | Tema oscuro activo                       | Recargar o navegar entre módulos             | El tema oscuro permanece sin salto funcional y no se alteran filtros, formularios ni mutaciones           | ISO/IEC 25010:2023 · fiabilidad               |
| BN-UI-03 | Tema oscuro persistido                   | Abrir una pestaña nueva                      | La clase oscura se aplica antes del montaje React, evitando destello claro inicial                        | ISO/IEC 25010:2023 · interacción              |
| BN-UI-04 | Menú expandido                           | Colapsar y expandir                          | El fondo lateral conserva contraste respecto al contenido; iconos y herramienta de tema siguen accesibles | ISO/IEC 25010:2023 · adaptabilidad            |
| BN-UI-05 | Menú expandido                           | Inspeccionar pie de usuario                  | Se muestran `JARVI RH 2.0.111`, rama, hash, GitHub, porcentaje y lenguajes; ningún secreto aparece        | ISO/IEC 27001:2022 · confidencialidad         |
| BN-UI-06 | Build en `main` sin divergencia          | Desplegar el commit                          | El resumen indica rama `main` y 100 % sincronizado; el hash coincide con el artefacto                     | ISO/IEC/IEEE 29119-1:2022 · trazabilidad      |
| BN-UI-07 | Detalle de candidato en modo oscuro      | Abrir “Cambio humano”                        | Panel, select, comentario y botón conservan legibilidad y la misma operación de guardado                  | ISO/IEC 25010:2023 · adecuación funcional     |
| BN-UI-08 | Cualquier tema                           | Provocar una confirmación o error controlado | La notificación adopta el tema activo y conserva mensaje/semántica                                        | ISO/IEC 25010:2023 · interacción              |
| BN-UI-09 | Viewports 360, 768, 1024, 1366 y 1920 px | Abrir/cerrar menú y alternar tema            | No aparece desbordamiento horizontal nuevo; controles táctiles conservan área utilizable                  | ISO/IEC 25010:2023 · flexibilidad             |

## Pruebas automatizadas

| Comando                                | Oráculo                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm test:black-box`                  | Release, dependencias, secuencia 999→minor y temas admitidos son exactos |
| `pnpm release:verify`                  | README, gobierno, dependencias y versión canónica están sincronizados    |
| `pnpm release:verify -- --compare-git` | Cada push a `main` incrementa exactamente la versión esperada            |
| `pnpm test`                            | No existe regresión observable en endpoints y políticas existentes       |
| `pnpm check`                           | Los contratos TypeScript permanecen consistentes                         |
| `pnpm build`                           | El artefacto cliente/servidor se genera con metadata Git embebida        |

## Criterio de aprobación

El release se aprueba cuando todos los comandos terminan con código cero y los casos visuales mantienen operación equivalente en ambos temas. La aplicación de estas referencias ISO es metodológica y no representa certificación formal.
