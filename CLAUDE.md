# CLAUDE.md

Contexto permanente del proyecto. **Léelo completo antes de tocar código.**
Aquí está el porqué de las decisiones, que es lo que se pierde entre sesiones.

---

## Qué es TireTrack

SaaS multi-empresa de gestión de servicio de llantas para flotas. Una empresa
prestadora (ej. Asistectire) atiende a sus clientes (ej. Transportes Reyna),
que tienen vehículos con llantas en posiciones numeradas. Cada visita genera
una **orden de servicio** con mediciones posición por posición.

El técnico trabaja **en campo, sin señal**. Eso condiciona toda la arquitectura.

---

## Disciplina de trabajo — obligatoria, no repetir al usuario

1. **Una tarea completa de forma autónoma.** Itera, corrige tus propios
   errores y prueba sin pedir aprobación en cada paso interno.
2. **Pruebas automatizadas al terminar cada tarea.** Nunca dejar que la única
   verificación sea que el usuario pruebe a mano.
3. **Alto al final de cada tarea.** Resumen de: qué hiciste, qué archivos
   tocaste, resultado de las pruebas. Esperar confirmación para seguir.
4. **Un commit por tarea**, con mensaje descriptivo, para poder revertir una
   tarea sin perder el resto.
5. **Decisión de arquitectura no prevista → detenerse y preguntar.** No
   decidir por cuenta propia algo que no estaba en el plan aprobado.

Comando de verificación antes de cerrar cualquier tarea:

```bash
npm run verify    # typecheck + lint + test
```

---

## Stack (decidido, no reabrir sin motivo)

| Capa | Elección | Por qué |
|---|---|---|
| Móvil | **Expo (React Native) + TypeScript** | El MVP es React; un solo desarrollador con IA rinde más en el ecosistema que ya domina. EAS genera APK instalable sin tiendas |
| Navegación | Expo Router | Rutas por archivo |
| Estado servidor | TanStack Query con persistencia | Cache que sobrevive al cierre de la app |
| Base local | expo-sqlite + Drizzle | El técnico sincroniza posición por posición, no la orden entera |
| Backend | **Fastify + Prisma + PostgreSQL** | Fastify sobre NestJS: menos ceremonia para un solo desarrollador |
| Fotos | Cloudflare R2 con URLs pre-firmadas | Sin costo de salida; el archivo no pasa por la API |
| Auth | JWT + refresh, 2FA con TOTP | |

**Fase 1: solo Android**, APK instalable directo. iOS queda para cuando haya
cuenta de desarrollador de Apple.

**Descartado:** Capacitor sobre el web actual — más rápido de arrancar, pero
la captura de 22 posiciones con fotos y firma sobre WebView es lenta y el
offline sobre IndexedDB es frágil. Flutter — obliga a empezar de cero en Dart.

---

## Estructura

```
tiretrack/
├── packages/
│   ├── domain/       ← reglas puras. SIN React, SIN Node, SIN base de datos
│   └── contracts/    ← tipos + esquemas Zod compartidos
├── apps/
│   ├── mobile/       ← Expo
│   └── api/          ← Fastify
└── .github/workflows/
```

**`packages/domain` es el corazón.** Las reglas viven ahí una sola vez: el
backend las usa para validar, la app para responder sin esperar al servidor.
Si una regla está duplicada en los dos lados, está mal.

---

## Reglas de negocio críticas

### Máquina de estados de la orden

```
borrador → programada → en_proceso → en_revisión → pendiente_cliente → cerrada
                             ↑______________|                     ↓
                        (devolución con motivo)               anulada
```

- **Solo el técnico asignado captura mediciones.** El coordinador NO edita:
  devuelve la orden con motivo. Si pudiera corregir, la firma del técnico
  dejaría de respaldar lo registrado.
- **No se cierra sin firma.** Requisito duro, con CHECK en la base de datos.
- **La firma se ata a la versión de la orden.** Si el contenido cambia después
  de firmar, la firma queda invalidada y hay que recapturarla. Una firma debe
  amparar exactamente lo que quedó.
- **Devolución exige motivo.**
- **Autoaprobación se marca.** Si quien aprueba es quien ejecutó, queda
  registrado como tal.
- **Aprobación tácita a 5 días hábiles.** Vencido el plazo la orden cierra
  sola, marcada como `cierreTacito`. **Nunca disfrazar el vencimiento de
  aprobación expresa.**
- **Congelado al cerrar.** Se estampan nombre y NIT del cliente, código y
  placa del vehículo, nombre y cédula del técnico. Un documento cerrado no
  cambia aunque cambien los datos maestros.

### Identidad y folio

- Todo registro nace con **UUID generado en el cliente**. Es lo que permite
  capturar sin conexión y sincronizar sin duplicar.
- **La firma se ata al UUID, no al folio.** El UUID existe desde el primer
  momento; el folio se asigna después.
- **Órdenes programadas:** folio real asignado en la oficina, con conexión.
  Es el caso mayoritario.
- **Órdenes imprevistas sin señal:** nacen con código de referencia corto
  (`FUN-K7M2`) para poder buscarlas. Al sincronizar reciben su folio
  consecutivo; el código queda como referencia secundaria.
- **El folio es atómico por sede:** `UPDATE ... RETURNING`, nunca `count()+1`.
- Formato: `OS-{codigoSede}-{consecutivo 6 dígitos}`.

### Cálculos

| Qué | Cómo |
|---|---|
| Desgaste | `(1 − prof / profOriginal) × 100`. **profOriginal viene de diseño+medida**, no del diseño solo: un XZY-3 en 295/80R22.5 trae 16 mm y en 11R22.5 trae 14.5 |
| Vencimiento DOT | DOT formato `SSAA` (semana+año) → fecha de fabricación → **+6 años**. El DOT NO es fecha de vencimiento, es de fabricación |
| Bajo mínimo | `prof < eje.profMin`. Umbral por tipo de eje |
| PSI fuera de rango | `abs(psiEnc − eje.psi) > eje.psi × 0.15` |
| Recurrencia | Días hábiles saltando sábado y domingo |

### Catálogo de llantas — tres niveles

```
Marca → Diseño (con tipo de eje) → Medida (con profundidad de fábrica)
```

- **Duplicado exacto bloqueado**: se normaliza quitando tildes, mayúsculas,
  espacios y guiones. "Michelín" = "Michelin".
- **Similitud advertida**: distancia de edición ≤ 2 muestra candidatos antes
  de permitir crear.
- **Ámbito híbrido**: entradas globales de plataforma + propias por empresa.
  Lo creado en campo queda marcado para revisión del administrador.
- Sin esto, en tres meses hay cuatro variantes de "Michelin" y el análisis de
  desgaste por marca deja de existir.

### Aislamiento multi-empresa

- **Los clientes NO se comparten entre empresas.** Si dos empresas atienden a
  Transportes Reyna, cada una tiene su propio registro. El NIT es único por
  empresa, no global.
- El aislamiento va en **llaves foráneas compuestas encadenadas**
  (`orden → cliente → empresa`), no en un `WHERE` que alguien puede olvidar.
- El técnico ve **solo sus órdenes asignadas**. Pedir una ajena devuelve
  **404, no 403**: un 403 confirma que el recurso existe.
- El cliente ve solo su `clienteId`, y **no ve el historial interno** de
  devoluciones entre coordinador y técnico.
- El superadmin no accede a datos operativos sin abrir una sesión de
  suplantación con motivo, ticket y vencimiento. Todo lo que haga queda
  marcado.

### Reglas de campo

- **Llanta no identificable:** se permite guardar mediciones sin marca, con
  motivo obligatorio (flanco borrado, posición interna, etc.). Si se obliga a
  identificarla, el técnico inventa un dato — y un dato inventado es peor que
  uno faltante.
- **La llanta desmontada se autocompleta** desde la última orden que registró
  esa posición. No se escribe a mano.
- **Copiar del eje hermano:** las posiciones de un mismo eje suelen ser
  idénticas.
- **Recomendaciones persistentes:** lo que el técnico encuentra y no ejecuta
  sobrevive al cierre y reaparece en la siguiente orden de ese vehículo.

### Auditoría

Toda exportación registra usuario, cantidad, folios, origen, filtros y
cuántas órdenes iban sin cerrar.

---

## Modelo de datos — 24 tablas

**Tenancy y acceso:** `empresa`, `sede`, `usuario`, `usuario_sede`,
`token_recuperacion`, `sesion_usuario`, `sesion_suplantacion`

**Clientes y activos:** `cliente`, `sede_cliente`, `vehiculo`,
`configuracion_eje`, `posicion_eje`

**Catálogo:** `marca`, `diseno`, `diseno_medida`, `servicio`, `tipo_parche`

**Operación:** `orden_servicio`, `llanta_registro`, `llanta_servicio`, `foto`,
`orden_estado_historial`

**Soporte:** `recomendacion`, `programacion_recurrente`, `auditoria`,
`consecutivo`

Notas que no se deben perder:

- **`configuracion_eje` es INMUTABLE y versionada.** Editar crea una versión
  nueva. La orden congela la versión que usó, para que una orden de hace seis
  meses se siga dibujando con su diagrama de entonces.
- **`llanta_registro` es tabla propia**, no un objeto anidado en la orden. El
  técnico sincroniza posición por posición: si se cae la señal a mitad de
  captura, no se puede perder todo.
- **`Decimal`, nunca `Float`** para dinero y mediciones.
- Todo índice de tabla operativa empieza por `empresaId`.
- Nada se borra: se deshabilita. No se puede deshabilitar algo con órdenes
  abiertas.

---

## Plan de tareas

Estado: `[x]` hecha · `[ ]` pendiente

### Fase 0 · Fundación
- [x] 0.1 Monorepo, TypeScript, Vitest, ESLint, CLAUDE.md
- [x] 0.2 `packages/domain`: todas las reglas como funciones puras + pruebas
- [x] 0.3 `packages/contracts`: tipos y esquemas Zod

### Fase 1 · Backend
- [x] 1.1 Esquema Prisma, migraciones, semilla
- [x] 1.2 Aislamiento: llaves compuestas y RLS
- [x] 1.3 Auth: login, refresh, 2FA, recuperación, bloqueo
- [x] 1.4 Catálogo
- [x] 1.5 Clientes, sedes, vehículos, configuración de ejes
- [x] 1.6 Órdenes: máquina de estados y folio atómico
- [x] 1.7 Fotos con URLs pre-firmadas
- [x] 1.8 Informes y auditoría
- [x] 1.9 Trabajos programados: cierre tácito, recurrencias, alertas DOT

### Fase 2 · Base de la app
- [x] 2.1 Expo, navegación, sistema visual
- [x] 2.2 SQLite y migraciones locales
- [x] 2.3 Motor de sincronización
- [x] 2.4 Sesión y almacenamiento seguro

### Fase 3 · Flujo del técnico
- [x] 3.1 Mis órdenes
- [x] 3.2 Detalle de orden
- [x] 3.3 Diagrama según configuración de ejes
- [x] 3.4 Editor de posición a pantalla completa
- [x] 3.5 Cámara con compresión (en el editor de posición; ver "Flujo completo en la app")
- [x] 3.6 Firma (ruta `orden/[id]/firma`)
- [x] 3.7 Envío a revisión sin conexión

### Fase 4 · Coordinador
- [x] 4.1 Nueva orden en cascada (ruta `nueva-orden`)
- [x] 4.2 Bandeja de aprobación
- [x] 4.3 Devolución y reasignación (ruta `orden/[id]/decidir`)
- [x] 4.4 Programación recurrente (ruta `programaciones`; trabajos en marcha con técnico fijo)

> Las secciones de abajo numeradas 4.x–6.x **no corresponden** a estas
> casillas: a partir de la 5.0 se usaron para la capa HTTP, la sincronización
> y la descarga, que no estaban en el plan original.

### Fase 5 · Cliente y administración
- [x] 5.1 Portal del cliente (dentro de la app, ruta `cliente`)
- [x] 5.2 Usuarios y sedes (rutas `usuarios`, `sedes`, `activar`)
- [x] 5.3 Clientes, sedes y vehículos (ruta `flota`) y plantillas de ejes (ruta `plantillas`)
- [ ] 5.4 Auditoría

### Fase 6 · Informes
- [x] 6.1 Informe con filtros (ruta `informe`: vista previa y recorrido por serial)
- [x] 6.2 Exportación (CSV a la hoja de compartir del sistema)
- [ ] 6.3 PDF de la orden

### Fase 7 · Distribución
- [ ] 7.1 EAS y primer APK instalable
- [x] 7.2 GitHub Actions (adelantada: es el único sitio donde corren las pruebas de base de datos)
- [ ] 7.3 Build de iOS
- [ ] 7.4 Envío a tiendas

---

## Módulos del dominio ya implementados

| Módulo | Qué contiene |
|---|---|
| `identidad` | UUID en cliente, respaldo sin crypto, código de referencia offline |
| `tipos` | Enums compartidos, catálogo de servicios, tipo `Veredicto` |
| `orden/estados` | Máquina de estados con permisos por rol y motivos obligatorios |
| `orden/firma` | Firma atada a versión, permisos de edición, autoaprobación |
| `orden/congelado` | Estampado de identidad al cerrar, requisitos de cierre |
| `llanta/dot` | Lectura del DOT y cálculo de vencimiento a 6 años |
| `llanta/medicion` | Desgaste, umbrales por eje, hermanas del eje, coherencia de configuración |
| `catalogo/normalizacion` | Clave normalizada, distancia de edición, duplicados y parecidos |
| `folio/folio` | Formato, parseo y distinción entre folio y referencia temporal |
| `tiempo/habiles` | Días hábiles, plazo de aprobación tácita, recurrencias |
| `tiempo/zona` | "Hoy" en hora de Colombia (desfase fijo, sin horario de verano) |

Las funciones devuelven `Veredicto` (`{ permitido, codigo, mensaje }`) en vez
de lanzar excepciones o devolver booleanos pelados: la interfaz necesita
explicar **por qué** no se puede, no solo bloquear.

## Contratos (packages/contracts)

Esquemas Zod compartidos entre API y app. **Los enums salen del dominio**: no
se redefine ninguna lista aquí, porque duplicarla garantiza que en algún
momento se desincronicen.

| Archivo | Contenido |
|---|---|
| `comunes` | Primitivas: id, fecha, folio, DOT, presión, profundidad, paginación, error |
| `auth` | Login con empresa opcional y 2FA, refresh, recuperación, restablecer |
| `orden` | Alta de orden, medición por posición, firma, cambio de estado, recomendaciones |
| `catalogo` | Marcas, diseños, medidas, empresa, sedes, usuarios, clientes, vehículos, ejes, sincronización, fotos, informe |

Reglas de validación que conviene no perder:

- **La fecha se valida por componentes, no con `Date.parse`.** `2026-02-31`
  no falla en JavaScript: se convierte en silencio al 3 de marzo, y la orden
  quedaría guardada con una fecha distinta a la escrita.
- **El folio no viaja en el alta de la orden**: lo asigna el servidor.
- **Jerarquía obligatoria** marca → diseño → medida.
- **Llanta no identificada** exige motivo y no admite marca ni diseño.
- **La foto trae tope de 2 MB**: se comprime en el dispositivo antes de subir.
- **Se sincronizan operaciones, no registros.** Cada una con su id, que da la
  idempotencia.

## Base de datos (apps/api/prisma)

| Archivo | Contenido |
|---|---|
| `schema.prisma` | 24 tablas |
| `manual.sql` | Llaves compuestas, CHECK e índices parciales que Prisma no genera |
| `seed.ts` | Empresa completa y utilizable: 3 sedes, 5 usuarios, 3 configuraciones de eje, catálogo global, 1 cliente con 3 vehículos |

### Cómo aplicar la migración

```bash
cd apps/api
npx prisma migrate dev --create-only --name init
cat prisma/manual.sql >> prisma/migrations/<timestamp>_init/migration.sql
npx prisma migrate dev
npm run seed
```

El SQL manual va **dentro** de la migración, no aparte: si se aplica después
puede haber una ventana en la que los datos entren sin las restricciones.

### Verificación automatizada

`apps/api/src/schema.test.ts` lee el esquema y comprueba las invariantes de
arquitectura que Prisma no valida: que toda tabla operativa lleve
`empresaId`, que los índices empiecen por él, que no haya `Float`, que los
ids no se generen en la base de datos, que exista columna de desactivación y
que las anclas de las llaves compuestas estén declaradas.

Está probada con mutación: al meter un `Float`, quitar `empresaId` de un
índice o poner `@default(uuid())`, las pruebas fallan.

**Los binarios de Prisma no se descargan en el entorno de desarrollo asistido**
(`binaries.prisma.sh` bloqueado), así que `prisma validate`, `generate` y las
migraciones se corren en la máquina del desarrollador.

## Aislamiento (tarea 1.2)

Dos capas independientes:

1. **Llaves foráneas compuestas** (`manual.sql`) — impiden *escribir* datos
   cruzados: una orden no puede referenciar un cliente de otra empresa.
2. **Row Level Security** (`rls.sql`) — impide *leer* datos ajenos aunque la
   consulta no filtre.

### Cómo lo usa el backend

Cada petición abre una transacción y fija el contexto:

```sql
BEGIN;
SELECT set_config('app.empresa_id', '<id del token>', true);
SELECT set_config('app.rol',        '<rol>',          true);
SELECT set_config('app.usuario_id', '<id>',           true);
SELECT set_config('app.cliente_id', '<id o vacío>',   true);
```

`true` significa LOCAL: el valor muere con la transacción y no se filtra a la
siguiente petición que reutilice la conexión del pool. **Hay una prueba que
lo verifica.**

La API se conecta con el rol `tiretrack_app`, **nunca como dueño de las
tablas**: el dueño se salta las políticas y `FORCE` existe justamente para
eso.

### Reglas por rol dentro del tenant

- **Técnico**: ve los clientes de la empresa (riesgo aceptado, documentado),
  pero solo las órdenes asignadas a él.
- **Cliente**: solo su `clienteId`, y no ve el historial de devoluciones
  internas entre coordinador y técnico.
- **Sin contexto**: cero filas. Falla cerrado — el olvido cierra la puerta,
  no la abre.

### Dos fallos reales que encontraron las pruebas

- El bloque `DO` que activa RLS era **atómico**: una sola tabla inexistente
  en el arreglo hacía fallar el bucle entero y **ninguna** tabla quedaba
  protegida, en silencio. Ahora salta las que no existen.
- La tabla **`Empresa` no tenía política**: cualquier empresa podía listar a
  todas las demás con sus NIT.

### Verificación

`apps/api/src/pruebas/` corre contra PostgreSQL real. La prueba de arranque
comprueba que **todas** las tablas quedaron con RLS forzado antes de empezar:
sin ese guardia, un fallo al aplicar las políticas dejaría las pruebas en
verde mientras el aislamiento no existe.

