# Validación responsive del módulo de Revisión Humana

## Invariantes de diseño

1. El documento administrativo no crece horizontalmente por efecto de la matriz.
2. El desplazamiento horizontal pertenece exclusivamente al contenedor de celdas.
3. El encabezado de persona, visor 360° y filtros permanecen fuera del desplazamiento de la tabla en tabletas y escritorios.
4. Todos los controles conservan un ancho utilizable; cuando el espacio disminuye cambian de fila, nunca quedan fuera de pantalla.
5. La matriz mantiene fija la cabecera y la primera columna durante la exploración de evidencias.

## Estrategia geométrica

- El panel central usa `min-width: 0` dentro del contenedor flex del menú lateral. Esto elimina la suma incorrecta “menú + 100 % de contenido” que originaba la barra horizontal del navegador.
- Las franjas superiores responden mediante consultas de contenedor. La decisión depende del ancho real disponible después del menú lateral, no del ancho total del navegador.
- Menos de 672 px: controles apilados y filtros en dos columnas.
- Entre 672 px y 1152 px: resumen en dos áreas, revisión rápida en una fila completa y filtros en cuatro columnas.
- Desde 1152 px: resumen, puntaje y revisión rápida se consolidan en una franja.
- Desde 1248 px: los ocho filtros ocupan una sola fila con mínimos explícitos que preservan fechas y etiquetas.
- En pantallas de altura menor a 760 px, el visor reduce su altura para reservar área operativa a la matriz.

## Matriz de comprobación

| Entorno representativo | Resultado esperado |
| --- | --- |
| Móvil 360 × 640 | Herramientas accesibles mediante desplazamiento táctil interno; sin desbordamiento lateral del documento |
| Tableta 768 × 1024 | Secciones superiores fijas y matriz con desplazamiento propio |
| Tableta horizontal 1024 × 768 | Revisión rápida visible en segunda franja, sin controles recortados |
| Pantalla cuadrada 1024 × 1024 | Uso equilibrado de altura y ancho; visor y matriz simultáneamente visibles |
| Portátil 1366 × 768 | Filtros compactos en dos filas y tabla con área útil estable |
| Monitor ancho 1920 × 600 | Controles superiores en una fila cuando existe ancho suficiente y visor reducido por altura |

## Conservación funcional

No se modificaron contratos tRPC, consultas, filtros, ordenamiento, selección del candidato, visor de evidencias, cambio de estado, comentarios, auditoría ni navegación al detalle. La intervención se limita a contención geométrica, reflujo y jerarquía visual.