Probado con mutación: cambiar una política a `USING (true)` hace fallar 12
pruebas.

## Autenticación (tarea 1.3)

Las reglas viven en `packages/domain/src/acceso/politica.ts` —cuántos
intentos, cuánto duran los tokens, quién necesita doble factor— y se prueban
sin base de datos. En `apps/api/src/acceso/` está solo lo que necesita
infraestructura: cifrar, firmar y persistir.

| Pieza | Decisión |
|---|---|
| Contraseñas | bcrypt con costo 12 |
| Token de acceso | JWT de 15 minutos, con `empresaId`, `rol` y `clienteId` — es lo que alimenta el contexto de RLS |
| Refresh | 7 días, **guardado hasheado** con SHA-256 y **rotado en cada uso** |
| Recuperación | Token de un solo uso, 30 minutos, guardado hasheado |
| Bloqueo | 5 intentos, 15 minutos, temporal |
| Doble factor | Obligatorio para administrador y superadmin; opcional para el resto |

### Detalles que no son obvios y conviene no deshacer

- **El login responde igual ante un correo inexistente y ante una contraseña
  incorrecta**, y gasta el mismo tiempo: si la rama del correo inexistente
  respondiera de inmediato, medir la demora revelaría qué correos están
  registrados. Hay una prueba que compara ambas respuestas.
- **Pedir el segundo factor no cuenta como intento fallido.** Si contara,
  abrir el diálogo de 2FA cinco veces bloquearía la cuenta. Un código
  *incorrecto* sí cuenta.
- **El bloqueo se comprueba antes que la contraseña**, para no filtrar por
  tiempo de respuesta si la contraseña era correcta.
- **Cambiar la contraseña revoca todas las sesiones**: si alguien tomó la
  cuenta, queda fuera de inmediato.
- **El refresh se rota**: si se filtró, deja de servir al primer uso legítimo.
- **Correo repetido en dos empresas**: el servicio no elige por el usuario,
  devuelve las opciones para que indique cuál.
- El repositorio de acceso es **el único punto del sistema que consulta sin
  contexto de empresa**, porque la autenticación ocurre antes de saber a qué
  empresa pertenece quien pregunta. Por eso sus consultas son estrechas:
  buscan por correo o por id, nunca listan.

### Nota sobre otplib

La versión 13 cambió la API: expone `generateSecret`, `generateSync`,
`verifySync` y `generateURI` como funciones sueltas, **no** el objeto
`authenticator` de la v12. Los ejemplos que circulan suelen ser de la v12.

## Catálogo (tarea 1.4)

`packages/domain/src/catalogo/` tiene las reglas puras (normalización,
duplicados, ámbito y promoción). `apps/api/src/catalogo/` las aplica contra
la base.

| Decisión | Por qué |
|---|---|
| **`creadaEnCampo` se deriva del ROL**, no viaja como parámetro | El cliente no puede mentir sobre quién creó la entrada |
| **`esGlobal` no viaja al crear**: siempre nace false | Solo el superadmin promueve a global, en una operación aparte |
| **El duplicado exacto no se puede forzar**; el parecido sí | "Michelin" y "Michelim" podrían ser marcas distintas de verdad. Bloquear de más empuja al técnico a inventar variantes para poder guardar |
| **La validación se repite en el servidor** aunque la app ya la haga | La app puede estar desactualizada, con caché viejo, sin conexión, o no ser la app |
| **La profundidad de fábrica se convierte a número en el repositorio** | `pg` devuelve `numeric` como texto: sin convertir, el cálculo de desgaste produce `NaN` sin avisar |
| **Una marca en uso no se desactiva** | Hay órdenes cerradas que la referencian, y un documento cerrado no cambia porque alguien limpie el catálogo |
| **Una marca igual a la de otra empresa sí se crea** | No es duplicado: los catálogos propios son independientes |

## Flota (tarea 1.5)

`packages/domain/src/flota/reglas.ts` + `apps/api/src/flota/`.

### Versionado inmutable de plantillas de eje

Es la regla central de la tarea. Una plantilla **nunca se edita en sitio**:
`nuevaVersion()` crea una versión nueva, marca la anterior como no vigente y
mueve los vehículos activos.

Lo que NO pasa: las órdenes ya creadas conservan el id de la versión que
congelaron. Si se editara en sitio, el diagrama de una orden cerrada
cambiaría retroactivamente y dejaría de corresponder con lo que el cliente
firmó. **Hay una prueba específica de esto.**

La versión reemplazada no se borra ni se oculta del todo: deja de ofrecerse
para vehículos nuevos, pero sigue existiendo porque las órdenes viejas la
necesitan para dibujarse.

Si cambia el número de posiciones y hay vehículos usándola, se **pide
confirmación**: esos vehículos pasan a dibujarse distinto.

### Desactivación en cascada

Nada se borra. No se puede deshabilitar algo con **órdenes abiertas**
—quedarían apuntando a algo que ya no sale en ningún selector y nadie podría
cerrarlas— ni un padre con **hijos activos**. Se deshabilita de abajo hacia
arriba: vehículo → sede → cliente.

Una orden **cerrada** no impide deshabilitar.

### Permisos

| Acción | Quién |
|---|---|
| Crear clientes y sedes | Administrador, coordinador **y técnico** |
| Deshabilitar cualquier cosa | Administrador, coordinador |
| Crear vehículos | Administrador, coordinador |
| Definir plantillas de eje | **Solo administrador** — son estructura, no operación |
| Actualizar kilometraje | Todos los anteriores, incluido el técnico |

El técnico crea clientes porque es operativo: llega a una sede que no estaba
registrada y necesita poder trabajar. Deshabilitar sí es gestión.

### Otros detalles

- **El kilometraje que retrocede avisa pero no bloquea**: cambiar el odómetro
  es real y frecuente en flotas viejas. Requiere confirmación explícita.
- **Un vehículo nuevo no puede nacer con una versión reemplazada.**
- **La rueda interna** en ejes duales se calcula al aplanar las posiciones: es
  la que mira al centro, segunda por la izquierda y primera por la derecha.
- **`numeric` se convierte a número en el repositorio.** Comparados como
  texto, `"9" > "10"` da verdadero y los umbrales fallarían en silencio.

## Órdenes de servicio (tarea 1.6)

### Dos contadores, no uno

`OrdenServicio` tiene **`version`** y **`versionContenido`**. No es redundancia:

| Contador | Sube cuando | Sirve para |
|---|---|---|
| `version` | **Toda** escritura, incluido cambiar de estado | Bloqueo optimista |
| `versionContenido` | Solo mediciones, kilometraje, hallazgos, acción | Anclar la firma |

**La firma se ata a `versionContenido`.** Con un solo contador, avanzar la
orden en el flujo invalidaba la firma: el técnico firmaba, enviaba a revisión
—lo cual subía la versión— y al aprobar el sistema decía "la orden cambió
después de firmarse". No había cambiado: solo se había movido de estado.

Lo destaparon 13 pruebas de integración. La nota del coordinador **no** es
contenido: son instrucciones internas, no parte de lo que el cliente firma.

Las mediciones viven en otra tabla, así que al guardarlas hay que llamar a
`marcarContenidoCambiado()`. Sin eso la firma seguiría pareciendo vigente
después de cambiar una profundidad.

### Folio atómico

`UPDATE "Consecutivo" SET valor = valor + 1 ... RETURNING valor` en una sola
operación. PostgreSQL bloquea la fila hasta que la transacción termina.

**Nunca `count() + 1`.** Hay una prueba con 50 conexiones simultáneas: con
`UPDATE ... RETURNING` salen 50 folios distintos; con `count()+1` sale **uno
solo repetido 50 veces**. Era el error del prototipo.

El consecutivo es **por sede**: `OS-FUN-000001` y `OS-VDP-000001` conviven.

### Folio y trabajo sin conexión

- **Programadas** (con señal): folio real desde el inicio.
- **Imprevistas sin señal**: nacen con `codigoReferencia` tipo `FUN-K7M2` y
  reciben el folio al sincronizar. El código no se parece a un folio a
  propósito, y se conserva después para poder rastrearlas.
- `clientRequestId` da idempotencia: reenviar la misma operación devuelve la
  orden existente y **no consume un folio de más**.

### Otras reglas probadas

- El técnico crea sus órdenes en `en_proceso`; el coordinador en `programada`.
- Un técnico no puede asignarle una orden a otro.
- No se asigna un técnico que no pertenece a la sede.
- Un vehículo con orden abierta **avisa, no bloquea**: puede ser un correctivo
  urgente sobre un preventivo en curso.
- El **congelado ocurre al aprobar** (pasar a `pendiente_cliente`), no al
  cerrar: ese es el contenido que el cliente va a aprobar.
- Objetar limpia el plazo del cliente.
- El cierre por vencimiento queda marcado como `cierreTacito`.

## Fotos (tarea 1.7)

### El archivo nunca pasa por la API

El dispositivo recibe una **URL firmada** y sube directo al bucket. Si pasara
por el backend, cada foto ocuparía un proceso del servidor durante toda la
subida —que en 4G rural puede ser un minuto— y bastarían unos pocos técnicos
para agotarlo.

`Almacenamiento` es una interfaz. `AlmacenamientoS3` apunta a Cloudflare R2,
que no cobra salida de datos: las fotos se miran muchas más veces de las que
se suben. `AlmacenamientoMemoria` permite probar toda la lógica sin red.

### Dos pasos, no uno

1. **Pedir permiso** → se valida todo (tipo, tamaño, topes, permisos) y se
   entrega la URL. Validar después de que el técnico gastó sus datos móviles
   subiendo sería inútil.
2. **Confirmar** → se comprueba **contra el bucket** que el archivo llegó.

No se le cree al cliente: puede decir que subió sin haberlo hecho, y la orden
quedaría con una foto que al abrirla no existe. La foto se registra como
`confirmada = false` y **una foto sin confirmar no existe para el usuario**.

`limpiarSubidasIncompletas()` recoge las reservas huérfanas: el técnico pidió
la URL, perdió la señal y nunca subió. Sin eso, esas filas cuentan para los
topes y lo bloquean al día siguiente. Si el archivo sí llegó tarde, la
confirma en vez de descartarla.

### Otras decisiones

- **Tope de 2 MB** por foto: el dispositivo comprime antes de pedir la URL.
  Una foto de celular pesa 3-5 MB y 22 posiciones serían más de 60 MB.
- **6 fotos por posición, 20 por orden.** Más fotos de la misma llanta no
  agregan evidencia.
- **Las fotos no son públicas**: se entregan con URL de lectura temporal.
- **Agregar o borrar una foto invalida la firma**: es evidencia del servicio,
  cambia el documento.
- **Una foto de una orden aprobada no se borra**: la evidencia ya es parte
  del expediente que el cliente firmó.
- **Se borra primero el registro y después el archivo.** Al revés quedaría
  una foto listada que al abrirla no existe; así solo queda un objeto
  huérfano en el bucket, que es barato.
- La ruta empieza por `empresaId` para poder separar por tenant al copiar o
  dar de baja una empresa.

## Informe y auditoría (tarea 1.8)

`packages/domain/src/informe/formato.ts` define las columnas;
`apps/api/src/informe/servicio.ts` consulta y exporta.

### El formato replica el Excel del taller

**Una fila por posición de llanta**, con cuatro bloques: cabecera, servicios
marcados con X, llanta intervenida y llanta desmontada.

Las columnas de servicio **salen del catálogo**, no de una lista escrita a
mano: si mañana se agrega un servicio, el informe gana esa columna sola. Hay
una prueba que verifica que los grupos sumen exactamente las columnas que hay
— si se desalinean, todo el informe queda corrido.

### Detalles del CSV que importan en la práctica

- **Separador `;`**, no coma: Excel en configuración española interpreta la
  coma como separador decimal y las profundidades se parten en dos columnas.
- **BOM al inicio**: sin él Excel muestra "PosiciÃ³n" en vez de "Posición".
- **El estado de la orden va en el archivo**: quien lo reciba debe poder ver
  si esas mediciones estaban aprobadas o eran preliminares.
- **Una llanta sin identificar dice "SIN IDENTIFICAR"**, no queda en blanco.
  El blanco parece un olvido; esto fue una decisión del técnico en campo.

### Búsqueda por serial

Busca en el serial **montado y en el desmontado**: quien rastrea una llanta no
sabe de antemano si en esa visita entró o salió.

`trazabilidad()` devuelve el recorrido cronológico —vehículo, posición y
profundidad en cada fecha— y el desgaste acumulado. Es lo que permite ver que
una llanta se rotó y cuánto duró.

### Auditoría

Toda exportación registra usuario, rol, IP, cantidad de registros, folios
—recortados a 20—, cuántas órdenes iban sin cerrar, desde dónde se exportó y
**los filtros usados**.

Guardar los filtros importa tanto como el conteo: no es lo mismo exportar una
orden propia que la cartera de un cliente entero en un rango de seis meses.

Un intento sin resultados **no** se registra: no hubo salida de datos.

### Rendimiento

Los servicios llegan **agregados en la misma consulta**, con un `array_agg`
correlacionado. Con 22 posiciones por orden, una consulta por posición sería
el problema clásico de las N+1 consultas.

## Trabajos programados (tarea 1.9) — cierra la Fase 1

`packages/domain/src/trabajos/reglas.ts` decide;
`apps/api/src/trabajos/programados.ts` ejecuta.

### Tres principios, porque nadie los está mirando

1. **Cada ítem en su propia transacción.** Un lote que se cae por una fila
   mala deja de correr durante días sin que nadie note. Hay una prueba con un
   disparador que hace fallar una orden concreta: las otras dos se cierran.
2. **Todo queda en auditoría.** Una orden cerrada sola sin rastro es
   indistinguible de una manipulación.
3. **Ante la duda, no actuar.** Saltarse una vuelta es recuperable; cerrar una
   orden que no debía, no.

### Cierre por vencimiento

El `UPDATE` lleva `AND version = $2 AND estado = 'pendiente_cliente'`: si el
cliente aprueba mientras el trabajo corre, no se pisa. Probado con **dos
instancias compitiendo de verdad**, no con una carrera simulada — fijar la
versión a mano antes no sirve, porque el trabajo lee ese mismo valor.

El cierre queda como `cierreTacito = true` con motivo explícito. **Nunca
aparenta que el cliente aprobó.**

### Órdenes recurrentes

- Nacen en **`programada`**, no en `en_proceso`: las genera el sistema pero
  las ejecuta alguien que aún no las ha visto.
- **No se genera si el vehículo ya tiene una orden abierta**, pero **sí se
  avanza la fecha**: si no, mañana vuelve a intentarlo y el registro se llena
  de intentos idénticos.
- **No se acumulan ciclos perdidos.** Si el servidor estuvo caído seis meses,
  `avanzarProxima` adelanta hasta el presente en vez de generar seis órdenes
  de golpe.
- La próxima se calcula **desde la fecha programada, no desde hoy**: si el
  trabajo corre tarde, la recurrencia mensual no debe correrse cada vez.
- `clientRequestId` determinista (`recurrente-{id}-{fecha}`): un reinicio del
  servidor no duplica la orden.

### Alertas

- Solo la **última medición** de cada posición. Una llanta aparece en cada
  orden donde se midió; alertar por todas llenaría la bandeja de repetidos
  que ya se resolvieron.
- El umbral es **el de la posición**, no uno global: el eje direccional exige
  más que el de arrastre.
- Se avisa **6 meses antes** del vencimiento por DOT: da tiempo a comprar y
  programar el cambio.
- Una llanta puede disparar **dos alertas a la vez** —vencida y gastada son
  motivos distintos para sacarla.
- **Sin DOT ni umbral no se inventa nada:** un dato faltante no es un dato
  malo.

## App móvil (tarea 2.1)

Expo 52 + React 18 + expo-router. `apps/mobile/src/diseno/` tiene los tokens
y los componentes base.

### El sistema visual está dimensionado para campo, no para escritorio

La app se usa **con guantes, bajo el sol y con las manos sucias**. Eso manda
sobre cualquier preferencia estética:

| Decisión | Por qué |
|---|---|
| Objetivo táctil mínimo **48**, cómodo **56** | Las guías piden 44; un dedo con guante es más ancho y menos preciso |
| Ningún texto baja de **13** | Se mira a distancia de brazo, con reflejo del sol |
| Folios y seriales en **monoespaciada** | Se leen y se dictan por teléfono |
| **El estado va en el texto, no solo en el color** | Bajo el sol los tonos se confunden, y hay técnicos con daltonismo |
| Tema oscuro **fijo**, no sigue al sistema | Mejor contraste a la intemperie, y todos ven lo mismo |
| Respuesta visual al toque | Con guantes no se siente el clic |
| `CampoNumerico` abre teclado numérico | Se capturan decenas de cifras por orden |
| Botón cargando **no dispara** la acción | Con señal mala el técnico toca dos veces |
| Gesto de volver atrás **deshabilitado** por defecto | Es fácil dispararlo sin querer mientras se captura |

Hay pruebas que verifican los tres primeros: si alguien baja un tamaño, falla.

### Pruebas de componentes: limitación conocida

Se prueban con **Testing Library de React sobre `react-native-web`**, no con
el renderizador nativo: `@testing-library/react-native` importa internos de
React Native con sintaxis Flow que Vitest no transpila.

Esto cubre bien el **comportamiento** —qué se muestra, qué pasa al tocar, qué
anuncia a un lector de pantalla—, que es lo que puede romperse sin que nadie
lo note. **La apariencia real se valida en el emulador**, que no está
disponible en el entorno de desarrollo asistido.

### Versiones que hay que respetar

Expo 52 trae **React 18**. Varios paquetes ya exigen React 19 y rompen la
instalación:

- `@testing-library/react-native` **14** pide React 19 → se usa la **12.9**
- `react-dom` debe fijarse en **18.3.1**; si npm instala la 19 el árbol no
  resuelve
- `react-native-web` **0.19**, no la 0.21

## Base local del dispositivo (tarea 2.2)

`apps/mobile/src/datos/`. SQLite con `expo-sqlite` 15 (la versión de Expo 52;
la 57 es de otro SDK y no funciona).

### No es una copia del esquema del servidor

Guarda solo lo que el técnico necesita sin señal, más la cola de operaciones.

- **Sin `empresaId` en las tablas.** El dispositivo pertenece a un usuario de
  una empresa; si cambia, se borra la base entera. Más simple y más seguro
  que filtrar en cada consulta.
- **Los catálogos son caché**: se reemplazan enteros al sincronizar.
- **Órdenes y mediciones son propiedad del dispositivo** hasta que el
  servidor confirma. Es lo único que no se puede perder.

### Guardar y encolar van en la misma transacción

Es la garantía central del trabajo sin conexión: o queda el dato **con** su
operación, o no queda nada. Si se separaran, un corte entre las dos dejaría
una medición que el servidor nunca vería. Al mutar esa unión fallan 7 pruebas.

**Cada posición es su propia operación**: si se cae la señal a mitad de
captura, lo anterior ya está encolado.

### Migraciones

- **Cada una en su propia transacción.** Una migración a medias en el celular
  de un técnico en Fundación no se arregla a mano.
- **Nunca se editan una vez publicadas.** Un dispositivo puede llevar semanas
  sin actualizar; aplicar una versión distinta de la 1 sobre una base que ya
  tiene la original deja el esquema en un estado que nadie previó. Para
  cambiar algo, se agrega una migración nueva.
- La lista es **inyectable** para poder probar el fallo sin mutar la
  constante exportada.

### Reintentos con espera creciente

`marcarOperacionFallida` multiplica la espera por dos en cada intento, con
tope de una hora. Martillar un servidor caído desde cincuenta dispositivos no
ayuda a que se levante. La operación no se pierde: guarda el último error
para poder diagnosticar.

### Pruebas

Corren sobre **`better-sqlite3`**, que es el mismo motor SQLite que usa el
dispositivo. No es un doble: restricciones, tipos y transacciones se
comportan igual.

## Motor de sincronización (tarea 2.3)

`apps/mobile/src/datos/sincronizacion.ts` decide; `clienteHttp.ts` habla con
el servidor.

Es la pieza más delicada del proyecto: un error aquí no se ve el mismo día,
se ve tres semanas después cuando alguien nota una orden facturada dos veces.

### Cuatro reglas

1. **Se envían operaciones, no estado.** Cada acción es un evento con id
   propio; reintentar no duplica.
2. **El orden se respeta.** `guardar_medicion` nunca antes que `crear_orden`
   de esa misma orden.
3. **Un fallo no detiene la cola**, salvo que bloquee a lo que depende de él.
4. **El servidor manda en los conflictos.** El dispositivo no negocia.

### Traducir bien la respuesta importa tanto como enviarla

| Respuesta | Interpretación | Qué hace |
|---|---|---|
| 2xx | aplicada | Sale de la cola |
| 409 con `YA_APLICADA` | **duplicada** | Sale de la cola: el envío anterior sí llegó y se perdió la respuesta |
| 409 sin ese código | conflicto | Sale de la cola y **se avisa para recargar**; reintentar daría lo mismo |
| 400 / 422 / 404 | rechazada | Sale de la cola; reintentar mañana dará el mismo error |
| 401 / 403 | rechazada | La sesión expiró |
| 5xx, red, tiempo agotado | sin conexión | **Se reintenta** |

Confundir un 400 con una falta de red haría reintentar algo que nunca va a
funcionar, gastando los ocho intentos y los datos móviles del técnico.

### Decisiones que las pruebas protegen

- **Se corta la cola al primer fallo de red.** Si no hay señal, las
  siguientes fallarán igual y cada intento cuenta para el descarte.
- **Si `crear_orden` falla, sus mediciones no se envían.** Mandar una
  medición de una orden que el servidor no tiene solo gasta un intento.
- **No arrancan dos sincronizaciones a la vez.** La idempotencia del servidor
  lo absorbería, pero le costaría al técnico el doble de datos móviles.
- **Las operaciones atascadas no se borran solas.** Representan trabajo real;
  descartarlas en silencio sería perder una jornada sin que nadie se entere.
  Se muestran para que una persona decida.
- La clave de idempotencia es el **id de la operación**, no el del recurso:
  guardar la misma posición dos veces son dos operaciones y ambas valen.

### La prueba que justifica el diseño

*"Una jornada sin señal"*: 20 operaciones acumuladas sin red, reconexión, y
las 20 se aplican **exactamente una vez**. Más una variante donde la señal se
corta a mitad del envío y el resto se recupera en el siguiente intento.

El servidor simulado implementa idempotencia de verdad, para que la prueba de
duplicados signifique algo.

## Sesión y almacenamiento seguro (tarea 2.4) — cierra la Fase 2

`apps/mobile/src/sesion/`.

### Los tokens no van a SQLite

Van al llavero del sistema —Keystore en Android— con `expo-secure-store`. Un
celular de trabajo se pierde, se presta y a veces se revende; un token en el
sistema de archivos lo lee cualquiera con acceso al dispositivo, **y ese
token abre la cartera completa de clientes de la empresa**.

En la base local solo queda lo que la app necesita sin señal: id de usuario,
empresa, rol y sede principal. Hay una prueba que verifica que el token **no**
aparezca en ninguna fila de SQLite.

**No se exige biometría para leerlo.** El técnico abre la app decenas de
veces al día con guantes; pedir huella cada vez lo llevaría a anotar la
contraseña en un papel.

### Cerrar sesión avisa antes de borrar

`cerrar()` **no cierra** si hay operaciones o fotos sin enviar: devuelve un
aviso con la cuenta. Borrar la base con mediciones pendientes es perder una
jornada de campo y eso no se recupera — el camión ya se fue.

Con `forzar = true` sí cierra, y **devuelve qué se descartó** para poder
decírselo a la persona. Nunca se descarta en silencio.

`cerrarPorRevocacion()` es la excepción: el servidor invalidó la sesión, el
token ya no sirve y no hay nada que preguntar. También informa qué se perdió.

### Cambiar de usuario borra la base local

Si entra un usuario distinto —o el mismo en otra empresa— se vacía todo
antes de empezar. El técnico nuevo no debe ver las órdenes del que usó el
celular ayer, y mezclar datos de dos empresas sería una fuga entre clientes.

Entrar con el **mismo** usuario conserva el trabajo: refrescar la sesión no
puede costarle al técnico su captura.

### Los permisos se leen de la sesión, no del servidor

`sedesPermitidas()` y `perteneceASede()` salen del perfil guardado. En campo
no hay señal para consultarlo.

## Listado de órdenes (tarea 3.1)

`apps/mobile/src/ordenes/`. La lógica está en `lista.ts`, separada de la
pantalla, **porque el orden en que aparecen no es un detalle visual**: decide
qué camión atiende primero alguien que abre la app con veinte pendientes y el
sol encima.

### Prioridad de las secciones

```
Devueltas para corregir → En curso → Por hacer → Esperando → Terminadas
```

**Las devueltas van arriba de todo**, incluso sobre las que están en curso.
El técnico ya dio ese trabajo por terminado; si no la ve arriba, no la ve. Y
alguien está esperando esa corrección.

Una orden `en_proceso` **con** `motivoDevolucion` es "devuelta"; sin él es
"en curso". Son situaciones distintas aunque compartan estado.

### Dentro de cada grupo, lo más antiguo primero

Es lo contrario a una bandeja de correo, y es deliberado: una orden
programada hace una semana lleva más tiempo esperando que la de hoy.

Las **terminadas** se ordenan al revés, porque ahí lo que interesa es lo
reciente.

### Detalles de la tarjeta

- **El progreso se lee como cuentas**, no como porcentaje: "17 de 22" se
  entiende mejor que "77%" cuando lo que falta es tocar cinco casillas más.
- **Un punto naranja** marca lo que tiene cambios sin enviar. El técnico lo
  reconoce de reojo sin leer.
- **El motivo de devolución se muestra completo en la tarjeta**, para saber
  qué corregir sin abrir la orden.
- El **código de referencia** (orden creada sin señal) se pinta en ámbar y no
  se parece a un folio: nadie debe confundirlo con el consecutivo definitivo.
- La búsqueda cubre **folio, vehículo y cliente**: son las tres formas en que
  el técnico identifica una orden cuando le preguntan por teléfono.

### Los datos salen de la base local

La pantalla nunca espera al servidor. El técnico la abre en sitios sin señal y
tiene que ver su trabajo igual; la sincronización corre por detrás.

## Detalle de la orden (tarea 3.2)

`apps/mobile/src/ordenes/detalle.ts`.

### Toda acción bloqueada explica por qué

Un botón gris sin motivo en el patio termina en una llamada al coordinador.
`accionesDisponibles()` devuelve `{ habilitada, motivo }`, y hay una prueba
que recorre todas las bloqueadas y **exige que ninguna venga sin explicación**.

### Los requisitos se muestran todos a la vez

`requisitosParaEnviar()` devuelve los tres —mediciones, kilometraje, firma—
cumplidos y pendientes, no solo el primero que falla. El técnico está en el
patio y necesita saber **todo** lo que le falta antes de guardar el celular,
no descubrirlo de a uno.

### La firma en el dispositivo

Se ancla a **`version_contenido`**, igual que en el servidor:

- **Firmar no sube `version_contenido`**: capturar la firma no modifica el
  documento que se está firmando.
- **Cambiar de estado tampoco**: mover la orden en el flujo no invalida nada.
- **Guardar una medición sí la invalida**, y el mensaje aclara que no es
  culpa del técnico.

Probado contra SQLite real con las tres situaciones. Al anclar la firma a
`version` en lugar de a `version_contenido`, fallan dos pruebas.

### Huecos del repositorio que aparecieron al construir

`OrdenLocal` no exponía `firmaNombre`, `firmaCedula` ni `firmaVersion`, y no
existían `firmar()` ni `cambiarEstado()`. Las columnas estaban en SQLite desde
la 2.2 pero nada las leía ni escribía.

### El diagrama muestra los huecos

`resumirPosiciones()` devuelve **todas** las posiciones de la configuración,
capturadas o no. Mostrar lo que falta es la razón de existir del diagrama.

## Diagrama de llantas (tarea 3.3)

`apps/mobile/src/ordenes/diagrama.ts` (disposición) y `DiagramaLlantas.tsx`
(componente).

### Corresponde con lo que el técnico ve de pie frente al camión

Ejes de adelante hacia atrás, izquierda a la izquierda, chasis al centro. Una
posición mal ubicada hace que mida la llanta equivocada, **y eso no se
detecta después**: el dato queda mal para siempre.

- **La marca de rueda interna se conserva.** Si se pierde, el técnico mide la
  exterior creyendo que es la interna. Al mutarlo falla una prueba.
- **Las posiciones sin capturar se dibujan igual, vacías.** Mostrar los huecos
  es la razón de existir del diagrama; al ocultarlas fallan 11 pruebas.
- **El número del eje lleva prefijo `E`.** Sin él, "1" del eje se confunde con
  "1" de la posición — lo destapó una prueba que encontró dos elementos con el
  mismo texto, y en pantalla pasaba lo mismo.

### La alerta de profundidad usa el umbral de cada eje

El direccional exige 3,0 y el de tracción 2,5: con 2,8 uno alerta y el otro
no. Un umbral global haría saltar alertas falsas en los ejes de arrastre y
callar las reales en el direccional.

**La alerta pesa más que "no identificada"**: una llanta gastada hay que
sacarla aunque no se sepa cuál es.

### Ayudas a la captura

- `siguienteSinCapturar()` lleva de corrido de una posición a la siguiente.
  Con 22 posiciones son 22 vueltas al diagrama evitadas. Al llegar al final
  vuelve a los huecos de atrás.
- `hermanaCapturada()` ofrece copiar de otra posición **del mismo eje**: las
  llantas de un eje suelen ser idénticas. No ofrece copiar de una sin
  identificar, porque copiar datos en blanco no ahorra nada.

### La configuración vive en el dispositivo

`posicionesDe()` y `guardarPosicionesEje()` en el repositorio local — otro
hueco que apareció al construir. Se reemplaza entera al sincronizar: si el
coordinador creó una versión con menos posiciones, las viejas no pueden
quedar pegadas.

### Accesibilidad

Cada casilla anuncia *"Posición 4, sin identificar"*. El color solo no basta:
bajo el sol se pierde y hay técnicos con daltonismo.

## Editor de posición (tarea 3.4)

`apps/mobile/src/ordenes/reglasEditorPosicion.ts`. Es donde el técnico pasa el
noventa por ciento del tiempo y lo que decide si el sistema **se usa o se
finge usar**.

### Dos principios

**1. Nada obligatorio que el técnico no pueda saber.** Si una llanta está
montada del revés y no se ve el serial, exigirlo lo empuja a inventarlo — y un
dato inventado es peor que uno ausente. Se marca "no identificada" **con
motivo**, elegido de una lista: un campo libre produce veinte formas de
escribir lo mismo.

**2. Se avisa, no se bloquea.** Tres niveles:

| Nivel | Qué es | Efecto |
|---|---|---|
| `error` | Imposible (DOT de 3 letras, profundidad negativa) | Bloquea |
| `advertencia` | Raro pero posible (45 mm, llanta vencida) | Pide confirmar una vez |
| `informacion` | El hallazgo mismo (presión baja) | Solo se muestra |

Una profundidad de 45 mm probablemente sea un error de dedo, pero una llanta
de cargador puede tenerla. El técnico está frente a la llanta; la app no.

### Copiar de una hermana copia la LLANTA, no las mediciones

Marca, diseño y medida sí. **Serial, DOT, profundidad y presión no**: son
propias de cada llanta y copiarlas sería fabricar datos. Al mutarlo fallan dos
pruebas.

### Se precarga el PSI objetivo como calibrado, no como encontrado

El calibrado es el valor al que el técnico va a dejar la llanta casi siempre;
escribirlo 22 veces por orden es tiempo perdido. **La presión encontrada hay
que medirla**: precargarla sería sugerir un dato falso.

### Catálogo en el dispositivo

Seis tablas que estaban en el esquema desde la 2.2 sin un solo método para
leerlas. Ahora: `marcas()`, `disenosDe()`, `medidasDe()`, `servicios()`,
`tiposParche()`, más creación en campo y `guardarCatalogo()`.

- **Los diseños del tipo de eje van primero**: al técnico se le ofrecen los de
  tracción cuando está en un eje de tracción, no los cincuenta de la marca.
  Los demás siguen disponibles, al final.
- **Sincronizar el catálogo NO borra lo creado en campo.** Todavía no llegó al
  servidor; borrarlo perdería el trabajo del técnico y dejaría mediciones
  apuntando a una marca inexistente.
- `ultimaMedicionDePosicion()` da la llanta que estaba antes, para precargar
  el bloque de desmontada.

### El componente

El formulario sigue **el orden en que el técnico trabaja** —identifica, mide,
registra qué hizo— no el orden de la estructura de datos. Un formulario
ordenado por tabla obliga a saltar de un lado a otro con el celular en una
mano.

- **El interruptor "no se pudo identificar" está a la vista**, con su
  explicación. Si cuesta encontrarlo, el técnico escribe cualquier cosa en el
  serial.
- **Cascada marca → diseño → medida.** Cambiar la marca limpia las dos
  siguientes: un diseño de otra marca sería un dato imposible.
- **Sin catálogo descargado se dice**, en vez de mostrar una lista vacía.
- **Solo se ofrecen los servicios `porLlanta`**: el lavado del vehículo no es
  de esta posición.
- **Las advertencias se muestran juntas al intentar guardar**, no una por
  campo mientras escribe. Interrumpir la captura es peor; y el botón cambia a
  "Guardar de todos modos" para que se vea qué va a pasar.
- Los campos numéricos **aceptan coma decimal**: el teclado del técnico tiene
  coma, no punto.

### `accessibilityState` no llega a la presentación

Descubierto por una prueba: `accessibilityRole` y `accessibilityLabel` sí se
propagan, pero **`accessibilityState` se pierde en silencio**. La forma
moderna (`role` + `aria-checked` / `aria-busy`) es la que funciona.

Estaba afectando al estado "cargando" del botón base y al de los servicios
marcados. Si se agregan controles con estado, usar la forma moderna.

### Nota de método

Esta vez revisé el repositorio **antes** de construir, tras encontrar huecos
en 3.1, 3.2 y 3.3. Aparecieron seis tablas sin acceso. Conviene seguir
haciéndolo.

## Contexto de datos (tarea 3.5)

`apps/mobile/src/app/ProveedorDatos.tsx`. Une las cuatro pantallas con la
base local.

### Dos reglas

**1. Todo se lee del dispositivo, nunca del servidor.** La pantalla no espera
a la red: el técnico abre la app bajo un camión sin señal y tiene que ver su
trabajo igual.

**2. Escribir es inmediato; sincronizar es aparte.** `guardarMedicion()`
termina cuando toca SQLite. Si esperara al servidor, cada posición tardaría lo
que tarde la red — y sin red no se podría trabajar. Al mutarlo para que
espere, fallan dos pruebas.

### La sincronización no se dispara al guardar

Con 22 posiciones serían 22 intentos; en señal intermitente cada uno gasta
batería y datos para fallar igual. Corre:

- **cada minuto** en segundo plano,
- **al tirar de la lista** hacia abajo — el técnico decide cuándo gastar
  datos,
- **al cambiar de estado**, porque el coordinador está esperando esa orden en
  su bandeja.

### El catálogo se pide por nivel

`catalogoPara(marca, diseño, tipoEje)` carga los diseños solo cuando hay marca
elegida, y las medidas solo cuando hay diseño. Un catálogo completo puede
tener miles de medidas y cargarlas para elegir una es tiempo de pantalla en
blanco frente al camión.

### Nombres de la flota

`contextosDeOrdenes()` resuelve cliente, sede y vehículo de **todas** las
órdenes en una consulta. Pedirlo por orden haría un viaje a SQLite por fila:
con veinte órdenes son veinte cada vez que la lista se refresca.

**Si la flota no se ha descargado se muestra el identificador**, no un vacío:
un código feo es más útil que una línea en blanco — al menos se puede buscar
y dictar por teléfono. La orden puede llegar antes que la flota si la
sincronización se interrumpió a mitad.

La prueba que lo protege **cuenta las consultas reales contra SQLite**, no
las llamadas al repositorio: el proveedor crea el suyo y espiar el de la
prueba no observaría nada.

### Rutas de la app

```
app/ordenes.tsx                          listado
app/orden/[id]/index.tsx                 detalle con diagrama
app/orden/[id]/posicion/[numero].tsx     editor
```

Expo Router **no admite `[id].tsx` y `[id]/` como hermanos**: el detalle va en
`[id]/index.tsx`.

Al guardar una posición, el editor **lleva directo a la siguiente sin
capturar** en vez de volver al diagrama. Con 22 posiciones son 22 vueltas
evitadas, y el técnico captura de corrido como trabaja. Si ya se había
capturado, se reanuda con lo que había: entra a corregir un dato, no a
rehacer la posición.

### El detalle se recarga solo

`useEffect` depende de `ordenes`, que cambia tras cada guardado. Así el
diagrama refleja la posición recién capturada sin que el editor tenga que
avisar — si no, el técnico no sabe si quedó.

### `useDatos` falla si no hay proveedor

Un contexto ausente produce pantallas vacías sin explicación, que es difícil
de rastrear. Mejor fallar claro y temprano.

## Firma del cliente (tarea 3.6)

`packages/domain/src/orden/captura-firma.ts` y
`apps/mobile/src/ordenes/CapturaFirma.tsx`.

### El consentimiento bloquea la captura, no la acompaña

El trazo es un **dato biométrico** y la Ley 1581 de 2012 exige autorización
informada antes de recolectarlo. Por eso:

- **Se comprueba antes que cualquier otro dato.** Capturar el trazo y después
  preguntar sería recolectar el dato antes de tener permiso. Al moverlo al
  final de las validaciones, falla una prueba.
- **El lienzo no responde y los campos están bloqueados** hasta aceptar. Con
  el lienzo activo sin consentimiento, falla otra.
- **El texto completo está a la vista**, no detrás de un enlace: informar es
  parte del requisito y un enlace que nadie abre no informa.
- Se guarda **qué versión del texto** aceptó cada persona
  (`VERSION_CONSENTIMIENTO`). Si cambia la política hay que poder saberlo.

Esto cierra el punto **B3** de los bloqueantes del MVP.

### Se guardan puntos, no una imagen

El trazo se serializa como lista de segmentos, redondeado a un decimal:

- ocupa mucho menos que un PNG y se sincroniza por conexiones malas,
- se puede redibujar a cualquier tamaño, incluido el PDF de la orden,
- la precisión de un dedo no da para más de un decimal.

Un trazo corrupto **no impide abrir la orden**: se muestra sin firma.

### Un roce no es una firma

Menos de 8 puntos se rechaza: suele ser la palma tocando la pantalla.

### Migración 2

`firma_trazo`, `firma_cargo`, `firma_fecha_hora`, `firma_consentimiento`. Se
agregó como migración nueva en vez de editar la 1, siguiendo la regla propia
— y de paso el sistema de migraciones quedó ejercitado de verdad.

La prueba de migración fallida ahora compara contra `VERSION_ESQUEMA` en vez
de un número fijo, para que agregar migraciones no la rompa.

### Otro hallazgo de accesibilidad

`editable={false}` produce **solo `readonly`**. Para una barrera de
consentimiento eso es impreciso: el campo no es de solo lectura, está **no
disponible**. Se declara `aria-disabled` explícitamente.

Habilitado se expresa por **ausencia** del atributo, que es lo correcto en
HTML.

### `react-native-svg` en pruebas

Misma limitación que Testing Library para React Native: trae sintaxis Flow sin
transpilar. Hay un doble en `src/pruebas/dobles/`. El dibujo real se valida en
el dispositivo; **la construcción de la ruta está probada en el dominio**
(`trazoASvg`), que es donde podría haber un error de lógica.

## Envío a revisión (tarea 3.7)

`apps/mobile/src/ordenes/envio.ts` + `PantallaEnvio.tsx`.

Es la acción **menos reversible** del técnico: a partir de aquí no puede
editar y alguien más queda esperando.

### Impedir y advertir no son lo mismo

| Impiden | Advierten |
|---|---|
| Ninguna posición capturada | Posiciones sin capturar |
| Falta el kilometraje | Llantas bajo el mínimo |
| Falta la firma o quedó invalidada | Fotos sin subir |
| | Sin hallazgos escritos |

**Las posiciones faltantes advierten, no impiden.** Un camión puede llegar con
dos llantas desmontadas en el taller; obligar a inventar mediciones para poder
cerrar sería peor que dejar constancia de que faltaron. Al convertirlo en
bloqueo, fallan 4 pruebas.

Con advertencias se pide **confirmar una vez**: enviar así es legítimo, pero
no debe pasar por descuido.

### Las consecuencias se muestran ANTES del botón

- que pierde la edición,
- que el coordinador puede devolvérsela,
- y **si hay cosas sin sincronizar, que la orden queda en el dispositivo**.

Sin lo último el técnico cree que envió y la orden sigue en el celular. Al
quitarlo fallan 3 pruebas.

### Un fallo que destapó una prueba

Yo había fijado `esTecnicoAsignado: true` a mano en la llamada a la máquina de
estados. Eso **anula la comprobación de permiso**: cualquiera pasaba. La
prueba del rol `cliente` lo destapó.

Ahora se deriva de `orden.tecnicoId === usuarioId`, y `OrdenLocal` expone el
técnico asignado — otro campo que estaba en SQLite sin leerse.

La lección: cuando una prueba de permisos pasa demasiado fácil, conviene
mirar si el permiso se está comprobando de verdad.

## Bandeja del coordinador (tarea 4.1)

`apps/mobile/src/coordinador/`.

### El coordinador devuelve, no corrige

Si editara las mediciones, la orden dejaría de ser el registro de lo que el
técnico vio, y la firma del cliente dejaría de amparar lo que dice el
documento. Solo puede **aprobar**, **devolver con motivo** o **reasignar**.

### Lo dudoso se ve antes de abrir

Con veinte órdenes en la bandeja, **lo que no está en la tarjeta no se
revisa**. Cada tarjeta muestra:

| Señal | Clase |
|---|---|
| Firma que no ampara el contenido | crítica |
| Sin firma del cliente | crítica |
| Tú ejecutaste esta orden | atención |
| Posiciones faltantes | atención |
| Llantas bajo el mínimo | atención |
| Días esperando (desde 2) | atención |
| Sin hallazgos escritos | informativa |

**Las críticas suben en la lista**; entre iguales, lo que lleva más tiempo
esperando. Devolver tarde obliga al técnico a volver al vehículo cuando ya se
fue.

### La autoaprobación se marca, no se bloquea

En una sede de dos personas puede ser inevitable. Pero se avisa en la tarjeta
**y otra vez al decidir** —que es el momento en que la persona elige— con la
advertencia de que queda registrado. Al quitar la señal fallan 2 pruebas.

### Devolver exige un motivo con sustancia

Mínimo 10 caracteres: un "revisar" suelto obliga al técnico a volver sin
saber qué mirar.

**Se ofrecen sugerencias** generadas a partir de las señales detectadas, con
las posiciones concretas que faltan. Escribir a mano en el celular es lento, y
lo lento se omite: sin sugerencias el coordinador escribe "revisar" y no
resuelve nada. Hay una prueba que verifica que **las sugerencias pasen su
propia validación** — una sugerencia que el sistema rechazaría sería absurda.

## Bandeja conectada (tarea 4.2)

### Migración 3

Tabla `tecnico` (el coordinador reasigna sin señal), más `tecnico_nombre` y
`enviada_revision_en` en la orden.

**Los técnicos inactivos no se listan**: reasignar a alguien que ya no trabaja
deja la orden en un limbo que nadie nota hasta que el cliente reclama.

### Dos cosas se congelan al entrar a revisión

- **`enviada_revision_en`**: permite contar los días de espera. Los otros
  cambios de estado no la tocan.
- **`tecnico_nombre`**: quién ejecutó el trabajo. Si después se reasigna o se
  da de baja al técnico, la bandeja debe seguir mostrando de quién fue.

### Reasignar no invalida la firma

Cambiar quién ejecuta la orden no altera lo que el cliente firmó, así que
`version_contenido` no se mueve. Al mutarlo, falla una prueba.

### Los días de espera se cuentan en el dispositivo

Contra el reloj local, no contra el servidor: el coordinador revisa sin señal
y no puede depender de que alguien le diga cuánto lleva esperando cada orden.

### Una mutación que no se detectó, y lo que reveló

Cambié el código para usar el técnico actual en vez del congelado y **ninguna
prueba falló**. La causa no era la prueba: era que **nada escribía
`tecnico_nombre`**, así que el valor siempre caía en el identificador y la
diferencia era invisible.

Agregué el estampado al entrar a revisión y la prueba que lo cubre. Ahora la
mutación sí falla.

La lección: **una mutación que no se detecta puede significar que el código
mutado nunca se ejecutaba**, no que falte una prueba.

### Fábrica de datos de prueba

`src/pruebas/fabrica.ts`. Agregar un campo a `OrdenLocal` obligaba a parchear
los mismos datos en cinco archivos, y ese trabajo mecánico invita a copiar
mal. Ahora se agrega una vez.

## Reasignación (tarea 4.3)

`apps/mobile/src/coordinador/ReasignarOrden.tsx`.

### El técnico nuevo hereda el contexto

Si recibe una orden a medias sin saberlo, rehace lo hecho o se salta lo que
faltaba. La pantalla dice **antes de confirmar** qué hereda: *"Hereda 15
posiciones ya capturadas y le quedan 7 por capturar"*.

- **El técnico actual no se ofrece como opción**: invita al error.
- **Motivo obligatorio**, con cuatro predefinidos más texto libre. Queda en la
  auditoría: sin motivo, una reasignación es indistinguible de alguien
  quitándole trabajo a otro.
- Sin otros técnicos activos en la sede, se dice en vez de mostrar una lista
  vacía.

### Plurales en español

Una prueba atrapó **"posiciónes"** con tilde: el código armaba el plural
pegando `"es"` a `"posición"`. El plural de las palabras en *-ión* pierde la
tilde, así que **se escribe entero**, no por sufijo.

Revisé el resto: `foto → fotos` y `cambio → cambios` sí se pueden armar con
sufijo, porque no alteran la acentuación.

### Otro hueco, y un silencio evitado

`OrdenLocal` no exponía `sedeId`. Lo había escrito como
`tecnicosDeSede(d.orden.sedeId ?? "")`, y ese `?? ""` habría devuelto **una
lista vacía de técnicos sin ningún error**. Lo atrapó el compilador; se quitó
la reserva y se expuso el campo.

Los valores por defecto que hacen callar a un error son peores que el error.

## Sesión real y panel (tarea 4.4) — cierra la Fase 4

### No quedan roles fijos

`ProveedorSesion` expone el usuario; `useUsuario()` **falla si no hay
sesión** en vez de devolver un usuario vacío. Un contexto con id `""` y un rol
por defecto pasaría las comprobaciones de permiso de forma impredecible.

Al reemplazar los roles fijos apareció **otro fallo de permisos** en
`enviar.tsx`: pasaba `datos.orden.tecnicoId` como usuario, así que "¿eres el
técnico asignado?" siempre resultaba cierto. Es la misma clase de error que
el `esTecnicoAsignado: true` de la 3.7.

**Regla derivada:** el `usuarioId` de una comprobación de permiso sale
**siempre de la sesión**, nunca de la entidad que se está comprobando.

### Entrada según el rol

| Rol | Entra a |
|---|---|
| técnico | `/ordenes` directo — un panel intermedio sería un toque más con guantes |
| coordinador, administrador | `/panel` |
| sin sesión, cliente | `/ingresar` |

### El panel lista decisiones, no métricas

Solo lo que requiere acción: por revisar, esperando al cliente (con cuántas
**vencen pronto**, para llamarlo antes del cierre tácito), devueltas sin
corregir, en curso.

Las tarjetas **en cero se muestran igual, al final**: ver "0 por revisar"
también informa, y ocultarlas haría dudar si el panel cargó.

### Migración 4

`limite_cliente`, que calcula el servidor al aprobar. Sin él el coordinador
no puede ver sin señal qué órdenes está por dejar vencer el cliente.

### Arranque

`src/app/Arranque.tsx` abre la base, **migra antes que nada** y monta los
proveedores. Es código de unión con el dispositivo y no corre en Node; cada
pieza que ensambla está probada por separado. Si falla —casi siempre una
migración— muestra el error en vez de una pantalla en blanco.

`API_URL` por defecto es `http://10.0.2.2:4000/api/v1`: `10.0.2.2` es como el
emulador de Android llama al `localhost` de la máquina anfitriona. En
producción viene de `EXPO_PUBLIC_API_URL`.

## Auditoría previa a la capa HTTP (5.0)

Antes de escribir el servidor comparé lo que la app envía con lo que el
backend sabe recibir. Aparecieron dos pérdidas de datos silenciosas.

### 1. Operaciones descartadas por el cliente HTTP

`crear_marca`, `crear_diseno` y `reasignar` se agregaron al repositorio en
tareas posteriores **sin agregarse al cliente HTTP**. El cliente los trataba
como "operación desconocida", los rechazaba, y el motor los **sacaba de la
cola**. Una marca creada en campo o una reasignación desaparecían sin aviso.

**Causa raíz:** `RUTAS` estaba tipado `Record<string, …>`. Con
`Record<TipoOperacion, …>` el compilador exige una ruta para cada tipo — y al
cambiarlo señaló exactamente los tres que faltaban.

Hay una prueba que recorre todos los tipos y exige que ninguno se rechace por
desconocido.

### 2. Los rechazos borraban trabajo del técnico

El motor trataba cualquier 4xx como definitivo y eliminaba la operación.
Mientras el contrato entre app y servidor no esté asentado, **un campo mal
nombrado produce un 400 y eso borraba mediciones del celular**.

Contradecía el principio ya fijado para las atascadas. Ahora (migración 5) las
rechazadas **se apartan con su motivo**: no se reenvían solas, no cuentan como
pendientes de red, y se pueden **reintentar tras corregir la causa**. La
medición local queda intacta mientras tanto.

### Lo que falta del lado del servidor

**No existe servicio para guardar mediciones**, que es la operación más
frecuente de la app: 22 por orden. Tampoco hay servidor HTTP que exponga los
servicios existentes. Es lo siguiente.

## Contrato de mediciones (5.1)

`apps/mobile/src/datos/contrato.ts` + `src/pruebas/contrato.test.ts`.

### El servidor habría rechazado todas las mediciones

Pasé lo que el móvil encolaba de verdad por `zMedicionLlanta` —el esquema
que valida el servidor— y fallaba en cuatro frentes:

| Problema | Efecto |
|---|---|
| `null` donde el contrato espera **ausencia** | Rechazo de casi toda medición: pocas llegan completas |
| Ids de servicio (`srv-cal`) donde espera **nombres** | Rechazo de toda medición con servicios |
| Motivos inventados (`"Llanta interna sin acceso"`) donde espera **códigos** | Rechazo de toda llanta no identificada |
| `motivoNoId` en lugar de `motivoNoIdentificada` | **Pérdida silenciosa**: las claves desconocidas se descartan |

Antes de la corrección de la 5.0, cada rechazo habría **borrado la medición
del celular**.

### Causa raíz: vocabularios redeclarados

La app definió sus propias listas en vez de importarlas. `packages/contracts`
lo advierte en su cabecera desde la 0.3: *"duplicarla es garantizar que en
algún momento se desincronicen"*.

**Regla:** los vocabularios (motivos, estados, servicios) **se importan** de
`@tiretrack/contracts` o `@tiretrack/domain`. En la app solo vive la
**etiqueta** que se muestra (`ETIQUETA_MOTIVO`); lo que viaja es el código.

### La traducción vive en la frontera

`medicionAContrato()` convierte la medición local a la forma exacta del
contrato, en un solo sitio. Deja fuera a propósito:

- **`capturadoPorId`**: el servidor lo toma de la sesión. Si viajara,
  cualquiera podría firmar mediciones a nombre de otro.
- **`ordenId`**: va en la URL.
- **los campos vacíos**.

Un servicio sin nombre conocido **viaja tal cual**: el servidor lo rechaza y
queda apartado. Descartarlo en el dispositivo borraría un servicio que el
técnico sí hizo.

### Otro fallo de autoría

El editor registraba `capturadoPorId: datos.orden.id` — **el id de la orden
como autor**. Toda medición quedaba atribuida a un usuario inexistente. Ahora
sale de la sesión. Tercera vez que aparece esta clase de error (3.7, 4.4,
aquí): la regla de la 4.4 sigue vigente.

### Una prueba que no probaba nada

"Ningún campo viaja en null" usaba campos `undefined`, que `JSON.stringify`
descarta solo. Habría pasado con cualquier código. Lo destapó una mutación
que solo hacía fallar **una** prueba cuando esperaba dos. Ahora manda nulls
explícitos, como el editor real.

## Catálogo de servicios fijo (5.2)

**Decisión del usuario:** los servicios son un catálogo fijo, por ahora. Con
la indicación explícita de revisar que la solución fuera **correcta y no solo
que funcionara**.

### La traducción de la 5.1 funcionaba, pero el diseño no era correcto

La 5.1 traducía id → nombre en la frontera y las pruebas pasaban. Al revisar
el diseño aparecieron tres problemas de fondo:

1. **El catálogo estaba en tres lugares**: el dominio (sin código), la semilla
   del backend (con código, copiado a mano) y la tabla que el celular
   descargaba. Coincidían por cuidado, no por diseño.
2. **El identificador que viajaba era el nombre visible**, con tildes.
   Renombrar "Retorqueo" a "Reapriete" habría roto la sincronización y vaciado
   esa columna en el histórico del informe.
3. **El celular dependía de una descarga para nueve constantes.** Un teléfono
   recién instalado y sin señal mostraba "Sin opciones descargadas" y el
   técnico no podía marcar lo que hizo.

### El diseño correcto

**Una sola fuente**: `CATALOGO_SERVICIOS` en el dominio, con un **código
estable** (`MONT`, `CALI`, `RETO`…) que no cambia nunca y es ASCII.

- **El contrato valida códigos**, no nombres (`zServicioLlanta`).
- **La semilla importa el catálogo** en vez de copiarlo.
- **El informe agrega por `codigo`** y traduce a columna con el dominio.
- **El celular sirve los servicios desde el dominio**, sin descarga.

El nombre "Calibración" aparece ahora en **un solo lugar** del código de
producción.

### Cómo se hizo el cambio sin romper nada en silencio

Nombre y código son ambos `string`. Redefinir `SERVICIOS_LLANTA` para que
contuviera códigos habría compilado sin avisar en cada sitio que esperaba
nombres. Se **eliminó** y se crearon `CODIGOS_SERVICIO_LLANTA` y el tipo
`CodigoServicio`: el compilador señaló los cinco puntos a revisar.

### Migración 6

`medicion_servicio.servicio_id` pasa a llamarse **`servicio_codigo`**. Una
columna con otro contenido y el mismo nombre habría mentido a quien la leyera
después. La migración **convierte los datos existentes** (`srv-cali` → `CALI`)
y tiene su propia prueba con datos viejos reales.

La tabla `servicio` del dispositivo queda sin uso pero no se borra, por si una
versión vieja de la app convive un tiempo con la nueva.

### El camino a futuro sigue abierto

El backend conserva la tabla `Servicio` por empresa, con código único. Si más
adelante las empresas pueden crear servicios propios, basta con dejar de
restringir el contrato al enum: el código ya es el identificador.

## Operaciones como comandos (5.4)

**Decisión del usuario: opción A**, con la indicación de aplicar la mejor
solución y no solo una que funcione.

### El problema

Los contratos exigían la versión general (bloqueo optimista) en firmar,
cambiar de estado y reasignar. Pero las operaciones encoladas del propio
dispositivo suben la versión del servidor al aplicarse: en una jornada sin
señal, la segunda operación ya llevaba una versión vieja y **chocaba consigo
misma**. El servidor además la sube por cosas que el celular no ve, como el
folio. El requisito se diseñó para edición en línea y contradecía la decisión
de sincronizar **operaciones, no registros**.

### La solución

`Precondicion` en `apps/api/src/ordenes/servicio.ts`, con dos modos
**explícitos y sin valor por defecto**:

- **`COMANDO`**: del dispositivo. Se valida con las reglas del negocio al
  aplicarse —estado, técnico asignado, transición válida—. Si otro escribe
  entre leer y escribir, **se revalida contra el estado nuevo** (hasta 3
  veces) en vez de rechazar el trabajo del técnico.
- **`enLinea(version)`**: de una pantalla donde la persona decide sobre lo que
  vio. Exige esa versión.

No hay versión "opcional": sería una protección que se puede olvidar sin que
nadie lo note. Cada llamada declara su modo.

La **firma** lleva `versionContenido` —la del contenido que la persona vio— y
el servidor exige que coincida con la suya. Si no coincide, se firmó algo que
el servidor no tiene (por ejemplo, una medición quedó apartada) y la firma se
rechaza con `FIRMA_DESACTUALIZADA`.

### Los tres ajustes

**1. Una medición por posición.** Si el mismo técnico captura la posición 7 en
dos celulares, la segunda se rechaza y queda apartada, visible, en vez de
pisar a la primera.

Al implementarlo apareció que **corregir una posición generaba una medición
nueva**: el editor no pasaba el id existente. Con la regla, toda corrección
habría fallado. Ahora el repositorio reutiliza el id de la posición; se hizo
ahí y no en la pantalla para que ningún llamador lo repita.

**2. Sin versión opcional** — ver arriba.

**3. Las fotos respetan el orden en que se trabajó.** Antes el contenido
cambiaba al **confirmar los bytes**, que suben por fuera de la cola y podían
llegar después de la firma, invalidándola aunque la foto se tomó antes. Ahora:

- `adjuntar_foto` es una **operación de la cola ordenada** y cambia el
  contenido al aplicarse, en el celular y en el servidor.
- Confirmar los bytes **solo certifica que llegaron**.
- El id lo genera el dispositivo: reintentar no cuenta la foto dos veces.
- Las fotos sin archivo **se reportan, no se borran**
  (`revisarSubidasPendientes`). Adjuntar ya cambió un contenido que el
  cliente pudo firmar; borrar la reserva cambiaría en silencio un documento
  firmado, y el archivo casi siempre sigue en el celular.

**Pendiente:** el celular todavía no sube los bytes. Cuando se construya la
captura de fotos, la respuesta de `adjuntar_foto` trae la URL firmada; si
expira antes de subir, hará falta pedir una nueva para la misma foto.

### Hallazgos al implementarlo

- **El contrato de firma no conocía el trazo ni el consentimiento**, y el
  validador los descartaba en silencio: se habría perdido la constancia de la
  Ley 1581. Ahora son obligatorios, en el contrato y en el repositorio local.
- **Reasignar guardaba el motivo en `motivoDevolucion`**. El celular clasifica
  una orden en proceso con ese campo como *"Devuelta para corregir"*: el
  técnico nuevo veía "Cambio de turno" como lo que tenía que corregir. El
  motivo va ahora al historial, sin mostrarse al cliente.
- **El backend nunca se verificaba con el compilador.** `typecheck` solo
  cubría los paquetes y el móvil; Vitest ejecuta sin comprobar tipos. Había
  **cuatro errores latentes**, dos con efecto visible: el mensaje *"hay true
  mediciones que la referencian"* y `desactivadoEn` que quedaba vacío. Ahora
  `npm run typecheck` incluye `tsc --noEmit -p apps/api`, y el CI lo hereda.

  Todos los *"typecheck exit 0"* reportados antes de esta tarea **no
  cubrían el backend**.

## Servicio de mediciones (5.6)

`apps/api/src/mediciones/servicio.ts`. La operación más frecuente de la app,
22 por orden, no existía del lado del servidor.

Siempre llega como **comando**: se valida con el contrato compartido
(`zMedicionLlanta`) y con las reglas del negocio al aplicarse —estado de la
orden, técnico asignado, posición existente en la configuración congelada—.
El autor sale **de la sesión**, nunca del cuerpo.

### Una medición por posición, en dos capas

- **El servicio** la comprueba primero para dar un mensaje claro
  (`POSICION_OCUPADA`). Corregir no choca porque el celular reutiliza el id.
- **La base** la garantiza con el índice único `(ordenId, posicion)`. Es lo
  único que detiene la carrera entre dos celulares escribiendo en el mismo
  instante: ambas pasan la comprobación previa. El servicio **traduce** la
  violación (código `23505`) en vez de dejar escapar un error 500.

La prueba de carrera usa dos conexiones reales. Se verificó con mutación que
ejercita el camino de la base: sin la traducción falla 3 de 3 veces.

Un id no puede mudarse de orden ni de posición (`MEDICION_REUBICADA`).

### Invariante: la versión de contenido sube igual en ambos lados

La firma se valida comparando el contador del celular con el del servidor.
Si uno subiera y el otro no, **toda firma se rechazaría**.

| Operación | Celular | Servidor |
|---|---|---|
| Guardar medición | sube | sube (una vez por medición aplicada) |
| Adjuntar foto | sube | sube |
| Datos de la orden | sube | sube |
| Firmar, cambiar estado, reasignar | no | no |

Una medición **rechazada** no la sube en el servidor aunque sí en el celular.
Esa diferencia es intencional: hace que la firma se rechace, porque el
cliente firmó algo que el servidor no tiene.

Los reintentos de la misma operación no vuelven a aplicarse: eso lo garantiza
la idempotencia de la capa HTTP. **Al agregar una operación nueva que cambie
contenido, hay que subir el contador en los dos lados.**

### Servicios

Por código del catálogo fijo. Uno por vehículo se rechaza en una llanta; uno
desactivado en la empresa **se rechaza, no se descarta**: descartarlo borraría
en silencio un servicio que el técnico sí hizo. Corregir **reemplaza** los
servicios, no los acumula.

## Sesión vencida y conflictos en el celular (5.7)

Al leer cómo interpreta el celular cada respuesta HTTP, antes de escribir el
servidor, aparecieron dos defectos graves.

### 1. Una sesión vencida apartaba todo el trabajo del día

Los tokens de acceso duran 15 minutos, pero **nada los renovaba**: el
servicio guardaba el token de renovación y nadie lo usaba. Un técnico que
volvía de una jornada sin señal recibía `401` en todo, y el cliente trataba
el `401` como rechazo: **todas sus operaciones quedaban apartadas**. Lo mismo
al cerrar sesión: "sin token" también era un rechazo.

Ahora:

- Ante un `401`, el cliente **renueva una vez y reintenta** con el token
  nuevo. Una sola vez, no en bucle.
- Si no se puede renovar, el resultado es **`sin_sesion`**: el motor detiene
  la ronda, deja todo en la cola y marca `requiereIngreso`. **No cuenta como
  intento fallido**: si contara, un técnico que no ingresa en una semana vería
  su trabajo marcado como atascado sin que nada hubiera fallado.
- Solo el `403` es un rechazo de permiso.

La renovación es de **vuelo único** (`ServicioSesion.renovar`): llamadas
simultáneas comparten la misma petición. El servidor revoca toda la sesión si
ve el mismo token de renovación dos veces —su defensa contra el robo—, así
que dos renovaciones a la vez expulsarían al técnico en plena sincronización.

### 2. Un conflicto borraba la operación

El comentario decía *"se aparta y se avisa"*, pero el código llamaba a
`marcarOperacionAplicada`, que la **elimina**. Con el modelo de comandos, los
conflictos típicos son una firma desactualizada o una posición ocupada: una
firma en conflicto se habría borrado del celular.

Ahora se aparta con su motivo, igual que un rechazo, y se sigue reportando
como incidencia.

**Lección:** un comentario que describe lo que el código *debería* hacer no
es evidencia de lo que hace. Esta vez lo delató leer el código, no el
comentario.

## Servidor HTTP (5.8)

`apps/api/src/http/servidor.ts`. Fastify. Tres garantías:

**1. Una transacción por petición, con el contexto de RLS.** Se fija con
`set_config(..., true)`, equivalente a `SET LOCAL`: vive solo dentro de la
transacción. Con conexiones reutilizadas del pool, un `SET` normal filtraría
la empresa de una petición a la siguiente. Hay una prueba de que el contexto
**no sobrevive** a la transacción.

**2. Idempotencia dentro de la misma transacción.** La clave (`Idempotency-Key`,
que es el id de la operación) se reclama con `INSERT ... ON CONFLICT DO
NOTHING` junto con el efecto: nunca queda una operación aplicada sin
registrar, ni registrada sin aplicar. Dos envíos simultáneos con la misma
clave: el segundo espera al primero y recibe `409 YA_APLICADA`.

**Un rechazo NO consume la clave**: deshace la transacción entera, incluida
la reclamación. Si consumiera, corregir la causa no serviría de nada —el
reintento respondería "ya aplicada" sin haber aplicado nunca—.

**3. Los códigos significan lo que el celular entiende** (`ESTADO_POR_CODIGO`):
409 conflicto, 403 permiso, 404 no existe, 422 datos. Un código no listado es
**422, nunca 5xx**: con 5xx el celular reintentaría para siempre un dato que
siempre fallará.

Todas las rutas actuales son de **comando**. No se infiere el modo por la
presencia de `If-Match`: eso reintroduciría la versión "opcional". Un panel
web que edite en línea tendrá rutas propias con la versión obligatoria.

### Conformidad de esquemas (la prueba que faltaba)

El servicio de mediciones filtraba por `"eliminadoEn"`, **columna que no
existe** en `OrdenServicio` (las órdenes se anulan, no se borran). Habría
fallado en cada medición en producción con un 500, y el celular habría
reintentado para siempre. Sus 22 pruebas pasaban porque el esquema de prueba
**también inventaba la columna**.

`conformidad-esquema.test.ts` lee `schema.prisma` y exige que toda tabla
escrita a mano en las pruebas sea **subconjunto** del esquema real. El
razonamiento es transitivo: si una consulta pasa sus pruebas, sus columnas
existen en el esquema de prueba; si ese esquema es subconjunto del real,
existen en producción.

Revisa **todos** los `.ts` de pruebas, no solo los `.test.ts`: el helper
compartido `esquemas.ts` sería el lugar perfecto para volver a inventar
columnas sin que nadie lo notara. Analiza 28 tablas reales y 53 de prueba.

(No se puede generar el DDL real con `prisma migrate diff` en este entorno:
el motor de esquemas se descarga de un dominio bloqueado.)

### Dos pruebas débiles que la mutación destapó

- **El rol del token no se validaba de verdad.** La prueba comprobaba solo el
  `403`, y con la validación quitada el rechazo venía del dominio por otra
  razón. El caso peligroso —rol inventado en un token cuyo usuario **sí** es
  el técnico asignado— no estaba cubierto. Ahora el servidor responde
  `ROL_DESCONOCIDO` y la prueba lo exige.
- **La semilla usaba ids como `u-tec2`**, pero los contratos exigen UUID.
  Pruebas que pasaban habrían sido rechazadas en producción. La semilla usa
  UUID, como el dispositivo.

## Prueba de punta a punta (5.9) — cierra la Fase 5

`e2e/jornada.test.ts`. El celular de verdad —su base SQLite, su cola de
operaciones, su cliente HTTP— hablando por **HTTP real** con el servidor de
verdad y PostgreSQL. Sin dobles en el medio.

La jornada: crear la orden sin señal, capturar 4 posiciones, registrar
kilometraje y hallazgos, firmar con el cliente y enviar a revisión. **Ocho
operaciones**, nada toca la red hasta el final.

Lo que verifica:

- Todo lo capturado llega, con sus seriales y profundidades.
- **La firma llega VIGENTE**: `firmaVersion == versionContenido` en el
  servidor. Es el corazón del diseño; si los contadores subieran distinto, el
  coordinador vería una orden que no puede aprobar.
- La constancia del consentimiento (Ley 1581) sobrevive el viaje.
- El folio lo asigna el servidor y vuelve al celular.
- Los servicios viajan por código y quedan enlazados.
- **Una respuesta perdida no duplica nada**: la operación se aplicó pero el
  celular no vio la respuesta; al reintentar —tras su espera— el servidor
  responde "ya aplicada" y el celular la da por enviada. Una sola orden.
- **Reenviar la jornada entera no la duplica.**
- **Si el coordinador reasigna mientras el técnico sigue sin señal**, sus
  mediciones se rechazan pero quedan **apartadas con su motivo**, no
  borradas, y la medición sigue intacta en el celular.

Cuatro mutaciones la rompen: contadores de contenido desalineados, orden sin
clave de duplicados, servidor sin idempotencia, firma sin consentimiento.

Vive en `e2e/`, con su propio `tsconfig` incluido en `npm run typecheck`,
porque cruza los dos paquetes.

## Rutas de acceso (6.1)

`POST /auth/ingresar` y `POST /auth/refrescar`. **No llevan clave de
idempotencia**: ingresar no es una operación de la cola, y repetirlo
simplemente devuelve una sesión nueva.

El servicio de autenticación **se inyecta ya construido**, porque necesita
una conexión distinta: el login ocurre antes de saber la empresa (ver la
decisión abierta abajo).

### El login devolvía el hash de la contraseña

`ResultadoLogin.usuario` es el `UsuarioAcceso` completo: incluye
`passwordHash`, `intentosFallidos`, `dobleFactorSecreto`. La ruta lo enviaba
tal cual, así que **todo cliente habría recibido el hash en cada login**, y
habría quedado en registros y cachés. Un hash no es la contraseña, pero se
puede atacar sin límite de intentos.

Ahora los campos se eligen **uno por uno**. El doble de prueba se tipa con la
interfaz real, así que incluye el hash igual que el servicio: es lo que
permite comprobar que la ruta no lo envía.

`elegir_empresa` (el mismo correo en dos empresas) responde `409` con la
lista; las credenciales incorrectas responden `401` sin revelar si el correo
existe.

## Pantalla de ingreso (6.2)

`apps/mobile/src/sesion/ingreso.ts` + `PantallaIngreso.tsx` + `app/ingresar.tsx`.

### Entrar con otro usuario borraba el trabajo del anterior

`ServicioSesion.iniciar` vaciaba la base si entraba otro usuario —correcto,
nadie debe ver las órdenes de un compañero— **pero sin mirar si quedaba
trabajo sin enviar**. En un carro taller dos técnicos comparten la tablet: el
segundo en entrar destruía la jornada del primero sin que nadie se enterara.

`cerrar` sí lo comprobaba; `iniciar` no. Ahora `iniciar` **rechaza** el cambio
de usuario si hay trabajo pendiente y devuelve cuánto y de quién; solo entra
con `forzar = true`, tras confirmarlo en pantalla. La comprobación va en el
servicio, no en la pantalla, para que ningún llamador pueda saltársela.

### Sin señal no es lo mismo que contraseña incorrecta

Son dos problemas con dos soluciones distintas, y confundirlos hace que un
técnico sin cobertura cambie su contraseña creyendo que la olvidó. La
pantalla los muestra distinto, y un `5xx` cuenta como problema de conexión,
no de credenciales.

### Detalles de campo

- **"Ver contraseña"**: con guantes y bajo el sol se escribe mal, y tres
  intentos bloquean la cuenta.
- **El correo se normaliza** (sin espacios, minúsculas) porque el teclado del
  celular capitaliza solo; **la contraseña no se toca**, ni siquiera se
  recorta: cambiarla rompería una clave legítima.
- La pantalla avisa de que **la primera vez hace falta señal**; después se
  trabaja sin ella.
- Si el correo existe en varias empresas, se pregunta cuál.

## Acceso a la base para la autenticación (6.3)

**Decisión tomada** (el usuario delegó el criterio): un **segundo rol de
PostgreSQL, `tiretrack_auth`, con permisos únicamente sobre las cinco tablas
de acceso**, y su propia conexión (`DATABASE_URL_AUTH`).

### El problema

El login busca al usuario por correo **antes de saber la empresa**. Con las
políticas de aislamiento, esa consulta devuelve cero filas: el login
respondería "credenciales incorrectas" a todo el mundo. Las pruebas de acceso
no lo veían porque sus esquemas no activan RLS.

### Por qué así y no de otra forma

| Opción | Alcance de un fallo en el módulo de acceso | Costo |
|---|---|---|
| `BYPASSRLS` | **Toda la base** | bajo |
| Funciones `SECURITY DEFINER` | Las columnas declaradas | alto: nueve consultas duplicadas en SQL |
| **Rol con permisos por tabla** | **Cinco tablas** | bajo |

`BYPASSRLS` se descartó porque un fallo en ese módulo —una inyección, un
filtro olvidado— alcanzaría cualquier tabla. Las funciones con privilegio
propio serían más estrictas, pero obligan a mantener las consultas duplicadas
en SQL, que es exactamente el tipo de duplicación que ya costó caro en este
proyecto (los servicios en tres lugares, el esquema de prueba divergente).

Permisos exactos: `Usuario` (leer, actualizar), `SesionUsuario` y
`TokenRecuperacion` (leer, crear, actualizar), `Auditoria` (**solo crear**),
`Empresa` (leer). **No** puede crear ni borrar usuarios, ni alterar la
auditoría —un registro alterable no sirve como evidencia—, ni tocar nada
operativo.

Las tablas nuevas no le llegan por defecto: el `ALTER DEFAULT PRIVILEGES`
solo concede a `tiretrack_app`. Sumar una tabla al módulo de acceso obliga a
escribir su `GRANT` a la vista.

### La prueba ejecuta el SQL real

`rol-acceso.test.ts` extrae la sección `@seccion:acceso` del `rls.sql` de
producción y la ejecuta. Una copia del SQL en la prueba se desincronizaría y
pasaría mientras producción queda mal — ya pasó con el esquema.

Comprueba que el rol hace su trabajo y que **no puede hacer nada más**, y que
el rol de aplicación sigue sin ver usuarios ajenos. Dos mutaciones la rompen:
permisos amplios (equivalente a `BYPASSRLS`) y una política restrictiva en
vez de permisiva.

## Arranque en producción (6.4)

`apps/api/src/config.ts` y `src/server.ts`. El sistema ya es desplegable.

### La configuración se valida entera al arrancar

Una variable mal puesta debe **detener el despliegue**, no fallarle a un
técnico a las seis de la mañana. Y se informan **todos** los problemas
juntos: descubrirlos de a uno obliga a repetir el despliegue tantas veces
como variables falten.

**El secreto de firma** se valida en serio: mínimo 32 caracteres, sin
palabras de ejemplo, y **con variedad mínima de caracteres distintos**.
Comparar contra una lista de prohibidas era demasiado débil —
`"changemechangemechangemechangeme"` tiene 32 caracteres y no está en la
lista—. Contar caracteres distintos atrapa cualquier repetición. Con ese
secreto se falsifican tokens de **cualquier empresa**: es la llave del
aislamiento entre clientes.

**En producción, usar el mismo usuario en las dos conexiones es un error de
configuración**: si son el mismo, el rol de acceso no limita nada. Fuera de
producción se permite (no siempre hay dos roles creados) pero queda marcado.

### Salud y disponibilidad son distintas

- `/salud`: ¿vive el proceso? **No consulta la base.** Si lo hiciera, un
  corte de la base reiniciaría el proceso en bucle sin arreglar nada.
- `/listo`: ¿puede atender? Comprueba **las dos** conexiones, porque con la
  de acceso caída nadie puede ingresar aunque el resto funcione.

Arrancar **no falla** si la base no responde: levanta y se reporta no-listo.
Si muriera al arrancar, un reinicio de la base dejaría la API caída para
siempre.

### Cierre ordenado

Ante la señal de apagado: dejar de aceptar, terminar lo que está en curso,
cerrar los pools. Cortar a mitad no pierde datos —la transacción se deshace y
el celular reintenta— pero produce rechazos evitables.

### Dos detalles que destapó la mutación

- **Se informaba el puerto configurado, no el asignado.** Con `PORT=0` el
  registro habría dicho "escuchando en el puerto 0".
- **La prueba de salud no probaba nada**: comprobaba un `200` con la base
  funcionando. Ahora apunta a una base inalcanzable y exige que `/salud`
  siga en `200` mientras `/listo` responde `503`.

## Subida de fotos (6.5)

`apps/mobile/src/fotos/compresion.ts` y `subidor.ts`, migración 7.

### Por qué comprimir no es opcional

Una foto de celular pesa 3-5 MB; veintidós son cien megabytes por orden. La
señal de una vía rural no los sube: la foto se queda esperando para siempre y
el técnico nunca sabe por qué.

El criterio vive en **lógica pura** —la compresión real la hace el
dispositivo, que no se prueba en Node— porque es donde un error cuesta caro:
comprimir de más deja **ilegible el serial**, que es justo lo que la foto
tenía que demostrar.

- Lado máximo 1600 px: el flanco de una llanta se lee bien.
- **Lo que ya es pequeño no se toca**: recomprimir degrada sin ganar nada.
- La calidad baja por intentos, **nunca por debajo del mínimo legible**. Una
  foto grande que tarda es mejor que ninguna; una ilegible es peor que las
  dos.

### La subida va por fuera de la cola ordenada

Los bytes pesan y la señal es mala: una foto lenta no puede frenar las
mediciones ni la firma. Lo que sí respeta el orden es **adjuntar**, que es lo
que cuenta en el contenido (tarea 5.5).

- **Una foto de a la vez**: veintidós subidas simultáneas por 4G rural fallan
  todas por tiempo agotado.
- **Una foto nunca se borra por fallar.** El archivo está en el celular y es
  evidencia del servicio; queda esperando, con su motivo y su cuenta de
  intentos, y la espera crece a cada fallo.
- **Sin señal se detiene la ronda**: las demás fallarían igual gastando
  batería.

### La URL firmada vence

Era el cabo suelto que quedó en la tarea 5.5. Vence en minutos, y sin señal
eso pasa a menudo.

- **No se empieza una subida con una URL a punto de vencer**: gastar datos
  para fallar a mitad es el peor resultado.
- Pedir otra **reenvía la operación de adjuntar**: el servidor identifica la
  foto por su id, devuelve la misma reserva con una URL nueva y **no la
  cuenta dos veces en el contenido**, así que la firma no se invalida.
- Renovar **no suma un intento fallido**: una URL vencida no es culpa de la
  foto.

El cliente HTTP ahora conserva el cuerpo completo de la respuesta, no solo el
folio: es donde viene la URL.

## Captura de fotos (6.6)

`apps/mobile/src/fotos/captura.ts` y `GaleriaFotos.tsx`.

La orquestación está separada del hardware: los adaptadores a la cámara y al
manipulador de imágenes se importan de forma diferida, así el resto corre en
Node. Lo mecánico se valida en el emulador; **lo que decide está probado**.

### Reglas de la captura

- **Se conserva la MEJOR pasada, no la última.** Recomprimir una foto ya
  optimizada puede dejarla más grande.
- **Si la compresión falla, se sube la ORIGINAL.** Vale más subir cuatro
  megabytes lentamente que perder la evidencia del servicio.
- Cancelar y quedarse sin permiso de cámara **no son errores**, y se
  distinguen entre sí: el mensaje que necesita el técnico es distinto.
- Se conserva el tamaño original para poder decir cuánto se ahorró.

### El estado de cada foto se ve en texto

Bajo el sol los colores se confunden, y aquí distinguirlos es justo el punto:
el técnico necesita saber si su evidencia ya llegó al servidor **antes de
entregar el vehículo**. La galería avisa cuántas quedan sin enviar.

Una foto **ya enviada no se puede quitar**: está en el servidor y cuenta en
el contenido firmado; quitarla del celular daría una falsa sensación de
haberla borrado.

### Un tope que no topaba

El límite de pasadas de compresión valía exactamente lo mismo que el límite
natural de la calidad mínima, así que **nunca actuaba**: quitarlo no cambiaba
nada y ninguna prueba lo notaba. Dos guardas que coinciden por casualidad
confunden a quien lea el código.

Ahora el tope es mayor y está documentado como **red de seguridad, no
mecanismo**, y la prueba fija el número real de pasadas: cambiar la regla de
calidad se nota ahí.

## Descarga de datos (6.7) — el hueco que faltaba

`apps/api/src/descarga/servicio.ts`, `GET /sincronizacion`,
`apps/mobile/src/datos/descarga.ts`, migración 8.

**Nadie llenaba la base del celular.** Los métodos que la pueblan existían y
estaban probados, pero **ningún código de la aplicación los llamaba**: solo
las pruebas. El motor solo enviaba. Un técnico instalaba la app, ingresaba y
veía una lista vacía para siempre.

No estaba en ninguna lista. Se coló porque todo el camino de lectura se
construyó contra tablas locales que las pruebas llenaban a mano.

### Un solo viaje

Con señal mala, cinco peticiones son cinco oportunidades de quedarse con
datos incompletos: el catálogo sin medidas, o los vehículos sin su
configuración de ejes (y sin ella el diagrama no se dibuja).

- **Órdenes: incremental** (`desde`). Es lo que más cambia y más pesa.
- **Catálogo, flota y configuraciones: completos.** No tienen marca de
  actualización en la base y son pocos cientos de filas. Cuando crezcan,
  agregarles `actualizadoEn` los vuelve incrementales sin cambiar el
  contrato.

### Lo descargado NO pisa el trabajo sin enviar

Si el celular tiene cambios que no llegaron al servidor, **la copia del
servidor es la vieja**: escribirla encima borraría lo que el técnico capturó.
Vale para órdenes y para mediciones (una corrección que sigue en la cola se
respeta).

Las cerradas se quitan del celular **salvo que tengan trabajo pendiente**.

**La marca de descarga se guarda al final**, y solo si todo salió bien: si se
guardara antes, un fallo a mitad haría que la próxima descarga se saltara lo
que faltó y esos datos no llegaran nunca. Hay una prueba que falla la
aplicación a mitad para comprobarlo.

Primero se envía y después se trae: así lo recién capturado ya está en el
servidor cuando llega la copia de vuelta.

### Dos errores del mismo tipo, otra vez

- La consulta usaba **`"Medida"`, tabla que no existe**: se llama
  `DisenoMedida`. Habría fallado en el primer intento de descarga.
- `estado` es un **tipo enumerado**: compararlo contra texto sin convertir
  falla en PostgreSQL.

La prueba de conformidad no los atrapa: garantiza que los esquemas de prueba
sean **subconjunto** del real, no que sean **suficientes**. Un servicio con
SQL inventado solo se descubre cuando una prueba lo ejecuta contra la base.

**Lección:** todo servicio con SQL propio necesita una prueba de integración
contra el esquema compartido. El esquema compartido se completó con las
tablas y columnas que faltaban (`Marca`, `Diseno`, `DisenoMedida`,
`PosicionEje` completa, `Vehiculo` completa, `Usuario.activo`).

## Rutas faltantes, esquema generado y pruebas que se saltaban (6.8)

### Crear una marca en campo nunca llegaba al servidor

`/catalogo/marcas` y `/catalogo/disenos` **no existían**. El celular las
enviaba, recibía un 404, y la operación quedaba apartada. Mismo patrón que la
tarea 5.0.

Ahora existen, y hay una prueba que **recorre todos los tipos de operación
del celular contra el servidor real** y exige que ninguno caiga en una ruta
inexistente. Es la guarda que faltaba para esta clase de error.

Esas rutas usan `forzar: true` al crear: el técnico ya decidió en el celular,
donde vio las marcas parecidas. Volver a preguntarle desde el servidor no
tiene a quién preguntar, porque la operación se envía cuando él ya no está
mirando.

### El esquema de pruebas se GENERA desde Prisma

Escribirlo a mano falló **tres veces**: la tabla de prueba era más pobre que
la real, un servicio consultaba una columna que allí no estaba, y el error
solo aparecía cuando algo lo ejecutaba —o habría aparecido en producción—.

`generar-esquema.ts` lee `schema.prisma` y emite el DDL. Si una columna
existe en Prisma, existe en las pruebas. Es una traducción laxa a propósito:
garantiza **columnas y tipos compatibles**, que es donde estaban los errores;
las restricciones que una prueba verifica se declaran aparte, explícitas.

Al generarlo aparecieron dos cosas: `@updatedAt` no tiene valor por defecto
en el esquema —lo pone Prisma al escribir— así que en SQL directo violaba el
NOT NULL; y la semilla llenaba solo unas pocas columnas porque las tablas de
prueba eran pobres. Ahora se parece a la realidad.

(No se usa `prisma migrate diff`: su motor se descarga de un dominio que este
entorno no alcanza.)

### Las pruebas de integración se saltaban en silencio

Dos fallos que se tapaban entre sí:

1. **El CI define `DATABASE_URL_TEST` y el código leía `TEST_DATABASE_URL`.**
2. Sin conexión, las pruebas **se saltan** y el resultado dice "pasaron".

Combinados: el CI probablemente venía pasando en verde **sin ejecutar ninguna
prueba contra la base**. Ahora se aceptan los dos nombres, el tiempo de espera
sube a 10 segundos —con 2, una máquina cargada se saltaba la suite entera— y
con `PRUEBAS_EXIGEN_BASE=1` (puesto en el CI) la ausencia de base **falla en
vez de saltar**.

**Lección:** una prueba que se salta sola es peor que no tenerla. El resultado
dice que pasó y nadie mira.

## Flota, informes y aislamiento de las pruebas (6.9)

### Rutas que faltaban

`GET /flota/clientes`, sus sedes y vehículos, las altas correspondientes, y
`GET /informe/exportar`. Los servicios existían desde la fase 1 **sin puerta
de entrada**: la administración y la exportación eran inalcanzables.

Las consultas usan un ayudante propio: **autenticadas y transaccionales, sin
clave de idempotencia**. Leer dos veces no cambia nada; exigirla sería
ceremonia sin motivo.

La exportación devuelve **el archivo**, no JSON —el coordinador lo abre en una
hoja de cálculo—, y cuántas órdenes van sin cerrar viaja en un **encabezado**:
un aviso entre las filas ensuciaría la hoja. Sin registros responde un error
en vez de un archivo con solo encabezados, que parece una exportación rota.

### Cada archivo de prueba, en su propio esquema

**Ocho archivos creaban y borraban las mismas tablas en la misma base**, y
Vitest ejecuta los archivos en paralelo: que la suite pasara dependía de que
no coincidieran en el tiempo. Dos a la vez podían borrarse las tablas
mutuamente y producir fallos que no se repiten — de los más caros de
diagnosticar.

`conectarAislado` y `poolAislado` crean un esquema por archivo y ajustan el
`search_path`. El resto del código no cambia. Se verificó con tres corridas
seguidas.

Efecto secundario útil: en la prueba del rol de autenticación hubo que
conceder permisos sobre el esquema nuevo, lo que dejó explícito que **el rol
de acceso no recibe las tablas en bloque** —sus permisos son tabla por tabla,
que es justo lo que esa prueba verifica—.

## Empaquetado preparado (6.10)

`apps/mobile/eas.json`, `app.json` completado y `COMPILAR.md`.

**El APK no se puede generar en el entorno donde se construyó el proyecto**:
compilar requiere los servicios de Expo, con cuenta y salida a internet. Queda
todo listo y los pasos escritos.

Tres perfiles: `campo` (APK instalable directo, para probar en un teléfono),
`pruebas` (contra el servidor de pruebas) y `produccion` (paquete para
tienda). La URL del servidor va por perfil, no quemada en la app.

Los textos de permiso de cámara están **en español y explican para qué**: es
lo que el técnico lee cuando Android pregunta.

`COMPILAR.md` incluye lo que las pruebas no pueden decir —qué revisar en el
teléfono, en orden— y una tabla de síntomas probables con dónde mirar.

**Advertencia que conviene no perder de vista:** nada de la app se ha
ejecutado nunca en hardware. Cámara, almacenamiento seguro, SQLite y tamaños
táctiles están validados con adaptadores en Node. Las pruebas dicen que la
lógica es correcta; no dicen que la app abra.

## Revisión contra la base real (2026-10-05)

Se crearon datos de prueba **por la API real**, como lo haría cada rol, y se
recorrió el servidor con entradas malas. Apareció más que en todas las
pruebas anteriores juntas.

### Lo que encontró

| Defecto | Efecto en producción |
|---|---|
| `actualizadoEn` (@updatedAt) sin valor: Prisma lo llena, el servidor escribe con SQL | **Crear una orden respondía 500** |
| Nada tocaba `actualizadoEn` al cambiar una orden | **La descarga incremental nunca mandaba cambios**: una orden devuelta no llegaba al celular |
| `now()` y `pg` escribían hora local; Prisma, UTC | Comparaciones corridas 5 h en un servidor fuera de UTC |
| `confirmarDuplicada` fuera del contrato | Una orden para un vehículo con otra abierta se **rechazaba siempre** (la regla es avisar) |
| Exportar omitía `ordenIds` y `estadoLlanta` | Elegir tres órdenes exportaba **la cartera entera** |
| La ruta de ingreso omitía `codigo2fa` | Administrador y superadmin **no podían entrar** |
| Código 2FA mal formado | 500 en el login, sin contar el intento |
| Rutas sin su contrato (orden, flota) y consultas sin validar | 500 ante datos malos: el celular reintentaba para siempre |
| La descarga lanzaba 7 consultas en paralelo sobre una conexión | Aviso de pg; transacción abortada si una fallaba |

### La causa común: el esquema de pruebas no era producción

Tres diferencias escondían los dos defectos más graves:

- inventaba `DEFAULT now()` para `@updatedAt`;
- usaba `timestamptz` donde la migración crea `timestamp(3)` sin zona;
- le faltaban claves únicas que el código usa en `ON CONFLICT`.

**Regla:** si el esquema de pruebas necesita algo que producción no tiene
para que una prueba pase, el defecto está en producción, no en la prueba.

### Guardas nuevas

- `robustez.test.ts`: todas las rutas con cuerpos, ids y consultas malos;
  cero 500. Reúne todos los fallos en una corrida.
- `descarga.test.ts`: un cambio después de la última descarga llega en la
  siguiente; ninguna consulta simultánea sobre la conexión.
- `schema.test.ts`: toda tabla con `@updatedAt` tiene su disparador; toda
  tabla del esquema aparece en `rls.sql`.
- `db/utc.ts`: sesiones y `pg` en UTC, servidor y pruebas igual.

## Flujo completo en la app (2026-10-05)

Decisiones del usuario en esta ronda: **API bajo `/api/v1`**, el
**coordinador ve solo sus sedes**, el **portal del cliente va dentro de la
misma app** (rol cliente). **Alta de usuarios con código de activación**: el administrador
crea el usuario, la app muestra un código de un solo uso (72 h) para
enviarlo por WhatsApp, y el usuario elige su propia contraseña. No hay
servicio de correo. Sin respuesta sobre las sedes en el login: se tomó
la opción que no amplía los permisos del rol de acceso.

### API bajo `/api/v1`

Las rutas se montan en un plugin con `PREFIJO_API`; el manejador de errores
queda en la raíz y las cubre todas. `/salud` y `/listo` siguen en la raíz:
los consulta la infraestructura, no la app. Las pruebas llaman a la ruta real
con el prefijo, y la de punta a punta usa la URL base con `/api/v1`, igual
que la app instalada. Una prueba exige que sin prefijo responda 404.

### El login devuelve las sedes

`zUsuarioSesion` las exige. Viven en `UsuarioSede`, fuera de las cinco tablas
del rol de acceso: se leen **con el rol de aplicación**, ya con la empresa
conocida y bajo RLS. Sin empresa (superadmin), sin sedes. Una prueba pasa la
respuesta por `zRespuestaLogin`.

### El técnico completa una orden

Antes **ninguna orden podía enviarse a revisión**: el envío exige kilometraje
y firma, y ninguna pantalla los pedía.

- **Kilometraje y hallazgos** (`FormularioDatosOrden`): acepta puntos de
  miles; si el kilometraje retrocede respecto del último conocido, avisa y
  pide confirmar una vez (regla del dominio `evaluarKilometraje`).
- **Firma**: ruta que monta `CapturaFirma` (construida desde la 3.6).
- **Detalle**: "Continuar captura" no hacía nada (`onPress` vacío); muestra
  nombres de vehículo y cliente en vez de ids.

### El coordinador decide

`DecisionRevision` (4.1) no estaba montado y ningún botón llevaba a
reasignar. Ahora: ruta `orden/[id]/decidir` desde la bandeja, y en el detalle
"Aprobar o devolver" (en revisión) y "Reasignar" (abierta), solo para gestores.

### Fotos

Cámara y galería en el editor de posición (una vez guardada: la foto cuelga
de la medición). Transporte real con `expo-file-system` (PUT a la URL
firmada; 403 = URL vencida, sin respuesta = sin red). El subidor corre tras
cada sincronización, por fuera de la cola. En local no suben: R2 tiene
valores de relleno.

También hay galería a nivel de orden en el detalle (placa, odómetro, estado
del vehículo), y el detalle y el envío cuentan las fotos sin subir: antes
era un 0 fijo y el aviso de "fotos sin enviar" nunca aparecía.

### Defectos encontrados al construir

| Defecto | Efecto |
|---|---|
| `accionesDisponibles` con `esTecnicoAsignado: true` fijo | El coordinador veía habilitado capturar en la orden de otro (clase 3.7 / 4.4) |
| Consultas de órdenes con lista de columnas a mano | `accion` y la firma completa llegaban **siempre nulas** |
| Descarga con `INSERT OR REPLACE` y el servidor sin mandar la firma | **Al volver a descargar una orden firmada, la firma desaparecía** |

Ahora hay una sola lista (`COLUMNAS_ORDEN`) con una prueba que la compara con
lo que lee `aOrden`; la descarga usa `ON CONFLICT DO UPDATE` y el servidor
manda el resumen de la firma, la acción y el código de referencia.

### Técnicos por sede (migración 9)

La tabla local `tecnico` tenía como clave solo el id: un técnico en dos
sedes chocaba al guardarse, y como la descarga es todo o nada, **el celular
de un coordinador con dos sedes no descargaba nunca**. Además el servidor
mandaba como "técnicos" a todos los usuarios de la sede, coordinador y
administrador incluidos, que aparecían como opción al reasignar.

La migración 9 cambia la clave a `(id, sede_id)` y crea la tabla `sede`
(sedes de la empresa con su código), que la descarga ahora trae: la orden
nueva necesita la sede, y la creada sin señal, su código para la referencia.
`sedes` es opcional en el paquete: un servidor anterior no la manda y la
descarga no se cae por eso.

### Guardas nuevas

- Cada pantalla construida está montada en alguna ruta (pasó tres veces:
  firma, decisión, galería).
- Cada `router.push/replace` apunta a un archivo de ruta que existe.

## Nueva orden (4.1)

`src/ordenes/nuevaOrden.ts` decide; `FormularioNuevaOrden.tsx` pinta; ruta
`app/nueva-orden.tsx`. Todo sale de la base del celular: se crea sin señal.

Dos entradas, una sola lógica:

| Quién | Entra por | Nace | Técnico |
|---|---|---|---|
| Coordinador / administrador | "Programar una orden" en el panel | `programada` | el que elija, de la sede |
| Técnico | "Nueva orden" en Mis órdenes | `en_proceso` | él mismo, diga lo que diga el formulario |

- **Cascada** sede → cliente → sede del cliente → vehículo → técnico; cambiar
  un nivel limpia los que dependen de él. Con una sola sede no se pregunta.
- **Solo las sedes de quien crea** (decisión: el coordinador ve sus sedes).
- **Toda orden nace con código de referencia** (`FUN-K7M2`): sin señal es lo
  único que la identifica; el folio llega al sincronizar.
- **Vehículo con orden abierta: avisa, no bloquea** (1.6).
- La orden armada **pasa `zCrearOrden`**: hay una prueba por cada rol.
- **Las instrucciones del coordinador no viajaban**: `ordenAContrato` omitía
  `notaCoordinador` y el técnico nunca las veía.
- Una sesión guardada antes de que el login trajera las sedes no las tiene:
  el formulario lo explica (cerrar sesión y volver a entrar).

## Flota creada en campo (5.3, datos)

El técnico crea clientes y sedes porque es operativo: llega a una sede que
no estaba registrada. Tiene que funcionar **sin señal**, así que son
operaciones de la cola: `crear_cliente`, `crear_sede_cliente`,
`crear_vehiculo` (este último, solo administrador y coordinador; lo valida
el servidor).

- **La descarga borraba lo creado en campo.** Reemplazaba clientes, sedes y
  vehículos enteros: lo creado sin señal desaparecía y las órdenes que lo
  usaban quedaban huérfanas. Migración 10: columna `creada_local`; la
  descarga solo reemplaza lo que vino del servidor.
- **Las plantillas de ejes no tenían nombre en el celular**: no había cómo
  elegir "Tractocamión 6x4" al registrar un vehículo. La descarga lo trae
  (opcional, por compatibilidad) y se guarda en `configuracion_eje`.
- `TIPOS_OPERACION` es la única lista de tipos de la cola. La prueba de punta
  a punta que exige ruta en el servidor para cada tipo tenía su propia copia,
  y los tipos nuevos habrían quedado fuera sin que nadie lo notara.

## Pantalla de flota (5.3)

`src/flota/PantallaFlota.tsx` + `reglasFlota.ts`; ruta `app/flota.tsx`.

- Entradas: "Clientes y vehículos" en el panel; y en la orden nueva, "¿No está
  el cliente o la sede? Regístralos" — es donde el técnico lo necesita. Al
  volver, la orden nueva recarga sus listas (`useFocusEffect`).
- Los formularios se validan con **los mismos contratos del servidor**
  (`zCrearCliente`, `zCrearSedeCliente`, `zCrearVehiculo`): lo que aquí
  pasa, allá pasa; si no, la operación quedaría apartada.
- **NIT repetido se bloquea** (único por empresa; se compara solo por
  dígitos). **Nombre parecido con otro NIT se avisa**, no se bloquea.
- Código de vehículo repetido en la misma sede se bloquea: se confunden al
  dictarlos.
- El técnico crea clientes y sedes; **no ve** cómo crear vehículos.
- **Pendiente:** definir y versionar plantillas de ejes (solo administrador).
  El servidor tiene la regla (`nuevaVersion`) pero no la ruta, y falta el
  editor de ejes.

## Portal del cliente (5.1)

Dentro de la misma app (decisión del usuario). `src/cliente/`; ruta
`app/cliente.tsx`. El cliente entra a su portal; antes la app lo devolvía al
ingreso sin explicación.

- Primero **lo que espera su aprobación, con el plazo a la vista** (lo que
  vence antes, arriba): si no responde, se cierra sola como cierre tácito.
- En el detalle: resumen del servicio y **aprobar** u **objetar con motivo**
  (mínimo 10 caracteres; la orden vuelve al técnico). Sin los botones del
  técnico ni del coordinador, y el diagrama no abre el editor.

Lo que destapó:

- **El cliente recibía cero órdenes**: la descarga le buscaba sedes de
  empresa, que no tiene. Ahora recibe las suyas en `pendiente_cliente` y
  `cerrada`.
- **El motivo de devolución y la nota del coordinador viajaban al
  cliente** sin filtrar; CLAUDE.md dice que no ve el historial interno. Ahora
  van vacíos para él (verificado con mutación).
- **El plazo del cliente nunca llegaba al celular**, ni los días en revisión
  ni el técnico: el panel no podía mostrar "vencen pronto" y la bandeja de
  un coordinador salía sin datos. Ahora viajan (el envío a revisión sale del
  historial de estados).
- **La descarga quita las cerradas**: el historial del cliente quedaba vacío.
  Opción `conservarCerradas`, activa solo para el rol cliente.

## Usuarios, sedes y activación (5.2, servidor)

Decisión del usuario: **código de activación** (no hay correo). Reglas en
`packages/domain/src/acceso/usuarios.ts`; servicio `apps/api/src/usuarios/`;
la activación vive en `ServicioAuth`.

| Ruta | Quién | Qué |
|---|---|---|
| `GET/POST /usuarios` | administrador | listar; crear (devuelve el código **una sola vez**) |
| `POST /usuarios/:id/codigo` | administrador | código nuevo: alta vencida o ayuda para recuperar la cuenta |
| `GET/POST /sedes` | administrador | sedes de la empresa; el código entra en el folio |
| `POST /auth/activar` | público | correo + código + contraseña nueva |

- **Código `XXXX-XXXX`** sin letras confundibles (no O/0, I/1/L, S/5, B/8,
  Z/2), vence a las 72 h, se acepta como se escriba (minúsculas, sin guion).
  Un código nuevo **anula** los anteriores.
- **Se guarda solo su huella.** Estas rutas **no usan la tabla de
  idempotencia**: guarda la respuesta, y la respuesta lleva el código.
- **El usuario nace sin contraseña utilizable** (hash de un secreto al azar):
  nadie más que él la conoce.
- **Un código equivocado cuenta como intento fallido** de la cuenta: es lo
  que hace impráctico adivinarlo. Correo inexistente y código equivocado
  responden igual.
- **Administrador (2FA obligatorio): la activación no termina sin registrar
  la app autenticadora** y comprobar un código. Si se activara sin eso, el
  siguiente ingreso le pediría un código que no tiene.
- El código lo emite el **servicio de acceso**: con el rol de aplicación, la
  tabla de tokens solo admite el token propio.
- El superadmin nunca se crea desde una empresa.

**En la app** (`src/sesion/activacion.ts`, `PantallaActivacion.tsx`, ruta
`activar`): "Tengo un código de activación" en el ingreso. Revisa correo,
largo del código y contraseña **antes de enviar** (cada código malo cuenta
para el bloqueo). Si el rol exige doble factor, muestra la clave de a cuatro
y un botón que abre la app autenticadora con el enlace `otpauth://`. Al
terminar **entra sola** con la contraseña recién elegida; si no puede (p. ej.
el código de 6 números ya cambió), va al ingreso.

**Administración en la app** (`src/admin/`, rutas `usuarios` y `sedes`, desde
el panel; solo administrador). Funciona **en línea**, no por la cola: el
código viene en la respuesta y la persona la espera. `ClienteHttp.enLinea`
renueva la sesión una vez ante un 401 y distingue "sin señal" (status 0) de
un rechazo.

- El código se muestra **grande y una sola vez**, con "Enviar por WhatsApp u
  otra app" (hoja de compartir del sistema) y el mensaje listo: qué tocar y
  cuándo vence.
- La lista marca "Sin activar" en texto. Cada usuario tiene "Enviar un código
  nuevo" / "Código para recuperar la cuenta".

**El esquema de pruebas ahora genera las claves únicas de Prisma.** Faltaban:
un correo y un código de sede duplicados se aceptaban en las pruebas, y antes
el folio había fallado por lo mismo. Es la cuarta diferencia entre pruebas y
producción que aparece; la regla de la "Revisión contra la base real" sigue.

## Plantillas de ejes (5.3, cierre)

Rutas `POST /configuraciones` y `POST /configuraciones/:id/version`
(administrador, en línea) sobre el servicio de flota que ya existía. En la
app: `src/flota/editorPlantilla.ts` (lógica), `PantallaPlantillas.tsx`, ruta
`plantillas`, botón en el panel solo con `puedeGestionarConfiguraciones`.

**El administrador piensa en ejes, no en posiciones.** El editor pide por eje
el tipo, sencilla o dual, PSI y profundidad mínima, y numera solo: eje por eje
de adelante hacia atrás, izquierda a derecha. En una dual la interna es la
segunda de la izquierda y la primera de la derecha, igual que la semilla. Al
cambiar esa regla falla una prueba.

- **La vista previa es el diagrama de las órdenes**, no un dibujo propio:
  el administrador ve exactamente lo que verá el técnico.
- **Validación previa con el dominio y el contrato** (`validarConfiguracion`,
  `zCrearConfiguracionEje`): lo que el servidor rechazaría no se envía.
- Un PSI vacío queda **sin dato**; uno mal escrito ("1o5") es error.
- **"Nueva versión" parte de la vigente** (`desdePosiciones`); la anterior no
  se toca. La descarga trae también las reemplazadas —las órdenes viejas las
  necesitan para dibujarse— pero la lista solo ofrece las vigentes.
- **Si la versión cambia vehículos en uso** (`REQUIERE_CONFIRMACION`), se
  muestra el aviso del servidor y el botón pasa a "Confirmar y mover los
  vehículos". **Tocar cualquier eje después anula la confirmación**: se
  confirmó otra plantilla. Al quitar ese reinicio falla una prueba.
- Es en línea: una plantilla define cómo se dibuja toda la flota y no puede
  quedar a medias en un celular. Al terminar se sincroniza para que la nueva
  aparezca.

Probado contra el servidor real: crear, versionar y descargar (la anterior
llega con `vigente = false`).

## Informe y exportación en la app (6.1, 6.2)

Servidor: `GET /informe/resumen` (vista previa) y `GET /informe/trazabilidad`
junto a la exportación que ya existía. App: `src/informe/` y ruta `informe`,
desde el panel.

### La exportación nunca quedaba en la auditoría

La ruta abría la transacción como una consulta (`confirmar: false`), y la
exportación **escribe** su constancia. El `ROLLBACK` la borraba: en la base
real había **cero** registros de `exportar_informe` antes de esta tarea. Lo
destapó la prueba nueva que cuenta filas de auditoría; ahora se confirma
cuando la exportación sale bien.

**Lección:** un helper "de solo lectura" que deshace siempre es correcto
hasta que algo dentro escribe. Al pasar un servicio por una ruta de
consulta, mirar si registra algo.

### Primero se ve, después se exporta

- La vista previa da **cuántas llantas y órdenes** salen, **cuántas sin
  cerrar** (aviso de datos preliminares) y las primeras 100 filas. Un rango
  mal puesto se descubre en pantalla, no en la hoja del cliente.
- **No se audita**: no sale ningún archivo. Hay prueba de que no suma fila.
- **Los mismos parámetros para las dos**: el servidor los lee con una sola
  función (`filtroInforme`) y la app los arma con una sola (`aConsulta`).
- **Si se cambia el filtro después de ver, no se exporta** hasta volver a
  ver: se exportaría algo distinto de lo que está en pantalla. Al quitar esa
  comprobación falla una prueba.
- Con serial, muestra el **recorrido de la llanta** y cuánto se gastó.
- Rangos de un toque (hoy, 7 días, este mes, mes anterior); las fechas se
  validan con el contrato antes de gastar señal.

### El BOM se pierde en el camino

El servidor manda el CSV con BOM, pero **`Response.text()` lo quita** al
decodificar —comprobado contra el servidor real—. Sin reponerlo, el archivo
compartido desde el celular abre en Excel con "PosiciÃ³n". `conBOM()` lo
repone; al quitarlo falla una prueba.

El archivo se guarda en la caché y se abre la hoja de compartir del sistema
(`expo-sharing` ~13.0, incluido en Expo Go 52). El `Share` de React Native no
adjunta archivos en Android.

### Ajustes en componentes base

- **`Opcion`**: la opción elegible con "✓" y `aria-checked` estaba copiada en
  cinco pantallas. Las nuevas usan la compartida; las viejas siguen con su
  copia hasta que se toquen.
- **`Tarjeta` sin `onPress` perdía el `testID`** en silencio.

**Quién puede exportar** sigue siendo una decisión abierta: la app no la
duplica; el botón está en el panel (coordinador y administrador).

## Hora de Colombia en todo el sistema (2026-10-06)

**Decisión del usuario:** el sistema usa la hora de Colombia, no una zona
por empresa. `fechaEnColombia()` en `packages/domain/src/tiempo/zona.ts` es
la única forma de saber qué día es "hoy", en el servidor y en la app.

Antes "hoy" se calculaba en UTC: después de las 7 p. m. ya era el día
siguiente. El archivo exportado llevaba la fecha de mañana, el cierre tácito
podía cerrar una orden horas antes de que se le acabara el plazo al cliente,
y una recurrencia se generaba la noche anterior. Una orden creada de noche
desde la app también nacía con la fecha de mañana.

- **Desfase fijo de −5 h**, no `Intl` con `timeZone`: Colombia no tiene
  horario de verano, y así da igual en Node, en las pruebas y en el motor
  JavaScript del celular. La app tampoco usa la zona que tenga configurada
  el teléfono.
- **Solo cambia el día calendario.** Los instantes (`now()`, vencimiento de
  URLs y tokens, `creadoEn`) siguen en UTC, que es lo correcto.
- Pruebas en el borde de las 7 p. m. para el nombre del archivo, el cierre
  tácito y las recurrencias. Al volver a UTC, las tres fallan.
- **Pendiente para la 5.4:** el filtro de fecha de la auditoría compara
  `creadoEn` (UTC) contra un día; hay que convertirlo a Colombia cuando se
  haga la pantalla.

## Trabajos programados en marcha (4.4, servidor)

**Decisiones del usuario (2026-10-06):** la orden recurrente va a un
**técnico fijo** de la programación; las acciones automáticas quedan a
nombre de **Sistema** (usuario vacío), y la orden recurrente, creada por
**quien hizo la programación**.

### Nada los arrancaba

El cierre tácito y las órdenes recurrentes existían desde la 1.9, probados,
y **ningún código los ejecutaba**. En producción ninguna orden se habría
cerrado por vencimiento ni se habría generado una recurrente. Mismo patrón
que la descarga (6.7).

Y si hubieran corrido, **habrían fallado en la primera vuelta**: asignaban
la orden a un "usuario del sistema" inexistente, en columnas que exigen un
usuario real. La prueba no lo veía porque escribía su esquema a mano, sin
esas llaves. Ahora usa el esquema generado con las llaves de producción.

### Cómo corren (`trabajos/planificador.ts`)

- Al arrancar la API y cada `TRABAJOS_CADA_MINUTOS` (15 por defecto; 0 los
  apaga en esa instancia).
- **Empresa por empresa, con su contexto de RLS**, como rol de aplicación.
  La lista sale de `empresas_para_trabajos()` (rls.sql, `@seccion:trabajos`):
  función con privilegio propio que devuelve **solo ids** de las empresas
  activas. No se usó `BYPASSRLS` ni la conexión del dueño.
- `"Empresa"` tiene `FORCE ROW LEVEL SECURITY`, que aplica también al dueño:
  sin la política `trabajos_dueno` (lectura, solo para el rol que corre la
  migración) la función vería cero empresas y los trabajos no harían nada,
  en silencio. **En local el dueño es superusuario y no ejercita esa
  política**: revisar en el primer despliegue que el registro muestre
  empresas procesadas.
- **Una conexión por empresa que se destruye al terminar**: el contexto va
  a nivel de sesión (cada ítem abre su transacción) y una conexión devuelta
  al pool con la empresa puesta la heredaría otra petición.
- Candado por empresa (`pg_try_advisory_lock`): con dos instancias, la
  segunda se la salta.
- Un fallo en una empresa no detiene a las demás ni tumba el proceso.

La prueba del planificador corre **como `tiretrack_app` con RLS activo**:
como superusuario las políticas no aplican y pasaría aunque faltara el
contexto. Mutaciones: sin contexto fallan 4 pruebas; devolviendo la conexión
al pool sin destruirla, falla la de fuga.

### La recurrencia se corría

- **`cada` se ignoraba** salvo en días: "cada 2 meses" salía mensual.
- **Cada fecha se contaba desde la anterior**, ya corrida por el fin de
  semana: "el 15 de cada mes" pasaba al 17 y se quedaba ahí. Ahora
  `ocurrencia(inicio, frecuencia, cada, k)` cuenta **desde el inicio**.
- El 31 cae en el último día de los meses cortos y vuelve al 31 después
  (`sumarMeses`).

### Técnico fijo y su ausencia

Migración `20261006120000_programacion_tecnico`: `tecnicoId`,
`creadoPorId` y `ultimoAviso` en la programación, `usuarioId` opcional en el
historial, y las llaves compuestas de la programación (cliente, sede y
técnico de la sede), igual que la orden.

- Si el técnico está **inactivo o ya no está en la sede**, no se genera ni
  se avanza la fecha: al corregirlo, la visita sale en la siguiente vuelta.
- Todo salto deja su motivo en **`ultimoAviso`**: una programación que no
  produce nada parece que funciona si nadie dice por qué.

## Visitas recurrentes en la app (4.4, cierre)

Servidor: `ServicioProgramaciones` y rutas `GET/POST /programaciones`,
`POST /programaciones/:id/desactivar` y `/:id/tecnico` (administrador y
coordinador, en línea). App: `src/coordinador/programacion.ts` (reglas),
`PantallaProgramaciones.tsx`, ruta `programaciones`, botón "Visitas
recurrentes" en el panel. Reglas del dominio en `trabajos/programacion.ts`.

- **Lo que se ve antes de guardar es lo que va a pasar**: las próximas tres
  visitas salen de `proximasVisitas`, la misma cuenta que usa el trabajo.
  Hay una prueba que encadena `avanzarProxima` y exige las mismas fechas.
- **Solo en sus sedes**, igual que el resto: se lista y se programa por
  `UsuarioSede` (también el administrador).
- **El técnico se valida igual que el trabajo** (activo, técnico, en la sede),
  y la llave compuesta lo garantiza en la base.
- **Una sola programación activa por vehículo y tipo**: dos generarían dos
  órdenes por visita, o una y un aviso de "orden abierta" cada vez.
- **No se programa hacia atrás**: el trabajo la generaría con fecha de hoy y
  la primera visita no sería la escrita. "Hoy" es el de Colombia.
- **La tarjeta dice por qué no se generó** (`ultimoAviso`), primero y en
  texto; "Cambiar técnico" es la salida y limpia el aviso. "Pausar" pide
  confirmar una vez; no se borra nada.
- Un id por intento de alta: un doble toque con mala señal no duplica.
- El contrato anterior `zCrearProgramacion` (sin uso, con frecuencias y
  tipos escritos a mano, sin sede ni técnico) se reemplazó.
- `Opcion` (componente base) admite una segunda línea de detalle.

Probado contra la base real con el rol de aplicación y RLS: crear, repetida
rechazada, lista con nombres, pausar, auditoría. El paquete de la app no se
pudo armar (Metro detenido por falta de memoria); tipos y pruebas pasan.

## Primera prueba en el teléfono: la descarga fallaba siempre (2026-10-06)

Síntomas que reportó el usuario: el panel del coordinador llevaba a una lista
vacía, y una corrección de una orden devuelta quedó rechazada (409).

### Causa: una columna inexistente

`guardarMedicionesDescargadas` escribía en `capturada_en`, que no existe (es
`actualizada_en`). **Toda descarga con mediciones fallaba** después de
guardar las órdenes y antes de guardar la marca de descarga. Consecuencias
encadenadas:

- El error se tragaba en `sincronizar()` y la pantalla **no se refrescaba**:
  el coordinador veía la lista vacía con las órdenes ya en el celular.
- **Ninguna medición del servidor llegaba al celular.** Al corregir la
  orden devuelta, el editor no encontraba la de la posición 3 y creaba otra
  con id nuevo: el servidor la rechazó por posición ocupada, y la orden
  volvió a revisión con el valor viejo.
- La marca nunca se guardaba: toda descarga era completa (por eso el
  servidor nunca recibía `desde`).

**Por qué no lo vio ninguna prueba:** la única que descargaba mediciones
tomaba el camino que las salta (operación pendiente). El INSERT nunca se
ejecutó en una prueba. Es la lección de la 4.2 otra vez: lo que no se
ejecuta no se prueba, aunque haya una prueba con su nombre.

### Lo que se corrigió

- **La medición viaja completa** (servidor y celular): número de calor, DOT,
  estado, presiones, observaciones, "no identificada" con su motivo, autor y
  servicios. Con siete campos, corregir una orden devuelta reenviaba vacío
  lo que no se tocó y lo borraba en el servidor.
- **Lo mismo dentro del celular**: `medicionesDe` y `borradorDesde` perdían
  número de calor, estado, observaciones y motivo; reabrir una posición y
  guardarla los borraba, y una no identificada sin motivo no pasaba el
  contrato. `MedicionLocal` los exige ahora (el compilador señaló cada sitio).
- **Por posición, no solo por id**: una medición local de la misma posición
  con otro id, ya rechazada, cede ante la del servidor; una captura que
  sigue sin enviar se respeta. Así una corrección reutiliza el id del
  servidor.
- **Un fallo de descarga se muestra** bajo la barra de sesión ("No se pudo
  actualizar desde el servidor", con el detalle) y **la pantalla se refresca
  siempre**.

Verificado contra el servidor real con el código del celular: coordinador y
técnico reciben 5 órdenes y 25 mediciones completas, y la marca queda
puesta. Mutaciones: la columna vieja hace fallar 4 pruebas; sin el reemplazo
por posición, 1.

**En el teléfono del usuario** queda apartada la corrección rechazada de la
posición 3 de OS-FUN-000004. Con la descarga arreglada, el celular recibe la
medición del servidor; si hay que corregirla, el coordinador la devuelve.

## Barra de navegación de la oficina (2026-10-06)

Pedido del usuario tras la primera prueba: tocaba una tarjeta del panel,
llegaba a una lista y no tenía cómo moverse.

`src/app/navegacion.ts` (qué hay para cada rol), `BarraNavegacion.tsx`
(presentación), `NavegacionInferior.tsx` (unión con el enrutador), ruta `mas`.

- **Coordinador y administrador: Panel · Órdenes · Revisar · Más.** "Revisar"
  muestra cuántas esperan ("Revisar (3)"). La activa va en texto y con
  `aria-selected`.
- **Todos los roles tienen barra**, con lo que pueden hacer (pedido del
  usuario): técnico "Mis órdenes · Más" (nueva orden, clientes y sedes,
  cuenta); cliente "Mis servicios · Más" (cuenta). Al principio el técnico no
  la tenía para no sumarle un toque, pero sin ella no encontraba su cuenta ni
  el registro de clientes. Sigue entrando directo a sus órdenes. **El informe
  no se ofrece al técnico ni al cliente**: quién exporta sigue siendo una
  decisión abierta.
- Entre pestañas se navega con `replace`: "atrás" no recorre el historial de
  toques.
- **"Más"** reúne lo que no es diario (programar orden, visitas recurrentes,
  flota, informe, usuarios, sedes, plantillas, cuenta), cada uno con una
  línea de para qué sirve, y solo lo que el rol puede hacer. **El panel
  quedó con decisiones**: con ocho botones encima, las tarjetas urgentes no
  cabían en la pantalla.
- **Las tarjetas del panel abren la lista ya filtrada**
  (`/ordenes?filtro=devueltas|en_curso|cliente`), con "Ver todas". El filtro
  cuenta exactamente lo mismo que la tarjeta (`filtrarOrdenes` frente a
  `calcularIndicadores`, con prueba).
- La lista dice "Órdenes" para la oficina y "Mis órdenes" para el técnico, y
  su mensaje vacío explica qué hacer.
- Una prueba exige que cada destino de la barra y de "Más" tenga su archivo
  de ruta.
- **Lista dentro de ScrollView:** en el teléfono salía "VirtualizedLists
  should never be nested". La lista de órdenes estaba envuelta en un
  ScrollView solo para "tirar para actualizar"; ahora el refresco va en la
  propia lista (`refreshControl`, también cuando está vacía). Una prueba
  revisa que ninguna pantalla meta una lista virtualizada en un ScrollView.

## Fotos en el disco para probar en local (2026-10-06)

Sin cuenta de R2 las fotos quedaban en el teléfono como "no se pudo
enviar": el almacenamiento tenía valores de relleno. Para no instalar MinIO
(otro proceso y más memoria en el equipo del usuario) hay un almacenamiento
**solo de desarrollo** en el disco del servidor:
`apps/api/src/fotos/almacenamientoDisco.ts`.

- **Imita a R2 en lo que la app ve**: URL firmada (HMAC) que vence en los
  mismos minutos, `PUT` con su tipo, y **403** si venció o se alteró —que el
  celular ya interpreta como "pide otra"—. Lo que se prueba en local es el
  mismo camino que en producción, incluida la confirmación contra el
  almacenamiento.
- Solo acepta **el tipo y el tamaño firmados**, y **no escribe fuera de su
  carpeta** aunque la firma fuera válida para una ruta con `..`.
- Las rutas `/archivos-locales/*` van en su propio ámbito de Fastify (aceptan
  bytes crudos sin tocar las rutas JSON) y **solo se montan con
  `ALMACENAMIENTO=disco`**.
- **Configuración**: `ALMACENAMIENTO=r2|disco`, `URL_PUBLICA` (como el
  TELÉFONO ve el equipo; `localhost` se rechaza), `ALMACENAMIENTO_CARPETA`.
  **En producción "disco" se rechaza.** Las llaves de R2 solo se exigen con
  "r2". Estas comprobaciones corren aparte del esquema: los refinamientos de
  zod no se ejecutan si otra variable ya falló, y aparecerían recién en un
  segundo despliegue (lo detectó la prueba "todos los problemas juntos").
- Probado contra el servidor real: adjuntar devuelve la URL con la IP de la
  red, la subida responde 200 y la confirmación verifica que el archivo está.

Las fotos que el teléfono ya tenía pendientes llevan la URL de relleno; al
vencer (10 minutos) el celular pide otra y sale por el disco.

## Auditoría de la app y guardia de sesión (2026-10-06)

Pedido del usuario tras el "Render error: Esta pantalla requiere sesión
iniciada" al cerrar sesión: auditoría general para que no falle nada más.

### Cerrar sesión: guardia en el grupo `(app)`

Las pantallas que seguían montadas debajo (panel, lista) se redibujaban sin
usuario y `useUsuario` falla a propósito (4.4). Todo lo que exige sesión vive
ahora en `app/(app)/`, cuya disposición tiene **la guardia**: sin sesión el
grupo entero se desmonta y lleva al ingreso. Es el patrón de autenticación de
Expo Router; el grupo no cambia las direcciones (`/panel` sigue igual). Fuera
quedan `index`, `ingresar` y `activar`. Una prueba exige que ninguna
pantalla que use la sesión quede fuera del grupo.

En Windows, **Metro bloquea las carpetas de `app/`**: para moverlas hubo que
detenerlo.

### Recorrido de pantallas (`src/pruebas/recorrido.test.tsx`)

Descubre las pantallas leyendo `app/` (una nueva entra sola) y, con datos
reales en SQLite, para técnico, coordinador, administrador y cliente:

- **Dibujar**: cada pantalla con una orden existente y con una inexistente;
  falla si revienta, si queda en blanco o si escribe en la consola (avisos
  de React incluidos).
- **Tocar todo**: cada botón, pestaña y opción, uno por uno; falla si algo
  revienta o deja una promesa rechazada sin atrapar.
- La guardia al cerrar sesión, y las redes de seguridad.

Lo que encontró:

| Hallazgo | Efecto |
|---|---|
| Cinco pantallas de orden (detalle, datos, envío, reasignar, editor) con una orden o posición que no está en el teléfono | **Rueda de carga para siempre**, sin salida |
| Pedir permiso de cámara o guardar la foto en el teléfono podían fallar sin atrapar | Tocar "Tomar foto" no hacía nada visible |

Ahora `OrdenNoDisponible` dice qué pasó y ofrece volver al inicio, y la foto
avisa "No se pudo tomar la foto" / "La foto no se guardó" con el motivo.

**Lo que el recorrido no ve**: el aviso de listas anidadas no lo emite
`react-native-web`; lo cubre la prueba estática de `configuracionApp`.
Verificado con mutación: sin la guardia de sesión, falla la prueba de cerrar
sesión.

### Redes de seguridad

- **`ErrorBoundary`** en las dos disposiciones (`ErrorDePantalla`): si una
  pantalla revienta, en vez de la pantalla roja (o la app cerrada en
  producción) se explica, se ofrece reintentar o volver al inicio, y se
  muestra el detalle para soporte.
- **La sincronización nunca deja un error suelto**: corre sola cada minuto;
  si enviar falla, se informa en la barra ("No se pudo sincronizar con el
  servidor") y la siguiente vuelta reintenta.

### Barrido del servidor real

Con cada rol, todas las consultas: **cero respuestas 5xx**. Dos
observaciones para decidir (quedan en "Decisiones abiertas"):

- El **superadmin** recibe 403 en todo (no tiene empresa; la suplantación no
  está construida): en la app entra a un panel vacío con aviso de error.
- El **cliente y el técnico pueden consultar el informe** por la API
  (`/informe/resumen`, `/informe/exportar`); la app no se los ofrece.

## Informe para técnico y cliente; pantalla de plataforma (2026-10-06)

**Decisiones del usuario:** el técnico y el cliente **ven el informe**; el
superadmin, por ahora, una **pantalla que explica su cuenta** (la
suplantación se construye antes de una segunda empresa o de dar soporte).

### Informe

- En "Más" del técnico y del cliente. El alcance lo pone el servidor: el
  técnico, sus órdenes asignadas (RLS); el cliente, su `clienteId` (RLS) y
  **solo las órdenes que esperan su aprobación o están cerradas**, como en
  su portal: lo que se mide o se revisa es preliminar y vería números que
  después cambian. Toda exportación sigue quedando en la auditoría.

### Superadmin

- Entra a `/plataforma`: su cuenta administra TireTrack, no ve datos de
  empresas, y la sesión de soporte (motivo, ticket, vencimiento) aún no
  existe. Barra: Plataforma · Más (cuenta).
- **No sincroniza**: no tiene empresa y el servidor le responde 403; antes
  llenaba la barra de errores cada minuto.
- **No podía entrar a la app**: la sesión local exigía empresa (`NOT NULL`)
  y la suya es nula, aunque el contrato ya lo permitía. **Migración 11**
  rehace la tabla `sesion` con `empresa_id` opcional y conserva la sesión
  que hubiera. Lo encontró el recorrido de pantallas al sumar el rol.

## Llanta desmontada (2026-10-06)

Regla del negocio: "la llanta desmontada se autocompleta desde la última
orden que registró esa posición; no se escribe a mano". No estaba en ninguna
parte del flujo:

- **El editor no tenía el bloque.** Ahora "Llanta que sale": se abre solo al
  marcar **Montaje** (montar una llanta es que salió otra) o con el
  interruptor "Se cambió la llanta".
- **La identidad se trae de la última orden** de esa posición
  (`medicionAnterior` → `desmontadaDesde`): marca, diseño, medida, serial,
  DOT, número de calor. Se puede corregir si la llanta dice otra cosa. **La
  profundidad no se copia**: la de entonces no es la del retiro, y copiarla
  sería fabricar el dato. La pantalla dice de dónde vienen los datos, o que
  no hay orden anterior.
- Profundidad y **destino** (Desecho, Repuesto, Reencauche, Reparación,
  Inventario, del dominio) se anotan al retirarla; si faltan, **avisan**
  (a veces el destino se decide después). Un DOT imposible bloquea.
- **El servidor no la guardaba**: el contrato aceptaba `desmontada` desde la
  0.3, pero el `INSERT` omitía esas columnas. Se habría perdido sin aviso y
  las columnas de la desmontada del informe quedaban vacías. Ahora se guarda,
  se reemplaza al corregir (no se mezcla con la anterior) y **viaja en la
  descarga** —sin eso, corregir una orden devuelta la borraría, el mismo
  defecto de la medición incompleta—.
- **La prueba de mediciones escribía su tabla a mano**, sin esas columnas:
  ahora usa el esquema generado desde Prisma, como la de trabajos.

## Punto de retoma (2026-10-05)

**Estado:** el usuario prueba la app en el teléfono con Expo Go (SDK 52). Siguen PDF (6.3), vista de auditoría (5.4) y guía de despliegue.
Ingreso con doble factor, cuenta y cierre de sesión ya están en la app.
Firma, fotos, creación de órdenes, flota, usuarios, sedes, plantillas, informe y visitas recurrentes ya tienen pantalla.

**Verificado:** `npm run verify` con base: raíz 899/899, mobile 1257/1257.
Flujo completo por la API real sin respuestas inesperadas.

**Entorno local** (no versionado):

- `apps/api/.env`: roles `tiretrack_app` / `tiretrack_auth` con LOGIN y
  clave local, `DIRECT_URL` con el dueño `tiretrack`/`test`,
  `ALMACENAMIENTO=disco` y `URL_PUBLICA=http://<IP-LAN>:4000` (si cambia la IP
  del equipo, hay que cambiarla aquí y en Metro).
- Base de pruebas: `postgresql://tiretrack:test@localhost:5432/tiretrack_test`.
- Usuarios por rol y datos de prueba: scripts `usuarios-prueba.mjs` y
  `datos-prueba.mjs` en el directorio temporal de la sesión (no en el repo).

**Comandos:**

```bash
# Pruebas con base (sin la variable, las de integración se saltan)
DATABASE_URL_TEST=postgresql://tiretrack:test@localhost:5432/tiretrack_test PRUEBAS_EXIGEN_BASE=1 npm run verify

# Migraciones (no interactivo: "migrate dev" se queda esperando)
cd apps/api && npx prisma migrate deploy

# Servidor
cd apps/api && node --env-file=.env --import tsx src/server.ts

# App para Expo Go. --offline: app.json trae un projectId de EAS de relleno
# y, sin él, Expo intenta firmar el manifiesto con una cuenta ("Something
# went wrong"). La IP va por REACT_NATIVE_PACKAGER_HOSTNAME.
cd apps/mobile && EXPO_PUBLIC_API_URL=http://<IP-LAN>:4000/api/v1 REACT_NATIVE_PACKAGER_HOSTNAME=<IP-LAN> npx expo start --go --offline
```

**Pendiente de decisión:**

- La descarga incremental compara contra el instante en que se arma el
  paquete: un cambio de una transacción que confirma justo después puede
  quedar fuera. Un margen de solape lo cubriría (el celular ya tolera
  repetidos).

**Inestabilidad sin cerrar:** en una de 14 corridas completas bajo carga
fuerte, `aislamiento` y `rol-acceso` fallaron juntas al preparar. No se
reprodujo después.

## Decisiones abiertas

- **Señal de presencia en la orden** (propuesta del usuario): mostrar "Carlos
  abrió esta orden hace 10 minutos" sin bloquear. Se descartó el bloqueo duro
  porque choca con el trabajo sin conexión: un técnico que pierde señal con
  el bloqueo tomado dejaría la orden inaccesible.

No decidir por cuenta propia. Preguntar cuando toque el tema.

- Suplantación del superadmin (motivo, ticket, vencimiento): decidido
  construirla antes de una segunda empresa o de dar soporte real.
- Alcance del coordinador: ¿toda la empresa o solo sus sedes?
- Quién aprueba las marcas creadas en campo antes de volverlas globales
- Si se bloquea exportar órdenes sin cerrar (el cliente ya no las ve en su
  informe; la oficina y el técnico sí)
- Cómo se cuenta la alineación al facturar (hoy se marca por llanta, pero se
  ejecuta por eje)

---

## Referencia

El MVP en React que validó el producto está fuera de este repositorio. Contiene
las 24 pantallas funcionando con datos en memoria. Sirve como referencia de
comportamiento, **no como código a copiar**: su lógica está incrustada en el
JSX y aquí va extraída al dominio.
